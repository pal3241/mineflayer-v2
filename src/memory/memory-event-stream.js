import { createHash } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.js';

export function createMemoryEventStream({ repository, checkpointRepository, events, maxRecords = 50_000 }) {
  if (!repository || !checkpointRepository || !events) throw new ValidationError('Memory event stream repositories and event bus are required');
  if (!Number.isInteger(maxRecords) || maxRecords < 100) throw new ValidationError('Memory event stream maxRecords must be at least 100');
  let initialized = false; let integrity = { valid: true, errors: [] }; let lastError = null; let queue = Promise.resolve();
  const mutate = operation => { const result = queue.then(operation); queue = result.then(() => undefined, () => undefined); return result; };

  const append = event => mutate(async () => {
    try {
      validateEvent(event);
      const records = ordered(await repository.list()); const duplicate = records.find(item => item.eventId === event.id); if (duplicate) return publicEvent(duplicate);
      const previous = records.at(-1) ?? null; const sequence = Number(previous?.sequence ?? 0) + 1; const value = { eventId: event.id, sequence, type: event.type, layer: layerOf(event), source: event.source, timestamp: event.timestamp, correlationId: event.correlationId, payload: structuredClone(event.payload), schemaVersion: 1, previousHash: previous?.hash ?? null }; const record = { ...value, id: event.id, hash: digest(value) };
      const saved = await repository.create(record); await prune(); lastError = null; return publicEvent(saved);
    } catch (error) { lastError = error.message; throw error; }
  });
  const query = async (input = {}) => { const after = boundedSequence(input.afterSequence, 0); const before = input.beforeSequence == null ? Number.MAX_SAFE_INTEGER : boundedSequence(input.beforeSequence, 0); const types = list(input.types); const layers = list(input.layers); const limit = boundedLimit(input.limit, 100); await queue; return ordered(await repository.list()).filter(item => item.sequence > after && item.sequence <= before && (!types.length || types.includes(item.type)) && (!layers.length || layers.includes(item.layer)) && (!input.correlationId || item.correlationId === input.correlationId)).slice(0, limit).map(publicEvent); };
  const replay = async input => { if (!integrity.valid) throw new ConflictError('Memory event stream integrity check failed'); return query({ afterSequence: input?.afterSequence ?? 0, beforeSequence: input?.toSequence, types: input?.types, layers: input?.layers, correlationId: input?.correlationId, limit: input?.limit ?? 1000 }); };
  const checkpoint = (consumerId, sequence) => mutate(async () => { const id = safeConsumer(consumerId); const next = boundedSequence(sequence, 0); const records = ordered(await repository.list()); const latest = Number(records.at(-1)?.sequence ?? 0); if (next > latest) throw new ValidationError('Memory stream checkpoint cannot exceed latest sequence'); const existing = (await checkpointRepository.list()).find(item => item.id === id); if (existing && next < existing.sequence) throw new ConflictError(`Memory stream checkpoint '${id}' cannot move backwards`, { currentSequence: existing.sequence, requestedSequence: next }); const now = new Date().toISOString(); const value = { id, sequence: next, updatedAt: now, createdAt: existing?.createdAt ?? now, schemaVersion: 1 }; return existing ? checkpointRepository.update(id, value) : checkpointRepository.create(value); });
  const getCheckpoint = async consumerId => { const id = safeConsumer(consumerId); await queue; const item = (await checkpointRepository.list()).find(value => value.id === id); if (!item) throw new NotFoundError('Memory stream checkpoint', id); return item; };
  const readFromCheckpoint = async (consumerId, input = {}) => { const value = await getCheckpoint(consumerId); return query({ ...input, afterSequence: value.sequence }); };
  const initialize = async () => { const records = ordered(await repository.list()); integrity = validate(records); initialized = true; return { scanned: records.length, ...integrity }; };
  const status = async () => { await queue; const records = ordered(await repository.list()); const checkpoints = await checkpointRepository.list(); return { status: integrity.valid && !lastError ? 'HEALTHY' : 'DEGRADED', initialized, count: records.length, maxRecords, earliestSequence: records[0]?.sequence ?? null, latestSequence: records.at(-1)?.sequence ?? 0, checkpoints: checkpoints.length, integrity: structuredClone(integrity), lastError }; };
  const prune = async () => { const records = ordered(await repository.list()); for (const item of records.slice(0, Math.max(0, records.length - maxRecords))) await repository.delete(item.id); };
  const unsubscribe = events.subscribe('*', event => event.type.startsWith('memory.') && !event.type.startsWith('memory.stream.') ? append(event) : null);
  const dispose = () => unsubscribe();
  return Object.freeze({ initialize, append, query, replay, checkpoint, getCheckpoint, readFromCheckpoint, status, dispose });
}

function validate(records) { const errors = []; const sequences = new Set(); for (let index = 0; index < records.length; index++) { const item = records[index]; if (!Number.isInteger(item.sequence) || item.sequence < 1 || sequences.has(item.sequence)) errors.push({ id: item.id, code: 'INVALID_SEQUENCE' }); sequences.add(item.sequence); if (index && item.sequence !== records[index - 1].sequence + 1) errors.push({ id: item.id, code: 'SEQUENCE_GAP' }); if (index && item.previousHash !== records[index - 1].hash) errors.push({ id: item.id, code: 'HASH_CHAIN_BROKEN' }); const { hash, id, ...value } = item; if (hash !== digest(value)) errors.push({ id, code: 'HASH_MISMATCH' }); } return { valid: errors.length === 0, errors: errors.slice(0, 100) }; }
function digest(value) { return createHash('sha256').update(stable(value)).digest('hex'); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function layerOf(event) { const value = event.type.split('.')[1] ?? event.source; return value === 'promoted' || value === 'forgotten' || value === 'consolidated' || value === 'policy' ? 'semantic' : value; }
function publicEvent(record) { return structuredClone(record); }
function ordered(records) { return [...records].sort((left, right) => left.sequence - right.sequence); }
function boundedSequence(value, fallback) { const number = Number(value ?? fallback); if (!Number.isInteger(number) || number < 0) throw new ValidationError('Memory stream sequence must be a non-negative integer'); return number; }
function boundedLimit(value, fallback) { const number = Number(value ?? fallback); if (!Number.isInteger(number) || number < 1 || number > 5000) throw new ValidationError('Memory stream limit must be between 1 and 5000'); return number; }
function list(value) { if (value == null || value === '') return []; const source = Array.isArray(value) ? value : String(value).split(','); return [...new Set(source.map(String).map(item => item.trim()).filter(Boolean))].slice(0, 50); }
function safeConsumer(value) { const text = String(value ?? '').trim(); if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(text)) throw new ValidationError('Memory stream consumerId must contain 1-128 safe characters'); return text; }
function validateEvent(event) { if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id || typeof event.type !== 'string' || !event.type.startsWith('memory.') || typeof event.source !== 'string' || !event.source || !Number.isFinite(Date.parse(event.timestamp)) || typeof event.correlationId !== 'string' || !event.correlationId) throw new ValidationError('Memory stream event envelope is invalid'); }
