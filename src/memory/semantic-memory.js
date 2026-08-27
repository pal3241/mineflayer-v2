import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

const TYPES = new Set(['WORKING', 'SHORT_TERM', 'EPISODIC', 'SEMANTIC', 'PROCEDURAL', 'LONG_TERM']);
const VISIBILITIES = new Set(['PRIVATE', 'TEAM', 'HIVE', 'GLOBAL']);

export function createHashEmbeddingProvider({ dimensions, version }) {
  if (!Number.isInteger(dimensions) || dimensions < 16 || dimensions > 4096) throw new ValidationError('Embedding dimensions must be an integer between 16 and 4096');
  return Object.freeze({ model: 'minehive-hash-embedding', version, dimensions, embed: text => hashEmbedding(text, dimensions) });
}

export function createSemanticMemory({ repository, events, embeddingProvider, maxRecords }) {
  if (!repository || typeof repository.list !== 'function') throw new ValidationError('Semantic memory repository is required');
  if (!embeddingProvider || typeof embeddingProvider.embed !== 'function') throw new ValidationError('Semantic memory embedding provider is required');
  if (!Number.isInteger(maxRecords) || maxRecords < 100) throw new ValidationError('Semantic memory maxRecords must be at least 100');

  const remember = async input => {
    const value = normalizeMemory(input); const vector = embeddingProvider.embed(value.content); const records = await repository.list();
    const duplicate = records.find(record => sameScope(record, value) && record.type === value.type && cosine(record.embedding?.vector, vector) >= 0.97);
    const now = new Date().toISOString();
    const record = duplicate
      ? await repository.update(duplicate.id, { ...value, id: duplicate.id, confidence: Math.max(duplicate.confidence, value.confidence), importance: Math.max(duplicate.importance, value.importance), embedding: embeddingMetadata(embeddingProvider, vector, now), createdAt: duplicate.createdAt, updatedAt: now, version: duplicate.version + 1 })
      : await repository.create({ ...value, id: randomUUID(), embedding: embeddingMetadata(embeddingProvider, vector, now), createdAt: now, updatedAt: now, version: 1 });
    await prune(repository, maxRecords); await events?.publish('memory.semantic.remembered', publicMemory(record), { source: 'semantic-memory' }); return publicMemory(record);
  };

  const search = async query => {
    const text = String(query.text ?? '').trim(); const queryVector = text ? embeddingProvider.embed(text) : null; const now = Date.now(); const limit = boundedInteger(query.limit, 1, 50, 10);
    return (await repository.list()).filter(record => matchesScope(record, query) && (!query.type || record.type === String(query.type).toUpperCase()) && (!query.visibility || record.visibility === String(query.visibility).toUpperCase()))
      .map(record => ({ record, score: scoreMemory(record, queryVector, now) })).sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt)).slice(0, limit).map(({ record, score }) => ({ ...publicMemory(record), relevance: Math.round(score * 10000) / 10000 }));
  };

  const status = async () => { const records = await repository.list(); return { status: 'HEALTHY', count: records.length, maxRecords, embedding: { model: embeddingProvider.model, version: embeddingProvider.version, dimensions: embeddingProvider.dimensions }, byType: Object.fromEntries([...TYPES].map(type => [type, records.filter(record => record.type === type).length])) }; };
  return Object.freeze({ remember, search, forget: id => repository.delete(id), status });
}

function normalizeMemory(input) {
  const content = String(input.content ?? '').trim(); if (!content || content.length > 1000) throw new ValidationError('Semantic memory content must contain 1-1000 characters');
  const type = String(input.type ?? 'SEMANTIC').toUpperCase(); if (!TYPES.has(type)) throw new ValidationError(`Unsupported semantic memory type '${type}'`);
  const visibility = String(input.visibility ?? 'HIVE').toUpperCase(); if (!VISIBILITIES.has(visibility)) throw new ValidationError(`Unsupported semantic memory visibility '${visibility}'`);
  return { type, content, visibility, worldKey: input.worldKey ?? null, dimension: input.dimension ?? null, source: String(input.source ?? 'unknown').slice(0, 80), sourceBotId: input.sourceBotId ?? null, taskId: input.taskId ?? null, confidence: boundedNumber(input.confidence, 0, 1, 0.7), importance: boundedNumber(input.importance, 0, 1, 0.5), tags: [...new Set((input.tags ?? []).map(String))].slice(0, 20), metadata: structuredClone(input.metadata ?? {}), verifiedBy: [...new Set((input.verifiedBy ?? []).map(String))].slice(0, 20) };
}
function hashEmbedding(text, dimensions) { const vector = new Array(dimensions).fill(0); for (const token of tokenize(text)) { const digest = createHash('sha256').update(token).digest(); const index = digest.readUInt32BE(0) % dimensions; vector[index] += (digest[4] & 1) ? 1 : -1; } const magnitude = Math.hypot(...vector) || 1; return vector.map(value => value / magnitude); }
function tokenize(text) { return String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9_ ]/g, ' ').split(/\s+/).filter(token => token.length > 1); }
function cosine(left, right) { if (!Array.isArray(left) || left.length !== right.length) return 0; return left.reduce((sum, value, index) => sum + value * right[index], 0); }
function scoreMemory(record, queryVector, now) { const similarity = queryVector ? Math.max(0, cosine(record.embedding?.vector, queryVector)) : 0.5; const ageDays = Math.max(0, (now - Date.parse(record.updatedAt)) / 86_400_000); const recency = 1 / (1 + ageDays / 30); return similarity * 0.5 + record.importance * 0.2 + record.confidence * 0.2 + recency * 0.1; }
function sameScope(left, right) { return left.worldKey === right.worldKey && left.dimension === right.dimension && left.visibility === right.visibility; }
function matchesScope(record, query) { return (!query.worldKey || record.worldKey === query.worldKey) && (!query.dimension || record.dimension === query.dimension) && (!query.sourceBotId || record.sourceBotId === query.sourceBotId || record.visibility !== 'PRIVATE'); }
function embeddingMetadata(provider, vector, generatedAt) { return { model: provider.model, version: provider.version, dimensions: provider.dimensions, generatedAt, vector }; }
function publicMemory(record) { const { embedding, ...value } = record; return { ...value, embedding: { model: embedding.model, version: embedding.version, dimensions: embedding.dimensions, generatedAt: embedding.generatedAt } }; }
async function prune(repository, maxRecords) { const records = await repository.list(); if (records.length <= maxRecords) return; const removable = records.filter(record => record.importance < 0.9 && record.type !== 'LONG_TERM').sort((left, right) => left.importance - right.importance || left.updatedAt.localeCompare(right.updatedAt)); for (const record of removable.slice(0, records.length - maxRecords)) await repository.delete(record.id); }
function boundedNumber(value, minimum, maximum, fallback) { const number = Number(value ?? fallback); if (!Number.isFinite(number)) throw new ValidationError('Memory numeric field must be finite'); return Math.max(minimum, Math.min(maximum, number)); }
function boundedInteger(value, minimum, maximum, fallback) { const number = Number.parseInt(value ?? fallback, 10); if (!Number.isInteger(number)) throw new ValidationError('Memory limit must be an integer'); return Math.max(minimum, Math.min(maximum, number)); }
