import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

const TYPES = new Set(['WORKING', 'SHORT_TERM', 'EPISODIC', 'SEMANTIC', 'PROCEDURAL', 'LONG_TERM']);
const VISIBILITIES = new Set(['PRIVATE', 'TEAM', 'HIVE', 'GLOBAL']);

export function createHashEmbeddingProvider({ dimensions, version }) {
  if (!Number.isInteger(dimensions) || dimensions < 16 || dimensions > 4096) throw new ValidationError('Embedding dimensions must be an integer between 16 and 4096');
  // Compatibility factory name; the implementation is honest lexical indexing.
  return Object.freeze({
    model: 'minehive-keyword-bm25', version, dimensions: null,
    embed: text => keywordDocument(text),
    isCompatible: value => value?.model === 'minehive-keyword-bm25' && value?.version === version && Array.isArray(value?.terms) && plainFrequencies(value?.frequencies) && Number.isFinite(value?.length),
    similarity: (left, right) => keywordSimilarity(left?.terms, right?.terms)
  });
}

export function createSemanticMemory({ repository, events, embeddingProvider, governance = null, maxRecords, longTermMaxRecords, shortTermMaxRecords, shortTermTtlMs, promotionAccesses, promotionImportance }) {
  if (!repository || typeof repository.list !== 'function') throw new ValidationError('Semantic memory repository is required');
  if (!embeddingProvider || typeof embeddingProvider.embed !== 'function') throw new ValidationError('Semantic memory embedding provider is required');
  if (!Number.isInteger(maxRecords) || maxRecords < 100) throw new ValidationError('Semantic memory maxRecords must be at least 100');
  let policy = normalizePolicy({ maxRecords, longTermMaxRecords, shortTermMaxRecords, shortTermTtlMs, promotionAccesses, promotionImportance });
  let cachePromise = null; let mutationQueue = Promise.resolve();
  const loadRecords = () => { cachePromise ??= repository.list(); return cachePromise; };
  const mutate = operation => { const result = mutationQueue.then(operation); mutationQueue = result.then(() => undefined, () => undefined); return result; };

  const remember = input => mutate(async () => {
    const value = normalizeMemory(input); const representation = embeddingProvider.embed(value.content); let records = await loadRecords();
    const duplicate = records.find(record => sameScope(record, value) && record.type === value.type && keywordSimilarity(recordTerms(record), representation.terms) >= 0.9);
    const now = new Date().toISOString(); const lifecycle = lifecycleFields(value.type, duplicate, now, policy.shortTermTtlMs);
    const record = duplicate
      ? await repository.update(duplicate.id, { ...value, ...lifecycle, id: duplicate.id, confidence: Math.max(duplicate.confidence, value.confidence), importance: Math.max(duplicate.importance, value.importance), embedding: embeddingMetadata(embeddingProvider, representation, now), createdAt: duplicate.createdAt, updatedAt: now, version: duplicate.version + 1, schemaVersion: 2 })
      : await repository.create({ ...value, ...lifecycle, id: randomUUID(), embedding: embeddingMetadata(embeddingProvider, representation, now), createdAt: now, updatedAt: now, version: 1, schemaVersion: 2 });
    await governance?.record({ action: duplicate ? 'UPDATED' : 'CREATED', memoryId: record.id, details: { type: record.type } });
    records = duplicate ? records.map(item => item.id === record.id ? record : item) : [record, ...records]; await events?.publish('memory.semantic.remembered', publicMemory(record), { source: 'semantic-memory' }); cachePromise = Promise.resolve(await prune(repository, records, policy, Date.now(), governance, events)); return publicMemory(record);
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
      if (promotable) { const promotedRecord = await repository.update(record.id, { type: 'LONG_TERM', expiresAt: null, consolidatedAt: now, updatedAt: now, version: record.version + 1, metadata: { ...record.metadata, consolidatedFrom: 'SHORT_TERM' } }); nextRecords.push(promotedRecord); promoted++; await governance?.record({ action: 'PROMOTED', memoryId: record.id, details: { from: 'SHORT_TERM', to: 'LONG_TERM' } }); await events?.publish('memory.promoted', publicMemory(promotedRecord), { source: 'semantic-memory' }); continue; }
      if (isExpired(record, nowMs)) { await repository.delete(record.id); forgotten++; await governance?.record({ action: 'EXPIRED_PURGED', memoryId: record.id, reason: 'short-term-expired' }); await events?.publish('memory.forgotten', { id: record.id, reason: 'short-term-expired' }, { source: 'semantic-memory' }); continue; }
      nextRecords.push(record);
    }
    records = await prune(repository, nextRecords, policy, nowMs, governance, events); cachePromise = Promise.resolve(records); const result = { promoted, forgotten, retained: records.length, consolidatedAt: now };
    await events?.publish('memory.consolidated', result, { source: 'semantic-memory' }); return result;
  });

  const status = async () => { const records = await loadRecords(); const now = Date.now(); const byType = Object.fromEntries([...TYPES].map(type => [type, records.filter(record => record.type === type && !isExpired(record, now)).length])); return { status: records.length > policy.maxRecords || byType.LONG_TERM > policy.longTermMaxRecords ? 'DEGRADED' : 'HEALTHY', count: records.length, activeCount: records.filter(record => !isExpired(record, now)).length, expiredShortTerm: records.filter(record => record.type === 'SHORT_TERM' && isExpired(record, now)).length, maxRecords: policy.maxRecords, policy: { longTermMaxRecords: policy.longTermMaxRecords, shortTermMaxRecords: policy.shortTermMaxRecords, shortTermTtlMs: policy.shortTermTtlMs, promotionAccesses: policy.promotionAccesses, promotionImportance: policy.promotionImportance }, embedding: { model: embeddingProvider.model, version: embeddingProvider.version, dimensions: embeddingProvider.dimensions }, byType }; };
  const all = async () => (await loadRecords()).map(publicMemory);
  const configure = input => mutate(async () => {
    const nextPolicy = configuredPolicy(input); policy = nextPolicy;
    await events?.publish('memory.policy.configured', { maxRecords: policy.maxRecords, longTermMaxRecords: policy.longTermMaxRecords, shortTermMaxRecords: policy.shortTermMaxRecords, shortTermTtlMs: policy.shortTermTtlMs, promotionAccesses: policy.promotionAccesses, promotionImportance: policy.promotionImportance }, { source: 'semantic-memory' });
    return status();
  });
  const forget = id => mutate(async () => { const removed = await repository.delete(id); if (removed) { cachePromise = Promise.resolve((await loadRecords()).filter(record => record.id !== id)); await governance?.record({ action: 'FORGOTTEN', memoryId: id, reason: 'explicit-delete' }); await events?.publish('memory.semantic.forgotten', { id, reason: 'explicit-delete' }, { source: 'semantic-memory', correlationId: id }); } return removed; });
  const rememberShortTerm = input => remember({ ...input, type: 'SHORT_TERM' });
  const rememberLongTerm = input => remember({ ...input, type: 'LONG_TERM', importance: Math.max(0.8, Number(input.importance ?? 0.8)) });
  return Object.freeze({ remember, rememberShortTerm, rememberLongTerm, search, recall, consolidate, forget, status, all, configure });
}

function normalizePolicy({ maxRecords, longTermMaxRecords, shortTermMaxRecords, shortTermTtlMs, promotionAccesses, promotionImportance }) {
  const policy = { maxRecords, longTermMaxRecords: longTermMaxRecords ?? maxRecords, shortTermMaxRecords: shortTermMaxRecords ?? Math.min(1000, maxRecords), shortTermTtlMs: shortTermTtlMs ?? 86_400_000, promotionAccesses: promotionAccesses ?? 3, promotionImportance: promotionImportance ?? 0.8 };
  if (!Number.isInteger(policy.maxRecords) || policy.maxRecords < 100) throw new ValidationError('Semantic memory limit must be at least 100');
  if (!Number.isInteger(policy.shortTermMaxRecords) || policy.shortTermMaxRecords < 1 || policy.shortTermMaxRecords > maxRecords) throw new ValidationError('Short-term memory limit must be between 1 and maxRecords');
  if (!Number.isInteger(policy.longTermMaxRecords) || policy.longTermMaxRecords < 1 || policy.longTermMaxRecords > maxRecords) throw new ValidationError('Long-term memory limit must be between 1 and maxRecords');
  if (!Number.isInteger(policy.shortTermTtlMs) || policy.shortTermTtlMs < 1000) throw new ValidationError('Short-term memory TTL must be at least 1000ms');
  if (!Number.isInteger(policy.promotionAccesses) || policy.promotionAccesses < 1) throw new ValidationError('Memory promotion accesses must be a positive integer');
  if (!Number.isFinite(policy.promotionImportance) || policy.promotionImportance < 0 || policy.promotionImportance > 1) throw new ValidationError('Memory promotion importance must be between 0 and 1');
  return Object.freeze(policy);
}

function configuredPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Memory settings must be an object');
  const fields = ['maxRecords', 'shortTermMaxRecords', 'shortTermTtlMs', 'promotionAccesses', 'promotionImportance'];
  for (const field of fields) if (input[field] === undefined) throw new ValidationError(`Memory setting '${field}' is required`);
  return normalizePolicy({ maxRecords: Number(input.maxRecords), longTermMaxRecords: input.longTermMaxRecords === undefined ? Number(input.maxRecords) : Number(input.longTermMaxRecords), shortTermMaxRecords: Number(input.shortTermMaxRecords), shortTermTtlMs: Number(input.shortTermTtlMs), promotionAccesses: Number(input.promotionAccesses), promotionImportance: Number(input.promotionImportance) });
}

function normalizeMemory(input) {
  const content = String(input.content ?? '').trim(); if (!content || content.length > 1000) throw new ValidationError('Semantic memory content must contain 1-1000 characters');
  const type = String(input.type ?? 'SEMANTIC').toUpperCase(); if (!TYPES.has(type)) throw new ValidationError(`Unsupported semantic memory type '${type}'`);
  const visibility = String(input.visibility ?? 'HIVE').toUpperCase(); if (!VISIBILITIES.has(visibility)) throw new ValidationError(`Unsupported semantic memory visibility '${visibility}'`);
  return { type, content, visibility, worldKey: input.worldKey ?? null, dimension: input.dimension ?? null, source: String(input.source ?? 'unknown').slice(0, 80), sourceBotId: input.sourceBotId ?? null, taskId: input.taskId ?? null, confidence: boundedNumber(input.confidence, 0, 1, 0.7), importance: boundedNumber(input.importance, 0, 1, 0.5), tags: [...new Set((input.tags ?? []).map(String))].slice(0, 20), metadata: structuredClone(input.metadata ?? {}), verifiedBy: [...new Set((input.verifiedBy ?? []).map(String))].slice(0, 20) };
}

function lifecycleFields(type, previous, now, ttlMs) { if (type !== 'SHORT_TERM') return { accessCount: Number(previous?.accessCount ?? 0), lastAccessedAt: previous?.lastAccessedAt ?? null, expiresAt: null, consolidatedAt: previous?.consolidatedAt ?? null }; return { accessCount: Number(previous?.accessCount ?? 0), lastAccessedAt: previous?.lastAccessedAt ?? null, expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(), consolidatedAt: null }; }
function rankRecords(records, query, embeddingProvider, now) { const text = String(query.text ?? '').trim(); const queryTerms=tokenize(text); const limit = boundedInteger(query.limit, 1, 50, 10); const candidates=records.filter(record => !isExpired(record, now) && matchesScope(record, query) && (!query.type || record.type === String(query.type).toUpperCase()) && (!query.visibility || record.visibility === String(query.visibility).toUpperCase())); const lexical=bm25Scores(candidates,queryTerms); return candidates.map(record => ({ record, score: scoreMemory(record, queryTerms.length?lexical.get(record.id)??0:0.5, now) })).sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt)).slice(0, limit); }
function keywordDocument(text){const tokens=tokenize(text),frequencies={};for(const token of tokens)frequencies[token]=(frequencies[token]??0)+1;return {terms:Object.keys(frequencies),frequencies,length:tokens.length};}
function plainFrequencies(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(count=>Number.isInteger(count)&&count>0);}
function tokenize(text) { return String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9_ ]/g, ' ').split(/\s+/).filter(token => token.length > 1); }
function bm25Scores(records,queryTerms){const result=new Map();if(!queryTerms.length)return result;const documents=records.map(record=>({record,index:recordIndex(record)})),average=documents.reduce((sum,item)=>sum+item.index.length,0)/Math.max(1,documents.length);for(const {record,index} of documents){let score=0;for(const term of new Set(queryTerms)){const containing=documents.filter(item=>(item.index.frequencies[term]??0)>0).length,idf=Math.log(1+(documents.length-containing+.5)/(containing+.5)),tf=index.frequencies[term]??0,denominator=tf+1.2*(1-.75+.75*index.length/Math.max(1,average));score+=idf*(tf*2.2)/Math.max(.001,denominator);}result.set(record.id,score/(score+3));}return result;}
function recordIndex(record){const stored=record.embedding;if(stored?.frequencies&&Number.isFinite(stored.length))return {frequencies:stored.frequencies,length:stored.length};return keywordDocument(record.content);}
function recordTerms(record){return record.embedding?.terms??tokenize(record.content);}
function keywordSimilarity(left,right){const a=new Set(left??[]),b=new Set(right??[]);if(!a.size||!b.size)return 0;let overlap=0;for(const term of a)if(b.has(term))overlap++;return overlap/(a.size+b.size-overlap);}
function scoreMemory(record, lexicalScore, now) { const ageDays = Math.max(0, (now - Date.parse(record.updatedAt)) / 86_400_000); const recency = 1 / (1 + ageDays / 30); const accessSignal = Math.min(1, Number(record.accessCount ?? 0) / 10); return lexicalScore * 0.55 + record.importance * 0.18 + record.confidence * 0.17 + recency * 0.07 + accessSignal * 0.03; }
function sameScope(left, right) { return left.worldKey === right.worldKey && left.dimension === right.dimension && left.visibility === right.visibility; }
function matchesScope(record, query) { return (!query.worldKey || record.worldKey === query.worldKey) && (!query.dimension || record.dimension === query.dimension) && (!query.sourceBotId || record.sourceBotId === query.sourceBotId || record.visibility !== 'PRIVATE'); }
function embeddingMetadata(provider, representation, generatedAt) { return { model: provider.model, version: provider.version, dimensions: null, generatedAt, ...representation }; }
function publicMemory(record) { const { embedding, ...value } = record; return { ...value, embedding: { model: embedding.model, version: embedding.version, dimensions: embedding.dimensions, generatedAt: embedding.generatedAt } }; }
function isExpired(record, now) { return record.type === 'SHORT_TERM' && record.expiresAt && Date.parse(record.expiresAt) <= now; }
async function prune(repository, records, policy, now, governance, events) { const expired = records.filter(record => isExpired(record, now) && record.importance < policy.promotionImportance); const expiredIds = new Set(expired.map(record => record.id)); const shortTerm = records.filter(record => record.type === 'SHORT_TERM' && !expiredIds.has(record.id)).sort(retentionOrder); const excessShortTerm = shortTerm.slice(0, Math.max(0, shortTerm.length - policy.shortTermMaxRecords)); const longTerm = records.filter(record => record.type === 'LONG_TERM').sort(retentionOrder); const excessLongTerm = longTerm.slice(0, Math.max(0, longTerm.length - policy.longTermMaxRecords)); const initialRemoved = new Set([...expired, ...excessShortTerm, ...excessLongTerm].map(record => record.id)); const removable = records.filter(record => record.type !== 'LONG_TERM' && !initialRemoved.has(record.id)).sort(retentionOrder).slice(0, Math.max(0, records.length - initialRemoved.size - policy.maxRecords)); const removed = new Set([...initialRemoved, ...removable.map(record => record.id)]); for (const record of records) if (removed.has(record.id)) { const reason = excessLongTerm.some(item => item.id === record.id) ? 'long-term-limit' : expiredIds.has(record.id) ? 'short-term-expired' : 'retention-limit'; if (record.type === 'LONG_TERM') await governance?.archive(record, reason); else await governance?.record({ action: 'RETENTION_EVICTED', memoryId: record.id, reason }); await repository.delete(record.id); await events?.publish('memory.semantic.forgotten', { id: record.id, type: record.type, reason }, { source: 'semantic-memory', correlationId: record.id }); } return records.filter(record => !removed.has(record.id)); }
function retentionOrder(left, right) { return left.importance - right.importance || Number(left.accessCount ?? 0) - Number(right.accessCount ?? 0) || left.updatedAt.localeCompare(right.updatedAt); }
function boundedNumber(value, minimum, maximum, fallback) { const number = Number(value ?? fallback); if (!Number.isFinite(number)) throw new ValidationError('Memory numeric field must be finite'); return Math.max(minimum, Math.min(maximum, number)); }
function boundedInteger(value, minimum, maximum, fallback) { const number = Number.parseInt(value ?? fallback, 10); if (!Number.isInteger(number)) throw new ValidationError('Memory limit must be an integer'); return Math.max(minimum, Math.min(maximum, number)); }
function round(value) { return Math.round(value * 10000) / 10000; }
