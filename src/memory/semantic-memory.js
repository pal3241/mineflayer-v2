import { createHash, randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

const TYPES = new Set(['WORKING', 'SHORT_TERM', 'EPISODIC', 'SEMANTIC', 'PROCEDURAL', 'LONG_TERM']);
const VISIBILITIES = new Set(['PRIVATE', 'TEAM', 'HIVE', 'GLOBAL']);

export function createHashEmbeddingProvider({ dimensions, version }) {
  if (!Number.isInteger(dimensions) || dimensions < 16 || dimensions > 4096) throw new ValidationError('Embedding dimensions must be an integer between 16 and 4096');
  return Object.freeze({ model: 'minehive-hash-embedding', version, dimensions, embed: text => hashEmbedding(text, dimensions) });
}

export function createSemanticMemory({ repository, events, embeddingProvider, maxRecords, shortTermMaxRecords, shortTermTtlMs, promotionAccesses, promotionImportance }) {
  if (!repository || typeof repository.list !== 'function') throw new ValidationError('Semantic memory repository is required');
  if (!embeddingProvider || typeof embeddingProvider.embed !== 'function') throw new ValidationError('Semantic memory embedding provider is required');
  if (!Number.isInteger(maxRecords) || maxRecords < 100) throw new ValidationError('Semantic memory maxRecords must be at least 100');
  const policy = normalizePolicy({ maxRecords, shortTermMaxRecords, shortTermTtlMs, promotionAccesses, promotionImportance });
  let cachePromise = null; let mutationQueue = Promise.resolve();
  const loadRecords = () => { cachePromise ??= repository.list(); return cachePromise; };
  const mutate = operation => { const result = mutationQueue.then(operation); mutationQueue = result.then(() => undefined, () => undefined); return result; };

  const remember = input => mutate(async () => {
    const value = normalizeMemory(input); const vector = embeddingProvider.embed(value.content); let records = await loadRecords();
    const duplicate = records.find(record => sameScope(record, value) && record.type === value.type && cosine(record.embedding?.vector, vector) >= 0.97);
    const now = new Date().toISOString(); const lifecycle = lifecycleFields(value.type, duplicate, now, policy.shortTermTtlMs);
    const record = duplicate
      ? await repository.update(duplicate.id, { ...value, ...lifecycle, id: duplicate.id, confidence: Math.max(duplicate.confidence, value.confidence), importance: Math.max(duplicate.importance, value.importance), embedding: embeddingMetadata(embeddingProvider, vector, now), createdAt: duplicate.createdAt, updatedAt: now, version: duplicate.version + 1 })
      : await repository.create({ ...value, ...lifecycle, id: randomUUID(), embedding: embeddingMetadata(embeddingProvider, vector, now), createdAt: now, updatedAt: now, version: 1 });
    records = duplicate ? records.map(item => item.id === record.id ? record : item) : [record, ...records]; cachePromise = Promise.resolve(await prune(repository, records, policy, Date.now()));
    await events?.publish('memory.semantic.remembered', publicMemory(record), { source: 'semantic-memory' }); return publicMemory(record);
  });

  const search = async query => rankRecords(await loadRecords(), query, embeddingProvider, Date.now()).map(({ record, score }) => ({ ...publicMemory(record), relevance: round(score) }));
  const recall = query => mutate(async () => {
    let records = await loadRecords(); const ranked = rankRecords(records, query, embeddingProvider, Date.now()); const accessedAt = new Date().toISOString(); const updated = new Map();
    for (const { record } of ranked) {
      if (record.type !== 'SHORT_TERM') continue;
      const next = await repository.update(record.id, { accessCount: Number(record.accessCount ?? 0) + 1, lastAccessedAt: accessedAt, updatedAt: accessedAt, version: record.version + 1 }); updated.set(record.id, next);
    }
    if (updated.size) { records = records.map(record => updated.get(record.id) ?? record); cachePromise = Promise.resolve(records); }
    return ranked.map(({ record, score }) => ({ ...publicMemory(updated.get(record.id) ?? record), relevance: round(score) }));
  });

  const consolidate = () => mutate(async () => {
    let records = await loadRecords(); const nowMs = Date.now(); const now = new Date(nowMs).toISOString(); let promoted = 0; let forgotten = 0; const nextRecords = [];
    for (const record of records) {
      if (record.type !== 'SHORT_TERM') { nextRecords.push(record); continue; }
      const promotable = record.importance >= policy.promotionImportance || Number(record.accessCount ?? 0) >= policy.promotionAccesses;
      if (promotable) { const promotedRecord = await repository.update(record.id, { type: 'LONG_TERM', expiresAt: null, consolidatedAt: now, updatedAt: now, version: record.version + 1, metadata: { ...record.metadata, consolidatedFrom: 'SHORT_TERM' } }); nextRecords.push(promotedRecord); promoted++; await events?.publish('memory.promoted', publicMemory(promotedRecord), { source: 'semantic-memory' }); continue; }
      if (isExpired(record, nowMs)) { await repository.delete(record.id); forgotten++; await events?.publish('memory.forgotten', { id: record.id, reason: 'short-term-expired' }, { source: 'semantic-memory' }); continue; }
      nextRecords.push(record);
    }
    records = await prune(repository, nextRecords, policy, nowMs); cachePromise = Promise.resolve(records); const result = { promoted, forgotten, retained: records.length, consolidatedAt: now };
    await events?.publish('memory.consolidated', result, { source: 'semantic-memory' }); return result;
  });

  const status = async () => { const records = await loadRecords(); const now = Date.now(); const byType = Object.fromEntries([...TYPES].map(type => [type, records.filter(record => record.type === type && !isExpired(record, now)).length])); return { status: records.length > policy.maxRecords ? 'DEGRADED' : 'HEALTHY', count: records.length, activeCount: records.filter(record => !isExpired(record, now)).length, expiredShortTerm: records.filter(record => record.type === 'SHORT_TERM' && isExpired(record, now)).length, maxRecords: policy.maxRecords, policy: { shortTermMaxRecords: policy.shortTermMaxRecords, shortTermTtlMs: policy.shortTermTtlMs, promotionAccesses: policy.promotionAccesses, promotionImportance: policy.promotionImportance }, embedding: { model: embeddingProvider.model, version: embeddingProvider.version, dimensions: embeddingProvider.dimensions }, byType }; };
  const forget = id => mutate(async () => { const removed = await repository.delete(id); if (removed) cachePromise = Promise.resolve((await loadRecords()).filter(record => record.id !== id)); return removed; });
  const rememberShortTerm = input => remember({ ...input, type: 'SHORT_TERM' });
  const rememberLongTerm = input => remember({ ...input, type: 'LONG_TERM', importance: Math.max(0.8, Number(input.importance ?? 0.8)) });
  return Object.freeze({ remember, rememberShortTerm, rememberLongTerm, search, recall, consolidate, forget, status });
}

function normalizePolicy({ maxRecords, shortTermMaxRecords, shortTermTtlMs, promotionAccesses, promotionImportance }) {
  const policy = { maxRecords, shortTermMaxRecords: shortTermMaxRecords ?? Math.min(1000, maxRecords), shortTermTtlMs: shortTermTtlMs ?? 86_400_000, promotionAccesses: promotionAccesses ?? 3, promotionImportance: promotionImportance ?? 0.8 };
  if (!Number.isInteger(policy.shortTermMaxRecords) || policy.shortTermMaxRecords < 1 || policy.shortTermMaxRecords > maxRecords) throw new ValidationError('Short-term memory limit must be between 1 and maxRecords');
  if (!Number.isInteger(policy.shortTermTtlMs) || policy.shortTermTtlMs < 1000) throw new ValidationError('Short-term memory TTL must be at least 1000ms');
  if (!Number.isInteger(policy.promotionAccesses) || policy.promotionAccesses < 1) throw new ValidationError('Memory promotion accesses must be a positive integer');
  if (!Number.isFinite(policy.promotionImportance) || policy.promotionImportance < 0 || policy.promotionImportance > 1) throw new ValidationError('Memory promotion importance must be between 0 and 1');
  return Object.freeze(policy);
}

function normalizeMemory(input) {
  const content = String(input.content ?? '').trim(); if (!content || content.length > 1000) throw new ValidationError('Semantic memory content must contain 1-1000 characters');
  const type = String(input.type ?? 'SEMANTIC').toUpperCase(); if (!TYPES.has(type)) throw new ValidationError(`Unsupported semantic memory type '${type}'`);
  const visibility = String(input.visibility ?? 'HIVE').toUpperCase(); if (!VISIBILITIES.has(visibility)) throw new ValidationError(`Unsupported semantic memory visibility '${visibility}'`);
  return { type, content, visibility, worldKey: input.worldKey ?? null, dimension: input.dimension ?? null, source: String(input.source ?? 'unknown').slice(0, 80), sourceBotId: input.sourceBotId ?? null, taskId: input.taskId ?? null, confidence: boundedNumber(input.confidence, 0, 1, 0.7), importance: boundedNumber(input.importance, 0, 1, 0.5), tags: [...new Set((input.tags ?? []).map(String))].slice(0, 20), metadata: structuredClone(input.metadata ?? {}), verifiedBy: [...new Set((input.verifiedBy ?? []).map(String))].slice(0, 20) };
}

function lifecycleFields(type, previous, now, ttlMs) { if (type !== 'SHORT_TERM') return { accessCount: Number(previous?.accessCount ?? 0), lastAccessedAt: previous?.lastAccessedAt ?? null, expiresAt: null, consolidatedAt: previous?.consolidatedAt ?? null }; return { accessCount: Number(previous?.accessCount ?? 0), lastAccessedAt: previous?.lastAccessedAt ?? null, expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(), consolidatedAt: null }; }
function rankRecords(records, query, embeddingProvider, now) { const text = String(query.text ?? '').trim(); const queryVector = text ? embeddingProvider.embed(text) : null; const limit = boundedInteger(query.limit, 1, 50, 10); return records.filter(record => !isExpired(record, now) && matchesScope(record, query) && (!query.type || record.type === String(query.type).toUpperCase()) && (!query.visibility || record.visibility === String(query.visibility).toUpperCase())).map(record => ({ record, score: scoreMemory(record, queryVector, now) })).sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt)).slice(0, limit); }
function hashEmbedding(text, dimensions) { const vector = new Array(dimensions).fill(0); for (const token of tokenize(text)) { const digest = createHash('sha256').update(token).digest(); const index = digest.readUInt32BE(0) % dimensions; vector[index] += (digest[4] & 1) ? 1 : -1; } const magnitude = Math.hypot(...vector) || 1; return vector.map(value => value / magnitude); }
function tokenize(text) { return String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9_ ]/g, ' ').split(/\s+/).filter(token => token.length > 1); }
function cosine(left, right) { if (!Array.isArray(left) || left.length !== right.length) return 0; return left.reduce((sum, value, index) => sum + value * right[index], 0); }
function scoreMemory(record, queryVector, now) { const similarity = queryVector ? Math.max(0, cosine(record.embedding?.vector, queryVector)) : 0.5; const ageDays = Math.max(0, (now - Date.parse(record.updatedAt)) / 86_400_000); const recency = 1 / (1 + ageDays / 30); const accessSignal = Math.min(1, Number(record.accessCount ?? 0) / 10); return similarity * 0.45 + record.importance * 0.2 + record.confidence * 0.2 + recency * 0.1 + accessSignal * 0.05; }
function sameScope(left, right) { return left.worldKey === right.worldKey && left.dimension === right.dimension && left.visibility === right.visibility; }
function matchesScope(record, query) { return (!query.worldKey || record.worldKey === query.worldKey) && (!query.dimension || record.dimension === query.dimension) && (!query.sourceBotId || record.sourceBotId === query.sourceBotId || record.visibility !== 'PRIVATE'); }
function embeddingMetadata(provider, vector, generatedAt) { return { model: provider.model, version: provider.version, dimensions: provider.dimensions, generatedAt, vector }; }
function publicMemory(record) { const { embedding, ...value } = record; return { ...value, embedding: { model: embedding.model, version: embedding.version, dimensions: embedding.dimensions, generatedAt: embedding.generatedAt } }; }
function isExpired(record, now) { return record.type === 'SHORT_TERM' && record.expiresAt && Date.parse(record.expiresAt) <= now; }
async function prune(repository, records, policy, now) { const expired = records.filter(record => isExpired(record, now) && record.importance < policy.promotionImportance); const expiredIds = new Set(expired.map(record => record.id)); const shortTerm = records.filter(record => record.type === 'SHORT_TERM' && !expiredIds.has(record.id)).sort((left, right) => left.importance - right.importance || Number(left.accessCount ?? 0) - Number(right.accessCount ?? 0) || left.updatedAt.localeCompare(right.updatedAt)); const excessShortTerm = shortTerm.slice(0, Math.max(0, shortTerm.length - policy.shortTermMaxRecords)); const initialRemoved = new Set([...expired, ...excessShortTerm].map(record => record.id)); const removable = records.filter(record => record.type !== 'LONG_TERM' && !initialRemoved.has(record.id)).sort((left, right) => left.importance - right.importance || left.updatedAt.localeCompare(right.updatedAt)).slice(0, Math.max(0, records.length - initialRemoved.size - policy.maxRecords)); const removed = new Set([...initialRemoved, ...removable.map(record => record.id)]); for (const record of records) if (removed.has(record.id)) await repository.delete(record.id); return records.filter(record => !removed.has(record.id)); }
function boundedNumber(value, minimum, maximum, fallback) { const number = Number(value ?? fallback); if (!Number.isFinite(number)) throw new ValidationError('Memory numeric field must be finite'); return Math.max(minimum, Math.min(maximum, number)); }
function boundedInteger(value, minimum, maximum, fallback) { const number = Number.parseInt(value ?? fallback, 10); if (!Number.isInteger(number)) throw new ValidationError('Memory limit must be an integer'); return Math.max(minimum, Math.min(maximum, number)); }
function round(value) { return Math.round(value * 10000) / 10000; }
