import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

export const GoalStatus = Object.freeze({ PENDING: 'PENDING', PLANNED: 'PLANNED', ACTIVE: 'ACTIVE', COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' });

export class Goal {
  constructor({ id = randomUUID(), description, priority = 50, constraints = {}, deadline = null, steps = [] }) {
    if (!description?.trim()) throw new ValidationError('Goal description is required');
    if (!Number.isFinite(priority) || priority < 0 || priority > 100) throw new ValidationError('Goal priority must be between 0 and 100');
    this.id = id; this.description = description.trim(); this.priority = priority; this.status = GoalStatus.PENDING;
    this.constraints = structuredClone(constraints); this.deadline = deadline; this.progress = 0;
    this.steps = steps.map(step => ({ ...step, input: structuredClone(step.input ?? {}), requiredCapabilities: [...(step.requiredCapabilities ?? [])], dependencies: step.dependencies ? [...step.dependencies] : undefined }));
    this.createdAt = new Date().toISOString(); this.updatedAt = this.createdAt;
  }
  update(status, progress = this.progress) { this.status = status; this.progress = Math.max(0, Math.min(100, progress)); this.updatedAt = new Date().toISOString(); }
  toDTO() {
    return structuredClone({ ...this, steps: this.steps.map(({ verify, ...step }) => step) });
  }
}
