import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository, createHashEmbeddingProvider, createMemoryGovernanceService, createSemanticMemory } from '../src/index.js';

function fixture() {
  const memory = new MemoryRepository(); const audit = new MemoryRepository(); const quarantine = new MemoryRepository(); const archive = new MemoryRepository(); const embeddingProvider = createHashEmbeddingProvider({ dimensions: 16, version: 'test' });
  const governance = createMemoryGovernanceService({ repositories: { memory, audit, quarantine, archive }, embeddingProvider, shortTermTtlMs: 60_000 });
  return { memory, audit, quarantine, archive, embeddingProvider, governance };
}

test('governance migrates recoverable legacy memory and is idempotent after restart', async () => {
  const value = fixture(); await value.memory.create({ id: 'legacy', type: 'long_term', content: 'lokasi base utama', visibility: 'hive', importance: 0.9 });
  const first = await value.governance.initialize(); assert.equal(first.migrated, 1); const migrated = await value.memory.find('legacy'); assert.equal(migrated.schemaVersion, 1); assert.equal(migrated.embedding.vector.length, 16); assert.equal(migrated.type, 'LONG_TERM');
  const second = await value.governance.initialize(); assert.equal(second.migrated, 0); assert.equal(second.valid, 1); assert.equal((await value.audit.list()).filter(item => item.action === 'SCHEMA_MIGRATED').length, 1);
});

test('governance quarantines irreparable records and purges expired short-term records', async () => {
  const value = fixture(); await value.memory.create({ id: 'broken', type: 'NOPE', content: '' }); await value.memory.create({ id: 'expired', type: 'SHORT_TERM', content: 'sementara', visibility: 'HIVE', expiresAt: '2020-01-01T00:00:00.000Z' });
  const result = await value.governance.initialize(); assert.equal(result.quarantined, 1); assert.equal(result.expiredPurged, 1); assert.equal((await value.memory.list()).length, 0); assert.equal((await value.quarantine.list())[0].memoryId, 'broken');
  assert.deepEqual(new Set((await value.audit.list()).map(item => item.action)), new Set(['CORRUPT_QUARANTINED', 'EXPIRED_PURGED']));
});

test('long-term retention archives the weakest memory and audits lifecycle operations', async () => {
  const value = fixture(); const semantic = createSemanticMemory({ repository: value.memory, governance: value.governance, embeddingProvider: value.embeddingProvider, maxRecords: 100, longTermMaxRecords: 2, shortTermMaxRecords: 10, shortTermTtlMs: 60_000, promotionAccesses: 2, promotionImportance: 0.9 });
  await semantic.rememberLongTerm({ content: 'weak memory', importance: 0.8 }); await semantic.rememberLongTerm({ content: 'strong memory', importance: 1 }); await semantic.rememberLongTerm({ content: 'middle memory', importance: 0.9 });
  const retained = await semantic.search({ text: '', type: 'LONG_TERM', limit: 10 }); assert.equal(retained.length, 2); assert.ok(retained.every(item => item.content !== 'weak memory')); assert.equal((await value.archive.list())[0].record.content, 'weak memory');
  const temporary = await semantic.rememberShortTerm({ content: 'promote this', importance: 1 }); await semantic.consolidate(); await semantic.forget(temporary.id);
  const actions = new Set((await value.audit.list()).map(item => item.action)); assert.ok(actions.has('CREATED')); assert.ok(actions.has('RETENTION_ARCHIVED')); assert.ok(actions.has('PROMOTED')); assert.ok(actions.has('FORGOTTEN'));
});
