import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { advanceDespawnBudget, createDespawnBudget, normalizeDespawnBudget } from './despawn-budget.js';
import {
  createRecoveryConfig,
  finiteNumber,
  identifier,
  isoTimestamp,
  normalizeEvaluatedItem,
  normalizeRecoveryEvaluation,
  nonNegativeInteger,
  recoveryFailureCode,
  recoveryState,
  requiredRecord,
  strictBoolean,
  validateDeathManifest
} from './recovery-schema.js';
import { validateRecoveryVerification } from './recovery-verifier.js';

const TERMINAL_STATES = new Set(['RECOVERED', 'PARTIAL_RECONCILED', 'FAILED', 'EXPIRED_RECONCILED', 'CANCELLED', 'UNRECOVERABLE']);
const IRRECOVERABLE_CODES = new Set(['UNKNOWN_DEATH_LOCATION', 'DIMENSION_UNAVAILABLE', 'VOID_DEATH', 'LAVA_LOSS', 'FIRE_LOSS', 'RECOVERY_NOT_WORTH_COST']);
const TRANSITIONS = new Map([
  ['DETECTED', new Set(['PENDING', 'CANCELLED', 'UNRECOVERABLE'])],
  ['PENDING', new Set(['EVALUATING', 'ASSIGNED', 'REASSIGN_REQUIRED', 'EXPIRED', 'CANCELLED', 'UNRECOVERABLE'])],
  ['EVALUATING', new Set(['ASSIGNED', 'REASSIGN_REQUIRED', 'FAILED', 'EXPIRED', 'CANCELLED', 'UNRECOVERABLE'])],
  ['ASSIGNED', new Set(['TRAVELLING', 'REASSIGN_REQUIRED', 'FAILED', 'EXPIRED', 'CANCELLED', 'UNRECOVERABLE'])],
  ['TRAVELLING', new Set(['SEARCHING', 'REASSIGN_REQUIRED', 'FAILED', 'EXPIRED', 'CANCELLED', 'UNRECOVERABLE'])],
  ['SEARCHING', new Set(['COLLECTING', 'VERIFYING', 'REASSIGN_REQUIRED', 'FAILED', 'EXPIRED', 'CANCELLED', 'UNRECOVERABLE'])],
  ['COLLECTING', new Set(['VERIFYING', 'REASSIGN_REQUIRED', 'FAILED', 'EXPIRED', 'CANCELLED', 'UNRECOVERABLE'])],
  ['VERIFYING', new Set(['RECOVERED', 'PARTIAL', 'FAILED', 'EXPIRED', 'UNRECOVERABLE'])],
  ['PARTIAL', new Set(['PARTIAL_RECONCILED'])],
  ['EXPIRED', new Set(['EXPIRED_RECONCILED'])],
  ['REASSIGN_REQUIRED', new Set(['ASSIGNED', 'FAILED', 'EXPIRED', 'CANCELLED', 'UNRECOVERABLE'])]
]);

export function createRecoveryJobService(input) {
  const dependencies = requiredRecord(input, 'Recovery job service dependencies');
  validateRepository(dependencies.repository);
  validateEvents(dependencies.events);
  const repository = dependencies.repository;
  const events = dependencies.events ?? null;
  const bots = dependencies.bots ?? null;
  const resourceReservations = dependencies.resourceReservations ?? null;
  const config = createRecoveryConfig(dependencies.config);
  let mutationQueue = Promise.resolve();
  const mutate = operation => {
    const result = mutationQueue.then(operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const create = inputValue => mutate(async () => {
    const source = requiredRecord(inputValue, 'Recovery job create input');
    const manifest = validateDeathManifest(source.manifest);
    const evaluation = normalizeRecoveryEvaluation(source.evaluation);
    const chunkActive = strictBoolean(source.chunkActive, 'Recovery job chunkActive');
    if (!config.enabled) throw new ConflictError('Death recovery is disabled');
    if (!evaluation.shouldRecover) throw new ConflictError(`Death manifest '${manifest.id}' is not eligible for recovery`, { manifestId: manifest.id, blockedBy: evaluation.blockedBy });
    const duplicates = (await repository.list()).filter(record => record.manifestId === manifest.id && !TERMINAL_STATES.has(record.status));
    if (duplicates.length) throw new ConflictError(`Death manifest '${manifest.id}' already has an active recovery job`, { jobId: duplicates[0].id });
    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      type: 'DEATH_DROP',
      memoryType: 'SHORT_TERM',
      manifestId: manifest.id,
      manifest,
      deadBotId: manifest.botId,
      worldKey: manifest.worldKey,
      dimension: manifest.dimension,
      position: manifest.position,
      relatedTransferId: manifest.relatedTransferId,
      items: evaluation.items,
      recoveryScore: evaluation.recoveryScore,
      evaluationDecision: evaluation.decision,
      status: 'EVALUATING',
      assignedBotId: null,
      resourceReservationIds: [],
      despawn: createDespawnBudget({ budgetTicks: config.despawnTicks, safetyMarginTicks: config.safetyMarginTicks, estimatedLoadedTicks: 0, chunkActive }),
      recoveryAttempts: 0,
      maxAttempts: config.maxAttempts,
      failure: null,
      verification: null,
      lifecycle: Object.freeze([lifecycleEntry('DETECTED', now), lifecycleEntry('PENDING', now), lifecycleEntry('EVALUATING', now)]),
      createdAt: now,
      updatedAt: now
    };
    const created = normalizeRecoveryJob(await repository.create(job));
    await publish(events, 'logistics.recovery.job.created', created);
    return created;
  });

  const find = async jobIdInput => normalizeRecoveryJob(await repository.find(identifier(jobIdInput, 'Recovery job id')));
  const list = async queryInput => {
    const query = requiredRecord(queryInput, 'Recovery job query');
    const statuses = normalizeStatuses(query.statuses);
    const worldKey = query.worldKey === undefined || query.worldKey === null ? null : scopedString(query.worldKey, 'Recovery job query worldKey');
    const dimension = query.dimension === undefined || query.dimension === null ? null : scopedString(query.dimension, 'Recovery job query dimension');
    const records = (await repository.list()).map(normalizeRecoveryJob).filter(job => (!statuses || statuses.has(job.status)) && (!worldKey || job.worldKey === worldKey) && (!dimension || job.dimension === dimension));
    return Object.freeze(records.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)));
  };

  const transition = inputValue => mutate(async () => {
    const source = requiredRecord(inputValue, 'Recovery transition input');
    const current = await find(source.jobId);
    const nextStatus = recoveryState(source.status, 'Recovery transition status');
    const updated = await transitionRecord(repository, events, current, nextStatus, {}); return releaseRecoveryResourcesIfTerminal(repository, resourceReservations, updated);
  });

  const assign = inputValue => mutate(async () => {
    const source = requiredRecord(inputValue, 'Recovery assignment input');
    const current = await find(source.jobId);
    const botId = identifier(source.botId, 'Recovery assignment botId');
    if (!['EVALUATING', 'PENDING', 'REASSIGN_REQUIRED'].includes(current.status)) throw invalidTransition(current, 'ASSIGNED');
    releaseRecoveryResources(resourceReservations, current.resourceReservationIds); const reservationIds = reserveRecoveryResources(resourceReservations, bots, current, botId); try { return await transitionRecord(repository, events, current, 'ASSIGNED', { assignedBotId: botId, failure: null, resourceReservationIds: reservationIds }); } catch (error) { releaseRecoveryResources(resourceReservations, reservationIds); throw error; }
  });

  const recordFailure = inputValue => mutate(async () => {
    const source = requiredRecord(inputValue, 'Recovery failure input');
    const current = await find(source.jobId);
    if (isTerminal(current.status) || current.status === 'PARTIAL' || current.status === 'EXPIRED') throw new ConflictError(`Recovery job '${current.id}' cannot record another attempt from status '${current.status}'`, { jobId: current.id, status: current.status });
    const code = recoveryFailureCode(source.code, 'Recovery failure code');
    const message = boundedMessage(source.message, 'Recovery failure message');
    const recoveryAttempts = current.recoveryAttempts + 1;
    const reachedLimit = recoveryAttempts >= current.maxAttempts;
    const nextStatus = code === 'ITEMS_DESPAWNED' ? 'EXPIRED' : IRRECOVERABLE_CODES.has(code) ? 'UNRECOVERABLE' : reachedLimit ? 'FAILED' : 'REASSIGN_REQUIRED';
    const failureCode = reachedLimit && nextStatus === 'FAILED' ? 'MAX_RECOVERY_ATTEMPTS' : code;
    const updated = await transitionRecord(repository, events, current, nextStatus, {
      assignedBotId: nextStatus === 'REASSIGN_REQUIRED' ? null : current.assignedBotId,
      resourceReservationIds: nextStatus === 'REASSIGN_REQUIRED' ? [] : current.resourceReservationIds,
      recoveryAttempts,
      failure: Object.freeze({ code: failureCode, attemptCode: code, message, at: new Date().toISOString() })
    }); if (nextStatus === 'REASSIGN_REQUIRED' || isTerminal(nextStatus)) releaseRecoveryResources(resourceReservations, current.resourceReservationIds); return updated;
  });

  const updateDespawn = inputValue => mutate(async () => {
    const source = requiredRecord(inputValue, 'Recovery despawn update input');
    const current = await find(source.jobId);
    if (isTerminal(current.status) || current.status === 'PARTIAL' || current.status === 'EXPIRED') throw new ConflictError(`Recovery job '${current.id}' cannot update despawn ticks from status '${current.status}'`, { jobId: current.id, status: current.status });
    const despawn = advanceDespawnBudget({
      budget: current.despawn,
      loadedTicksElapsed: nonNegativeInteger(source.loadedTicksElapsed, 'Recovery despawn loadedTicksElapsed'),
      chunkActive: strictBoolean(source.chunkActive, 'Recovery despawn chunkActive')
    });
    if (despawn.status === 'EXPIRED' && current.status !== 'EXPIRED') return transitionRecord(repository, events, current, 'EXPIRED', { despawn, failure: Object.freeze({ code: 'ITEMS_DESPAWNED', attemptCode: 'ITEMS_DESPAWNED', message: 'Dropped item despawn budget was exhausted', at: new Date().toISOString() }) });
    const updated = normalizeRecoveryJob(await repository.update(current.id, { despawn, updatedAt: new Date().toISOString() }));
    await publish(events, 'logistics.recovery.timer.updated', updated);
    return updated;
  });

  const complete = inputValue => mutate(async () => {
    const source = requiredRecord(inputValue, 'Recovery completion input');
    const current = await find(source.jobId);
    if (current.status !== 'VERIFYING') throw invalidTransition(current, source.verification?.verified ? 'RECOVERED' : 'PARTIAL');
    const verification = validateRecoveryVerification(source.verification);
    const nextStatus = verification.verified ? 'RECOVERED' : 'PARTIAL';
    const updated = await transitionRecord(repository, events, current, nextStatus, { verification, resourceReservationIds: [] }); releaseRecoveryResources(resourceReservations, current.resourceReservationIds); return updated;
  });

  const remove = inputValue => mutate(async () => {
    const source = requiredRecord(inputValue, 'Recovery removal input');
    const current = await find(source.jobId);
    if (!isTerminal(current.status)) throw new ConflictError(`Recovery job '${current.id}' cannot be removed before reconciliation`, { jobId: current.id, status: current.status });
    const removed = await repository.delete(current.id);
    if (!removed) throw new NotFoundError('Recovery job', current.id);
    await publish(events, 'logistics.recovery.memory.cleaned', { id: current.id, status: current.status, manifestId: current.manifestId });
    return true;
  });

  return Object.freeze({ create, find, list, transition, assign, recordFailure, updateDespawn, complete, remove, settings: () => config });
}

function reserveRecoveryResources(reservations, bots, job, botId) { if (!reservations || !bots) return []; const runtime = bots.get(botId); const inventory = runtime.adapter.snapshot().inventorySummary ?? []; const ids = []; try { for (const item of job.items.filter(entry => entry.decision !== 'SKIP')) ids.push(reservations.reserve({ ownerType: 'RECOVERY', ownerId: job.id, sessionId: job.id, botId, item: item.name, count: item.count, inventory, reason: 'RECOVERY_RESERVED', allowUnbacked: true }).id); return ids; } catch (error) { releaseRecoveryResources(reservations, ids); throw error; } }
function releaseRecoveryResources(reservations, ids) { if (!reservations) return; for (const id of Array.isArray(ids) ? ids : []) reservations.release({ leaseId: id }); }
async function releaseRecoveryResourcesIfTerminal(repository, reservations, job) { if (!isTerminal(job.status)) return job; releaseRecoveryResources(reservations, job.resourceReservationIds); return normalizeRecoveryJob(await repository.update(job.id, { resourceReservationIds: [], updatedAt: new Date().toISOString() })); }

export function transitionRecoveryJob(input) {
  const source = requiredRecord(input, 'Recovery job state transition');
  const current = normalizeRecoveryJob(source.job);
  const nextStatus = recoveryState(source.status, 'Recovery job next status');
  const occurredAt = isoTimestamp(source.occurredAt, 'Recovery job transition occurredAt');
  ensureTransition(current.status, nextStatus, current.id);
  return Object.freeze({ ...current, status: nextStatus, lifecycle: Object.freeze([...current.lifecycle, lifecycleEntry(nextStatus, occurredAt)]), updatedAt: occurredAt });
}

export function normalizeRecoveryJob(input) {
  const source = requiredRecord(input, 'Recovery job');
  const lifecycle = normalizeLifecycle(source.lifecycle);
  const status = recoveryState(source.status, 'Recovery job status');
  if (lifecycle.at(-1).state !== status) throw new ValidationError('Recovery job lifecycle must end at the current status', { status, lifecycleStatus: lifecycle.at(-1).state });
  const recoveryAttempts = nonNegativeInteger(source.recoveryAttempts, 'Recovery job recoveryAttempts');
  const maxAttempts = nonNegativeInteger(source.maxAttempts, 'Recovery job maxAttempts');
  if (maxAttempts < 1 || maxAttempts > 10) throw new ValidationError('Recovery job maxAttempts must be between 1 and 10', { maxAttempts });
  if (recoveryAttempts > maxAttempts) throw new ValidationError('Recovery job recoveryAttempts cannot exceed maxAttempts', { recoveryAttempts, maxAttempts });
  if (!Array.isArray(source.items)) throw new ValidationError('Recovery job items must be an array');
  const items = Object.freeze(source.items.map((item, index) => normalizeEvaluatedItem(item, `Recovery job items[${index}]`)));
  const manifest = validateDeathManifest(source.manifest);
  if (source.deadBotId !== manifest.botId || source.worldKey !== manifest.worldKey || source.dimension !== manifest.dimension) throw new ValidationError('Recovery job scope must match its death manifest', { manifestId: manifest.id });
  return Object.freeze({
    ...structuredClone(source),
    id: identifier(source.id, 'Recovery job id'),
    manifestId: identifier(source.manifestId, 'Recovery job manifestId'),
    manifest,
    deadBotId: identifier(source.deadBotId, 'Recovery job deadBotId'),
    worldKey: scopedString(source.worldKey, 'Recovery job worldKey'),
    dimension: scopedString(source.dimension, 'Recovery job dimension'),
    items,
    recoveryScore: finiteNumber(source.recoveryScore, 0, 100, 'Recovery job recoveryScore'),
    evaluationDecision: recoveryEvaluationDecision(source.evaluationDecision),
    status,
    assignedBotId: source.assignedBotId === null ? null : identifier(source.assignedBotId, 'Recovery job assignedBotId'),
    despawn: normalizeDespawnBudget(source.despawn),
    recoveryAttempts,
    maxAttempts,
    lifecycle,
    createdAt: isoTimestamp(source.createdAt, 'Recovery job createdAt'),
    updatedAt: isoTimestamp(source.updatedAt, 'Recovery job updatedAt')
  });
}

async function transitionRecord(repository, events, current, nextStatus, patch) {
  ensureTransition(current.status, nextStatus, current.id);
  const now = new Date().toISOString();
  const updated = normalizeRecoveryJob(await repository.update(current.id, { ...patch, status: nextStatus, lifecycle: [...current.lifecycle, lifecycleEntry(nextStatus, now)], updatedAt: now }));
  await publish(events, eventName(nextStatus), updated);
  return updated;
}
function normalizeLifecycle(input) {
  if (!Array.isArray(input) || !input.length) throw new ValidationError('Recovery job lifecycle must be a non-empty array');
  return Object.freeze(input.map((entry, index) => {
    const source = requiredRecord(entry, `Recovery job lifecycle[${index}]`);
    return lifecycleEntry(recoveryState(source.state, `Recovery job lifecycle[${index}].state`), isoTimestamp(source.at, `Recovery job lifecycle[${index}].at`));
  }));
}
function normalizeStatuses(input) {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) throw new ValidationError('Recovery job query statuses must be an array');
  return new Set(input.map((status, index) => recoveryState(status, `Recovery job query statuses[${index}]`)));
}
function recoveryEvaluationDecision(value) {
  if (!['RECOVER', 'URGENT_RECOVERY'].includes(value)) throw new ValidationError('Recovery job evaluationDecision must be RECOVER or URGENT_RECOVERY', { value });
  return value;
}
function ensureTransition(currentStatus, nextStatus, jobId) {
  if (!TRANSITIONS.get(currentStatus)?.has(nextStatus)) throw new ConflictError(`Recovery job '${jobId}' cannot transition from '${currentStatus}' to '${nextStatus}'`, { jobId, currentStatus, nextStatus });
}
function invalidTransition(current, nextStatus) { return new ConflictError(`Recovery job '${current.id}' cannot transition from '${current.status}' to '${nextStatus}'`, { jobId: current.id, currentStatus: current.status, nextStatus }); }
function isTerminal(status) { return TERMINAL_STATES.has(status); }
function lifecycleEntry(state, at) { return Object.freeze({ state, at }); }
function eventName(status) {
  const names = { ASSIGNED: 'assigned', TRAVELLING: 'started', VERIFYING: 'verifying', RECOVERED: 'completed', PARTIAL: 'partial', EXPIRED: 'expired', FAILED: 'failed', REASSIGN_REQUIRED: 'reassigned' };
  return `logistics.recovery.${names[status] ?? status.toLowerCase()}`;
}
async function publish(events, type, payload) { if (events) await events.publish(type, payload, { source: 'death-recovery', correlationId: payload.id ?? null }); }
function validateRepository(repository) {
  const source = requiredRecord(repository, 'Recovery job repository');
  for (const method of ['create', 'find', 'update', 'delete', 'list']) if (typeof source[method] !== 'function') throw new ValidationError(`Recovery job repository.${method} must be a function`);
}
function validateEvents(events) { if (events !== undefined && events !== null && (typeof events !== 'object' || typeof events.publish !== 'function')) throw new ValidationError('Recovery events must expose publish(type, payload, options)'); }
function scopedString(value, label) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 255) throw new ValidationError(`${label} must be a non-empty string no longer than 255 characters`, { value }); return value.trim(); }
function boundedMessage(value, label) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 1000) throw new ValidationError(`${label} must be a non-empty string no longer than 1000 characters`, { value }); return value.trim(); }
