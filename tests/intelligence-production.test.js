import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventBus, MemoryRepository, RotatingLogStore, SqliteDatabase, createAdaptiveModel, createApplication, createAutonomyService, createHashEmbeddingProvider, createHiveService, createSemanticMemory } from '../src/index.js';

test('SQLite production repository migrates, persists, and creates a verified backup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'minehive-sqlite-')); const database = new SqliteDatabase({ file: join(directory, 'minehive.sqlite') });
  try {
    const repository = database.repository('integration'); await repository.create({ id: 'record-one', value: 1 }); await repository.update('record-one', { value: 2 }); assert.equal((await repository.find('record-one')).value, 2); assert.equal(database.health().status, 'HEALTHY');
    const destination = join(directory, 'backups', 'snapshot.sqlite'); await database.backup(destination); await access(destination);
  } finally { database.close(); await rm(directory, { recursive: true, force: true }); }
});

test('production profile starts with secured SQLite health and shuts down cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'minehive-production-')); const app = createApplication({ env: { MINEHIVE_PROFILE: 'production', MINEHIVE_API_TOKEN: 'production-test-token', MINEHIVE_DATABASE_DRIVER: 'sqlite', MINEHIVE_DATABASE_FILE: join(directory, 'minehive.sqlite'), MINEHIVE_DATA_PATH: directory, MINEHIVE_LOG_LEVEL: 'silent' } });
  try { await app.initialize(); const health = await app.health.check(); assert.equal(health.checks.database.status, 'HEALTHY'); assert.equal(health.checks.database.schemaVersion, 1); }
  finally { await app.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('saved logs retain only the three newest sessions without blocking writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'minehive-logs-'));
  try { const stores = []; for (let index = 0; index < 4; index++) { const store = new RotatingLogStore({ directory, maxFiles: 3 }); store.write({ level: 'info', event: 'test' }); await store.flush(); stores.push(store); } const files = stores.at(-1).list(); assert.equal(files.length, 3); assert.equal(files.some(file => file.name === stores.at(-1).name), true); assert.equal(stores.at(-1).read(stores.at(-1).name, 10)[0].event, 'test'); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('semantic memory ranks relevant knowledge and preserves provenance', async () => {
  const memory = createSemanticMemory({ repository: new MemoryRepository(), events: new EventBus(), embeddingProvider: createHashEmbeddingProvider({ dimensions: 64, version: 'test' }), maxRecords: 100 });
  await memory.remember({ type: 'SEMANTIC', content: 'desa oak berada dekat sungai', visibility: 'HIVE', worldKey: 'localhost:25565', dimension: 'overworld', source: 'bot-observation', sourceBotId: 'bot1', confidence: 0.9, importance: 0.8, tags: ['desa'], metadata: {} });
  await memory.remember({ type: 'SEMANTIC', content: 'tambang deepslate berada di bawah basis', visibility: 'HIVE', worldKey: 'localhost:25565', dimension: 'overworld', source: 'bot-observation', sourceBotId: 'bot2', confidence: 0.8, importance: 0.7, tags: ['tambang'], metadata: {} });
  const result = await memory.search({ text: 'lokasi desa oak sungai', worldKey: 'localhost:25565', dimension: 'overworld', limit: 2 }); assert.equal(result[0].sourceBotId, 'bot1'); assert.equal(result[0].embedding.model, 'minehive-hash-embedding');
});

test('ML evidence drives HiveMind consensus and expiring resource locks', async () => {
  const events = new EventBus(); const ml = createAdaptiveModel({ outcomeRepository: new MemoryRepository(), modelRepository: new MemoryRepository(), events, minimumSamples: 2 });
  await ml.recordOutcome({ botId: 'bot1', intent: 'farm', success: true, durationMs: 100, features: {}, source: 'test' }); await ml.recordOutcome({ botId: 'bot2', intent: 'farm', success: false, durationMs: 200, features: {}, source: 'test' });
  const hive = createHiveService({ repositories: { messages: new MemoryRepository(), state: new MemoryRepository(), locks: new MemoryRepository(), decisions: new MemoryRepository() }, events, ml, heartbeatTimeoutMs: 30000 }); hive.syncMembers([{ id: 'bot1', status: 'READY', capabilities: [], metadata: {} }, { id: 'bot2', status: 'READY', capabilities: [], metadata: {} }]);
  const lock = await hive.acquireLock({ key: 'farm:one', owner: 'bot1', ttlMs: 5000 }); assert.equal(lock.owner, 'bot1'); assert.equal(await hive.acquireLock({ key: 'farm:one', owner: 'bot2', ttlMs: 5000 }), null);
  const decision = await hive.propose({ type: 'autonomy', intent: 'farm', threshold: 0.4 }); assert.equal(decision.quorum, true); assert.equal(decision.approved, true); assert.equal((await ml.status()).productionModel.status, 'PRODUCTION');
});

test('short-term memory is bounded and promotes frequently recalled knowledge to long-term', async () => {
  const repository = new MemoryRepository(); const events = new EventBus(); const memory = createSemanticMemory({ repository, events, embeddingProvider: createHashEmbeddingProvider({ dimensions: 64, version: 'test' }), maxRecords: 100, shortTermMaxRecords: 2, shortTermTtlMs: 60_000, promotionAccesses: 3, promotionImportance: 0.9 });
  const short = await memory.rememberShortTerm({ content: 'jalur aman menuju tambang utara', worldKey: 'server:25565', dimension: 'overworld', source: 'bot1', importance: 0.5 }); assert.equal(short.type, 'SHORT_TERM'); assert.ok(short.expiresAt);
  for (let index = 0; index < 3; index++) await memory.recall({ text: 'jalur aman tambang utara', worldKey: 'server:25565', dimension: 'overworld', limit: 1 }); const result = await memory.consolidate(); assert.equal(result.promoted, 1);
  const longTerm = await memory.search({ text: 'tambang utara', type: 'LONG_TERM', worldKey: 'server:25565', dimension: 'overworld' }); assert.equal(longTerm[0].id, short.id); assert.equal(longTerm[0].expiresAt, null); assert.equal(longTerm[0].metadata.consolidatedFrom, 'SHORT_TERM');
  const restored = createSemanticMemory({ repository, events, embeddingProvider: createHashEmbeddingProvider({ dimensions: 64, version: 'test' }), maxRecords: 100 }); assert.equal((await restored.search({ text: 'tambang utara', type: 'LONG_TERM' }))[0].id, short.id);
});

test('short-term capacity forgets the least important memory first', async () => {
  const memory = createSemanticMemory({ repository: new MemoryRepository(), events: new EventBus(), embeddingProvider: createHashEmbeddingProvider({ dimensions: 64, version: 'test' }), maxRecords: 100, shortTermMaxRecords: 1, shortTermTtlMs: 60_000, promotionAccesses: 3, promotionImportance: 0.9 });
  await memory.rememberShortTerm({ content: 'suara sementara dari gua barat', importance: 0.1 }); const retained = await memory.rememberShortTerm({ content: 'bahaya creeper dekat gudang', importance: 0.8 }); const records = await memory.search({ text: '', type: 'SHORT_TERM', limit: 10 }); assert.deepEqual(records.map(record => record.id), [retained.id]);
});

test('autonomy prevents overlapping ticks while an objective is still running', async () => {
  const repository = new MemoryRepository(); let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  const autonomy = createAutonomyService({ repository, coordinator: { coordinate: async () => { calls++; await gate; return { results: [{ status: 'COMPLETED' }] }; } }, hive: { syncMembers() {}, acquireLock: async () => ({ acquired: true }), propose: async () => ({ approved: true }), releaseLock: async () => true }, bots: { list: () => [] }, health: { check: async () => ({ status: 'HEALTHY' }) }, events: new EventBus(), logger: { error() {} }, enabled: true, intervalMs: 5000, maxActionsPerHour: 10 });
  await autonomy.createObjective({ text: 'status', selector: 'auto' }); const first = autonomy.tick(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(await autonomy.tick(), { status: 'BUSY', reason: 'previous autonomy tick is still running' }); release(); assert.equal((await first).status, 'COMPLETED'); assert.equal(calls, 1); assert.equal(autonomy.status().running, false);
});

test('autonomy rejects objectives with corrupt scheduling data', async () => {
  const autonomy = createAutonomyService({ repository: new MemoryRepository(), coordinator: {}, hive: {}, bots: {}, health: {}, events: new EventBus(), logger: { error() {} }, enabled: false, intervalMs: 5000, maxActionsPerHour: 10 });
  await assert.rejects(autonomy.createObjective({ text: 'status', priority: 'invalid' }), /priority must be finite/); await assert.rejects(autonomy.createObjective({ text: 'status', cooldownMs: 100 }), /cooldownMs must be at least/); await assert.rejects(autonomy.createObjective({ text: 'status', selector: '../bot' }), /selector/);
});
