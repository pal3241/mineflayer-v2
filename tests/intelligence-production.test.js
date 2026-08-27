import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventBus, MemoryRepository, SqliteDatabase, createAdaptiveModel, createApplication, createHashEmbeddingProvider, createHiveService, createSemanticMemory } from '../src/index.js';

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
