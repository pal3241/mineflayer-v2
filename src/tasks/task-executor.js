import { CancellationToken } from '../orchestration/cancellation.js';
import { retry, withTimeout } from '../orchestration/execution.js';
import { TaskStatus } from './task.js';
import { CancelledError, ConflictError, ValidationError } from '../core/errors.js';

export class TaskExecutor {
  #tokens = new Map();
  #tails = new Map();
  #waiting = new Map();
  #running = new Map();
  constructor({ capabilities, scheduler, eventBus, metrics, checkpointRepository, maxQueuePerBot }) { if (!Number.isInteger(maxQueuePerBot) || maxQueuePerBot < 1) throw new ValidationError('Task executor queue limit must be a positive integer'); this.capabilities = capabilities; this.scheduler = scheduler; this.events = eventBus; this.metrics = metrics; this.checkpoints = checkpointRepository; this.maxQueuePerBot = maxQueuePerBot; }
  cancel(taskId, reason) { const message = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Task cancelled'; const token = this.#tokens.get(taskId); if (token) { token.cancel(message); return true; } const waiting = this.#waiting.get(taskId); if (!waiting) return false; waiting.cancelReason = message; return true; }
  execute(task) {
    if (!task.assignedBot) return Promise.reject(new ValidationError(`Task '${task.id}' must be assigned before execution`)); if (this.#waiting.has(task.id) || this.#tokens.has(task.id)) return Promise.reject(new ConflictError(`Task '${task.id}' is already queued or running`)); const botId = task.assignedBot; const queuedForBot = [...this.#waiting.values()].filter(entry => entry.task.assignedBot === botId).length; if (queuedForBot >= this.maxQueuePerBot) return this.#rejectBeforeStart(task, new ConflictError(`Task queue for bot '${botId}' reached its limit of ${this.maxQueuePerBot}`)); const entry = { task, cancelReason: null, queuedAt: new Date().toISOString() }; this.#waiting.set(task.id, entry); const previous = this.#tails.get(botId) ?? Promise.resolve();
    const operation = previous.then(async () => { this.#waiting.delete(task.id); try { if (entry.cancelReason) { task.update(TaskStatus.CANCELLED, { error: { code: 'CANCELLED', message: entry.cancelReason } }); this.metrics.increment('tasks.cancelled'); await this.events.publish('task.cancelled', task.toDTO(), { source: 'task-executor', correlationId: task.goalId }); throw new CancelledError(entry.cancelReason); } this.#running.set(botId, task.id); return await this.#executeNow(task); } finally { this.#running.delete(botId); this.scheduler.release(task); } });
    const tail = operation.then(() => undefined, () => undefined); this.#tails.set(botId, tail); void tail.then(() => { if (this.#tails.get(botId) === tail) this.#tails.delete(botId); }); return operation;
  }
  status() { const queues = {}; for (const entry of this.#waiting.values()) { const botId = entry.task.assignedBot; queues[botId] ??= []; queues[botId].push({ taskId: entry.task.id, goalId: entry.task.goalId, type: entry.task.type, priority: entry.task.priority, queuedAt: entry.queuedAt }); } const maximumDepth = Math.max(0, ...Object.values(queues).map(queue => queue.length)); return { running: Object.fromEntries(this.#running), queues, queuedTasks: this.#waiting.size, activeBots: this.#running.size, maxQueuePerBot: this.maxQueuePerBot, maximumDepth, saturation: maximumDepth / this.maxQueuePerBot }; }
  async #rejectBeforeStart(task, error) { task.update(TaskStatus.FAILED, { error: { code: error.code, message: error.message } }); this.scheduler.release(task); this.metrics.increment('tasks.failed'); await this.events.publish('task.failed', task.toDTO(), { source: 'task-executor', correlationId: task.goalId }); throw error; }
  async #executeNow(task) {
    const started = performance.now(); const token = new CancellationToken(); this.#tokens.set(task.id, token);
    task.update(TaskStatus.RUNNING); await this.events.publish('task.started', task.toDTO(), { source: 'task-executor', correlationId: task.goalId });
    try {
      const result = await retry(async attempt => {
        task.attempts = attempt; token.throwIfCancelled();
        await this.checkpoints?.save({ taskId: task.id, botId: task.assignedBot, machineState: 'RUNNING', attempt, blackboardSnapshot: { input: task.input } });
        const outputs = {};
        for (const name of task.requiredCapabilities) outputs[name] = await withTimeout(signal => this.capabilities.execute(name, task.input, { botId: task.assignedBot, task: task.toDTO(), signal }), task.timeout, { name: `task:${task.id}:${name}`, signal: token.signal });
        const value = task.requiredCapabilities.length === 1 ? outputs[task.requiredCapabilities[0]] : outputs;
        if (task.verify && !await task.verify(value, task)) throw new Error('Task verification failed');
        return value;
      }, { attempts: task.retries + 1, signal: token.signal, onRetry: async error => {
        this.metrics.increment('tasks.retries'); await this.events.publish('task.retrying', { taskId: task.id, error: error.message }, { source: 'task-executor', correlationId: task.goalId });
      }});
      task.update(TaskStatus.COMPLETED, { result, error: null }); this.metrics.increment('tasks.completed'); this.scheduler.record(task.assignedBot, true, performance.now() - started);
      await this.checkpoints?.remove(task.id);
      await this.events.publish('task.completed', task.toDTO(), { source: 'task-executor', correlationId: task.goalId }); return result;
    } catch (error) {
      const status = token.cancelled ? TaskStatus.CANCELLED : TaskStatus.FAILED; task.update(status, { error: { code: error.code ?? 'EXECUTION_ERROR', message: error.message } });
      this.metrics.increment(status === TaskStatus.CANCELLED ? 'tasks.cancelled' : 'tasks.failed'); this.scheduler.record(task.assignedBot, false, performance.now() - started);
      await this.events.publish(`task.${status.toLowerCase()}`, task.toDTO(), { source: 'task-executor', correlationId: task.goalId }); throw error;
    } finally { this.#tokens.delete(task.id); }
  }
}
