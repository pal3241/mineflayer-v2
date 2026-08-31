import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

export const TaskStatus = Object.freeze({ PENDING: 'PENDING', READY: 'READY', ASSIGNED: 'ASSIGNED', RUNNING: 'RUNNING', COLLABORATIVE: 'COLLABORATIVE', COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED', BLOCKED: 'BLOCKED' });

export class Task {
  constructor({ id = randomUUID(), goalId, type, input = {}, resources = {}, requiredCapabilities = [], dependencies = [], priority = 50, retries = 2, timeout = 30_000, verify, reportLifecycle }) {
    if (!goalId || !type) throw new ValidationError('Task goalId and type are required');
    this.id = id; this.goalId = goalId; this.type = type; this.input = structuredClone(input); this.resources = normalizeResources(resources);
    this.requiredCapabilities = [...new Set(requiredCapabilities)]; this.dependencies = [...new Set(dependencies)];
    this.priority = priority; this.status = this.dependencies.length ? TaskStatus.PENDING : TaskStatus.READY;
    this.assignedBot = null; this.retries = retries; this.attempts = 0; this.timeout = timeout; this.verify = verify; this.reportLifecycle = reportLifecycle !== false;
    this.result = null; this.error = null; this.createdAt = new Date().toISOString(); this.updatedAt = this.createdAt;
  }
  update(status, patch = {}) { this.status = status; Object.assign(this, patch); this.updatedAt = new Date().toISOString(); }
  toDTO() { const { verify, ...data } = this; return structuredClone(data); }
}

function normalizeResources(value) { const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; const ownerType = String(raw.ownerType ?? 'TASK').trim().toUpperCase(); const reason = String(raw.reason ?? '').trim().toUpperCase() || null; if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(ownerType)) throw new ValidationError('Task resource ownerType is invalid'); if (reason !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(reason)) throw new ValidationError('Task resource reason is invalid'); return { ownerType, reason, inputs: normalizeEntries(raw.inputs), outputs: normalizeEntries(raw.outputs) }; }
function normalizeEntries(value) { if (value === undefined) return []; if (!Array.isArray(value)) throw new ValidationError('Task resources must contain input and output arrays'); return value.map(entry => { const item = String(entry?.item ?? '').trim().toLowerCase(); const count = Number(entry?.count); if (!/^[a-z0-9_]{1,128}$/.test(item) || !Number.isInteger(count) || count < 1) throw new ValidationError('Task resource entries require item and positive count'); return { item, count }; }); }
