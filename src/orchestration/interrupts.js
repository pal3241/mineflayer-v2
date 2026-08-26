import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

export const InterruptPriority = Object.freeze({ OPTIONAL: 10, NORMAL_TASK: 20, CRITICAL_TASK: 40, COMBAT: 60, SURVIVAL: 80, EMERGENCY: 100 });
export const ResumePolicy = Object.freeze({ RESUME: 'RESUME', RESTART: 'RESTART', ABORT: 'ABORT' });

export class InterruptManager {
  #handlers = new Map();
  constructor({ eventBus, checkpointManager } = {}) { this.events = eventBus; this.checkpoints = checkpointManager; this.active = null; this.queue = []; }
  register(type, handler) { if (typeof handler !== 'function') throw new ValidationError('Interrupt handler must be a function'); this.#handlers.set(type, handler); }
  request({ id = randomUUID(), type, priority = InterruptPriority.NORMAL_TASK, resumePolicy = ResumePolicy.RESUME, payload = {} }) {
    if (!this.#handlers.has(type)) throw new ValidationError(`No handler for interrupt '${type}'`);
    const interrupt = { id, type, priority, resumePolicy, payload, createdAt: new Date().toISOString() };
    this.queue.push(interrupt); this.queue.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt)); return interrupt;
  }
  async process(context = {}) {
    if (this.active || !this.queue.length) return null;
    const interrupt = this.queue.shift(); this.active = interrupt;
    try {
      if (context.taskId && this.checkpoints) await this.checkpoints.save({ taskId: context.taskId, botId: context.botId, behaviorNode: context.behaviorNode, machineState: context.machineState, blackboardSnapshot: context.blackboardSnapshot });
      context.cancellationToken?.cancel(`Interrupted by ${interrupt.type}`);
      await this.events?.publish('interrupt.started', interrupt, { source: 'interrupt-manager', correlationId: context.goalId });
      const result = await this.#handlers.get(interrupt.type)(interrupt.payload, context);
      const verified = context.verifySafety ? await context.verifySafety(result) : true;
      const resume = verified ? interrupt.resumePolicy : ResumePolicy.ABORT;
      if (resume === ResumePolicy.RESUME) await context.resume?.();
      else if (resume === ResumePolicy.RESTART) await context.restart?.();
      else await context.abort?.();
      await this.events?.publish('interrupt.completed', { ...interrupt, resume, verified }, { source: 'interrupt-manager', correlationId: context.goalId });
      return { interrupt, result, resume, verified };
    } finally { this.active = null; }
  }
}
