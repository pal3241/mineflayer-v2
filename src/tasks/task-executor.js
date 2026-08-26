import { CancellationToken } from '../orchestration/cancellation.js';
import { retry, withTimeout } from '../orchestration/execution.js';
import { TaskStatus } from './task.js';

export class TaskExecutor {
  #tokens = new Map();
  constructor({ capabilities, scheduler, eventBus, metrics, checkpointRepository }) { this.capabilities = capabilities; this.scheduler = scheduler; this.events = eventBus; this.metrics = metrics; this.checkpoints = checkpointRepository; }
  cancel(taskId, reason) { const token = this.#tokens.get(taskId); if (!token) return false; token.cancel(reason); return true; }
  async execute(task) {
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
    } finally { this.#tokens.delete(task.id); this.scheduler.release(task); }
  }
}
