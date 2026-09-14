import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from '../core/errors.js';

const TERMINAL_EVENTS = ['task.completed', 'task.failed', 'task.cancelled', 'task.collaborative'];
const PATCH_FIELDS = new Set(['currentAction', 'target', 'progress', 'inventory', 'cargo', 'route', 'controlLease', 'checkpoint', 'metadata']);

export function createWorkingMemoryService({ repository, events, governance = null, maxRecords = 1000, ttlMs = 1_800_000 }) {
  if (!repository || typeof repository.list !== 'function') throw new ValidationError('Working memory repository is required');
  if (!Number.isInteger(maxRecords) || maxRecords < 1) throw new ValidationError('Working memory maxRecords must be a positive integer');
  if (!Number.isInteger(ttlMs) || ttlMs < 1000) throw new ValidationError('Working memory TTL must be at least 1000ms');
  let initialized = false;

  const audit = (action, memoryId, reason = null, details = {}) => governance?.record({ action: `WORKING_${action}`, memoryId, reason, details });
  const purgeExpired = async (reason = 'ttl-expired') => { const now = Date.now(); const expired = (await repository.list()).filter(item => Date.parse(item.expiresAt) <= now); for (const item of expired) { await repository.delete(item.id); await audit('PURGED', item.id, reason, { taskId: item.taskId, botId: item.botId }); } return expired.length; };
  const initialize = async () => { const records = await repository.list(); for (const item of records) { await repository.delete(item.id); await audit('PURGED', item.id, 'restart-stale', { taskId: item.taskId, botId: item.botId }); } initialized = true; return { purged: records.length, reason: 'restart-stale' }; };

  const activate = async task => {
    const taskId = requiredString(task?.id ?? task?.taskId, 'taskId'); const botId = requiredString(task?.assignedBot ?? task?.botId, 'botId'); const now = new Date().toISOString();
    const existing = (await repository.list()).find(item => item.taskId === taskId); const record = normalizeRecord({ ...(existing ?? {}), taskId, botId, goalId: task.goalId ?? existing?.goalId ?? null, currentAction: task.type ?? task.currentAction ?? existing?.currentAction ?? null, target: task.input?.target ?? task.target ?? existing?.target ?? null, progress: task.progress ?? existing?.progress ?? { completed: 0, total: null, ratio: 0 }, checkpoint: task.checkpoint ?? existing?.checkpoint ?? null, metadata: { ...(existing?.metadata ?? {}), taskStatus: task.status ?? 'RUNNING' } }, { id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? now, now, ttlMs, version: Number(existing?.version ?? 0) + 1 });
    const saved = existing ? await repository.update(existing.id, record) : await repository.create(record); await enforceBound(); await audit(existing ? 'UPDATED' : 'ACTIVATED', saved.id, null, { taskId, botId }); return structuredClone(saved);
  };
  const update = async (taskId, patch) => {
    const current = await findByTask(taskId); if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ValidationError('Working memory patch must be an object');
    for (const key of Object.keys(patch)) if (!PATCH_FIELDS.has(key)) throw new ValidationError(`Unsupported working memory field '${key}'`);
    const now = new Date().toISOString(); const record = normalizeRecord({ ...current, ...structuredClone(patch), metadata: patch.metadata ? { ...current.metadata, ...patch.metadata } : current.metadata }, { id: current.id, createdAt: current.createdAt, now, ttlMs, version: current.version + 1 });
    const saved = await repository.update(current.id, record); await audit('UPDATED', saved.id, null, { taskId: saved.taskId, botId: saved.botId }); return structuredClone(saved);
  };
  const release = async (taskId, reason = 'task-terminal') => { const current = (await repository.list()).find(item => item.taskId === taskId); if (!current) return false; await repository.delete(current.id); await audit('RELEASED', current.id, reason, { taskId: current.taskId, botId: current.botId }); return true; };
  const findByTask = async taskId => { await purgeExpired(); const id = requiredString(taskId, 'taskId'); const record = (await repository.list()).find(item => item.taskId === id); if (!record) throw new NotFoundError('Working memory', id); return structuredClone(record); };
  const list = async ({ botId, goalId, limit = 100 } = {}) => { await purgeExpired(); const bounded = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 100)); return (await repository.list()).filter(item => (!botId || item.botId === botId) && (!goalId || item.goalId === goalId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, bounded); };
  const status = async () => { await purgeExpired(); const records = await repository.list(); return { status: 'HEALTHY', initialized, count: records.length, maxRecords, ttlMs, bots: new Set(records.map(item => item.botId)).size, tasks: records.map(item => item.taskId) }; };
  const enforceBound = async () => { const records = (await repository.list()).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)); for (const item of records.slice(0, Math.max(0, records.length - maxRecords))) { await repository.delete(item.id); await audit('PURGED', item.id, 'capacity-limit', { taskId: item.taskId, botId: item.botId }); } };

  const unsubscribers = [];
  if (events) {
    unsubscribers.push(events.subscribe('task.started', event => activate(event.payload)));
    unsubscribers.push(events.subscribe('task.retrying', event => update(event.payload.taskId, { metadata: { lastError: event.payload.error, taskStatus: 'RETRYING' } }).catch(error => { if (error.code !== 'NOT_FOUND') throw error; })));
    for (const type of TERMINAL_EVENTS) unsubscribers.push(events.subscribe(type, event => release(event.payload.id ?? event.payload.taskId, type)));
  }
  const dispose = () => { for (const unsubscribe of unsubscribers) unsubscribe(); };
  return Object.freeze({ initialize, activate, update, release, find: findByTask, list, purgeExpired, status, dispose });
}

function normalizeRecord(value, { id, createdAt, now, ttlMs, version }) {
  const record = { id, taskId: requiredString(value.taskId, 'taskId'), botId: requiredString(value.botId, 'botId'), goalId: nullableString(value.goalId), currentAction: nullableString(value.currentAction), target: safeValue(value.target), progress: normalizeProgress(value.progress), inventory: safeArray(value.inventory), cargo: safeArray(value.cargo), route: safeArray(value.route), controlLease: safeValue(value.controlLease), checkpoint: safeValue(value.checkpoint), metadata: safeObject(value.metadata), createdAt, updatedAt: now, expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(), version, schemaVersion: 1 };
  if (JSON.stringify(record).length > 65_536) throw new ValidationError('Working memory record must not exceed 64 KiB'); return record;
}
function normalizeProgress(value) { const progress = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; const completed = finite(progress.completed, 0); const total = progress.total == null ? null : Math.max(0, finite(progress.total, 0)); const ratio = total && total > 0 ? Math.min(1, completed / total) : Math.max(0, Math.min(1, finite(progress.ratio, 0))); return { completed: Math.max(0, completed), total, ratio }; }
function safeValue(value) { return value == null ? null : structuredClone(value); }
function safeArray(value) { return Array.isArray(value) ? structuredClone(value).slice(0, 256) : []; }
function safeObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {}; }
function requiredString(value, field) { const text = String(value ?? '').trim(); if (!text || text.length > 200) throw new ValidationError(`Working memory ${field} must contain 1-200 characters`); return text; }
function nullableString(value) { if (value == null) return null; const text = String(value).trim(); return text ? text.slice(0, 200) : null; }
function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
