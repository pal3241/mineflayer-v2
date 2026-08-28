import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EventBus, MemoryRepository, createAdaptiveModel, createDiscoveryService, createHashEmbeddingProvider, createHiveService, createLogisticsService, createSemanticMemory, createStructureObserver } from '../src/index.js';
import { WorldMemoryService } from '../src/memory/world-memory-service.js';

function createHive(events) { const ml = createAdaptiveModel({ outcomeRepository: new MemoryRepository(), modelRepository: new MemoryRepository(), events, minimumSamples: 2 }); return createHiveService({ repositories: { messages: new MemoryRepository(), state: new MemoryRepository(), locks: new MemoryRepository(), decisions: new MemoryRepository() }, events, ml, heartbeatTimeoutMs: 30_000 }); }

class LogisticsAdapter extends EventEmitter {
  constructor() { super(); this.botInventory = [{ name: 'stone', count: 10 }]; this.storageInventory = [{ name: 'stone', count: 20 }]; this.position = { x: 0, y: 64, z: 0 }; this.storagePosition = { x: 4, y: 64, z: 0 }; }
  snapshot() { return { position: this.position, dimension: 'overworld', inventorySummary: structuredClone(this.botInventory) }; }
  async findNearestStorage() { return this.observation(); }
  async inspectStorage() { return this.observation(); }
  async depositStorage({ item, count }) { const beforeBot = countItem(this.botInventory, item); const beforeStorage = countItem(this.storageInventory, item); change(this.botInventory, item, -count); change(this.storageInventory, item, count); return { item, transferred: count, storage: this.observation(), verification: { botBefore: beforeBot, botAfter: beforeBot - count, storageBefore: beforeStorage, storageAfter: beforeStorage + count } }; }
  async withdrawStorage({ item, count }) { const beforeBot = countItem(this.botInventory, item); const beforeStorage = countItem(this.storageInventory, item); change(this.storageInventory, item, -count); change(this.botInventory, item, count); return { item, transferred: count, storage: this.observation(), verification: { botBefore: beforeBot, botAfter: beforeBot + count, storageBefore: beforeStorage, storageAfter: beforeStorage - count } }; }
  observation() { return { kind: 'chest', position: this.storagePosition, inventory: structuredClone(this.storageInventory), capacitySlots: 27, occupiedSlots: this.storageInventory.length }; }
}

test('logistics reserves stock without double spending and verifies transfers', async () => {
  const events = new EventBus(); const repositories = { storages: new MemoryRepository(), reservations: new MemoryRepository(), transfers: new MemoryRepository() }; const logistics = createLogisticsService({ repositories, hive: createHive(events), events }); const adapter = new LogisticsAdapter(); const runtime = { bot: { id: 'courier' }, adapter, options: { host: 'server', port: 25565 } };
  const storage = await logistics.registerNearest({ runtime, name: 'gudang utama', maxDistance: 16 }); assert.equal(storage.inventory[0].count, 20);
  const deposited = await logistics.store({ runtime, storageName: 'gudang utama', item: 'stone', count: 5 }); assert.equal(deposited.storage.inventory[0].count, 25); assert.equal(deposited.transfer.status, 'VERIFIED');
  const reservation = await logistics.reserve({ runtime, storageName: 'gudang utama', item: 'stone', count: 20, ttlMs: 60_000 }); await assert.rejects(logistics.reserve({ runtime, storageName: 'gudang utama', item: 'stone', count: 6, ttlMs: 60_000 }), /5 available/); await logistics.release({ reservationId: reservation.id, requesterBotId: 'courier' });
  const retrieved = await logistics.retrieve({ runtime, storageName: 'gudang utama', item: 'stone', count: 10 }); assert.equal(retrieved.reservation.status, 'COMPLETED'); assert.equal(adapter.storageInventory[0].count, 15); assert.equal((await logistics.status()).transfers, 2);
});

test('structure observer automatically persists important discoveries', async () => {
  const events = new EventBus(); const worldMemory = new WorldMemoryService({ repository: new MemoryRepository(), events }); const semanticMemory = createSemanticMemory({ repository: new MemoryRepository(), events, embeddingProvider: createHashEmbeddingProvider({ dimensions: 64, version: 'test' }), maxRecords: 100 }); const discovery = createDiscoveryService({ worldMemory, semanticMemory, events });
  class ObserverAdapter extends EventEmitter { snapshot() { return { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld' }; } async survey({ maxDistance }) { return { maxDistance, scannedAt: new Date().toISOString(), discoveries: [{ type: 'stronghold', name: 'end_portal_frame', marker: 'end_portal_frame', confidence: 0.99, position: { x: 40, y: 25, z: -8 } }] }; } }
  const adapter = new ObserverAdapter(); const runtime = { bot: { id: 'scout', status: 'READY' }, adapter, options: { host: 'server', port: 25565 } }; const observer = createStructureObserver({ discovery, logger: { error() {} }, intervalMs: 1000, minimumDistance: 8, maxDistance: 64 }); observer.attach(runtime); adapter.emit('spawn'); await new Promise(resolve => setTimeout(resolve, 350));
  const structures = await worldMemory.search({ host: 'server', port: 25565, dimension: 'overworld', type: 'stronghold' }); assert.equal(structures.length, 1); const memories = await semanticMemory.search({ text: 'stronghold portal', worldKey: 'server:25565', dimension: 'overworld', limit: 5 }); assert.equal(memories[0].type, 'LONG_TERM'); assert.equal(memories[0].source, 'structure-observer'); assert.equal(observer.status().discoveries, 1); observer.stop();
});

test('contextual ML weights matching bot evidence and exposes monitoring', async () => {
  const ml = createAdaptiveModel({ outcomeRepository: new MemoryRepository(), modelRepository: new MemoryRepository(), events: new EventBus(), minimumSamples: 2 }); const features = { className: 'miner', healthBand: 20, hasTool: true };
  await ml.recordOutcome({ botId: 'one', intent: 'collect', success: true, durationMs: 100, features, source: 'test' }); await ml.recordOutcome({ botId: 'two', intent: 'collect', success: false, durationMs: 300, features: { ...features, hasTool: false }, source: 'test' });
  const one = await ml.predict({ botId: 'one', intent: 'collect', features }); const two = await ml.predict({ botId: 'two', intent: 'collect', features: { ...features, hasTool: false } }); assert.ok(one.prediction > two.prediction); assert.equal(one.modelVersion, 'contextual-beta-v2'); const status = await ml.status(); assert.equal(status.monitoring.predictionCount, 2); assert.equal(status.monitoring.byIntent.collect.samples, 2);
});

function countItem(inventory, name) { return inventory.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0); }
function change(inventory, name, amount) { const item = inventory.find(entry => entry.name === name); if (!item) inventory.push({ name, count: amount }); else item.count += amount; }
