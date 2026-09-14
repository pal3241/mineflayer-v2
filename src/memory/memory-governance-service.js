import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

const SCHEMA_VERSION = 1;
const TYPES = new Set(['WORKING', 'SHORT_TERM', 'EPISODIC', 'SEMANTIC', 'PROCEDURAL', 'LONG_TERM']);
const VISIBILITIES = new Set(['PRIVATE', 'TEAM', 'HIVE', 'GLOBAL']);

export function createMemoryGovernanceService({ repositories, embeddingProvider, shortTermTtlMs = 86_400_000 }) {
  const { memory, audit, quarantine, archive } = repositories ?? {};
  if (![memory, audit, quarantine, archive].every(repository => repository && typeof repository.list === 'function')) throw new ValidationError('Memory governance repositories are required');
  if (!embeddingProvider || typeof embeddingProvider.embed !== 'function') throw new ValidationError('Memory governance embedding provider is required');
  let lastScan = null;

  const record = async ({ action, memoryId = null, reason = null, details = {} }) => audit.create({ id: randomUUID(), action, memoryId, reason, details: structuredClone(details), occurredAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION });
  const archiveRecord = async (value, reason) => { const archived = await archive.create({ id: randomUUID(), memoryId: value.id, reason, record: structuredClone(value), archivedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION }); await record({ action: 'RETENTION_ARCHIVED', memoryId: value.id, reason }); return archived; };

  const initialize = async () => {
    const result = { scanned: 0, valid: 0, migrated: 0, quarantined: 0, expiredPurged: 0, startedAt: new Date().toISOString(), completedAt: null };
    for (const original of await memory.list()) {
      result.scanned++;
      const migration = migrate(original, embeddingProvider, shortTermTtlMs);
      if (!migration.valid) {
        await quarantine.create({ id: randomUUID(), memoryId: original?.id ?? null, reasons: migration.reasons, record: structuredClone(original), quarantinedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION });
        if (original?.id != null) await memory.delete(original.id);
        await record({ action: 'CORRUPT_QUARANTINED', memoryId: original?.id ?? null, reason: migration.reasons.join('; ') }); result.quarantined++; continue;
      }
      if (migration.expired) { await memory.delete(original.id); await record({ action: 'EXPIRED_PURGED', memoryId: original.id, reason: 'short-term-expired-on-startup' }); result.expiredPurged++; continue; }
      if (migration.changed) { await memory.update(original.id, migration.value); await record({ action: 'SCHEMA_MIGRATED', memoryId: original.id, details: { schemaVersion: SCHEMA_VERSION } }); result.migrated++; }
      else result.valid++;
    }
    result.completedAt = new Date().toISOString(); lastScan = result; return structuredClone(result);
  };
  const list = async (repository, limit = 100) => (await repository.list()).sort((left, right) => String(right.occurredAt ?? right.quarantinedAt ?? right.archivedAt).localeCompare(String(left.occurredAt ?? left.quarantinedAt ?? left.archivedAt))).slice(0, boundedLimit(limit));
  const status = async () => { const [memories, audits, quarantined, archived] = await Promise.all([memory.list(), audit.list(), quarantine.list(), archive.list()]); return { status: quarantined.length ? 'DEGRADED' : 'HEALTHY', schemaVersion: SCHEMA_VERSION, memories: memories.length, auditRecords: audits.length, quarantined: quarantined.length, archived: archived.length, lastScan: structuredClone(lastScan) }; };
  return Object.freeze({ initialize, record, archive: archiveRecord, status, audit: limit => list(audit, limit), quarantine: limit => list(quarantine, limit), archived: limit => list(archive, limit) });
}

function migrate(original, provider, ttlMs) {
  const reasons = [];
  if (!original || typeof original !== 'object' || Array.isArray(original)) return { valid: false, reasons: ['record must be an object'] };
  if (typeof original.id !== 'string' || !original.id.trim()) reasons.push('id is missing');
  const type = String(original.type ?? '').toUpperCase(); if (!TYPES.has(type)) reasons.push('unsupported type');
  const content = typeof original.content === 'string' ? original.content.trim() : ''; if (!content || content.length > 1000) reasons.push('content must contain 1-1000 characters');
  const visibility = String(original.visibility ?? 'HIVE').toUpperCase(); if (!VISIBILITIES.has(visibility)) reasons.push('unsupported visibility');
  if (reasons.length) return { valid: false, reasons };
  const now = new Date().toISOString(); const createdAt = validDate(original.createdAt) ? original.createdAt : now; const updatedAt = validDate(original.updatedAt) ? original.updatedAt : createdAt;
  const embeddingValid = original.embedding?.dimensions === provider.dimensions && Array.isArray(original.embedding?.vector) && original.embedding.vector.length === provider.dimensions && original.embedding.vector.every(Number.isFinite);
  const vector = embeddingValid ? original.embedding.vector : provider.embed(content);
  const expiresAt = type === 'SHORT_TERM' ? (validDate(original.expiresAt) ? original.expiresAt : new Date(Date.parse(updatedAt) + ttlMs).toISOString()) : null;
  const value = { ...original, id: original.id, type, content, visibility, confidence: bounded(original.confidence, 0.7), importance: bounded(original.importance, 0.5), tags: strings(original.tags), verifiedBy: strings(original.verifiedBy), metadata: plainObject(original.metadata), accessCount: nonNegativeInteger(original.accessCount), lastAccessedAt: validDate(original.lastAccessedAt) ? original.lastAccessedAt : null, expiresAt, consolidatedAt: validDate(original.consolidatedAt) ? original.consolidatedAt : null, createdAt, updatedAt, version: positiveInteger(original.version), schemaVersion: SCHEMA_VERSION, embedding: { model: provider.model, version: provider.version, dimensions: provider.dimensions, generatedAt: embeddingValid && validDate(original.embedding.generatedAt) ? original.embedding.generatedAt : now, vector } };
  return { valid: true, value, expired: type === 'SHORT_TERM' && Date.parse(expiresAt) <= Date.now(), changed: JSON.stringify(value) !== JSON.stringify(original), reasons: [] };
}
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function bounded(value, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback; }
function positiveInteger(value) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : 1; }
function nonNegativeInteger(value) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : 0; }
function strings(value) { return Array.isArray(value) ? [...new Set(value.map(String))].slice(0, 20) : []; }
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {}; }
function boundedLimit(value) { const number = Number.parseInt(value, 10); return Number.isInteger(number) ? Math.max(1, Math.min(500, number)) : 100; }
