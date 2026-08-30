import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

export const TaskStatus = Object.freeze({ PENDING: 'PENDING', READY: 'READY', ASSIGNED: 'ASSIGNED', RUNNING: 'RUNNING', COLLABORATIVE: 'COLLABORATIVE', COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED', BLOCKED: 'BLOCKED' });

export class Task {
  constructor({ id = randomUUID(), goalId, type, input = {}, requiredCapabilities = [], dependencies = [], priority = 50, retries = 2, timeout = 30_000, verify, reportLifecycle }) {
    if (!goalId || !type) throw new ValidationError('Task goalId and type are required');
    this.id = id; this.goalId = goalId; this.type = type; this.input = structuredClone(input);
    this.requiredCapabilities = [...new Set(requiredCapabilities)]; this.dependencies = [...new Set(dependencies)];
    this.priority = priority; this.status = this.dependencies.length ? TaskStatus.PENDING : TaskStatus.READY;
    this.assignedBot = null; this.retries = retries; this.attempts = 0; this.timeout = timeout; this.verify = verify; this.reportLifecycle = reportLifecycle !== false;
    this.result = null; this.error = null; this.createdAt = new Date().toISOString(); this.updatedAt = this.createdAt;
  }
  update(status, patch = {}) { this.status = status; Object.assign(this, patch); this.updatedAt = new Date().toISOString(); }
  toDTO() { const { verify, ...data } = this; return structuredClone(data); }
}
