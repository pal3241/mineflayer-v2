import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createTerritoryLogisticsService, createTerritoryService, createThreatService } from '../src/territory/index.js';

test('risk-aware logistics prefers a safer reliable warehouse over the nearest one', async () => {
  const events = new EventBus(); const territory = createTerritoryService({ repository: new MemoryRepository(), events }); const service = createTerritoryLogisticsService({ territory, events }); const scope = { worldKey: 'localhost:25565', dimension: 'overworld' };
  await territory.create({ ...scope, name: 'Near danger', type: 'DANGER', center: { x: 40, y: 64, z: 0 }, radius: 30, dangerLevel: 0.95 }); await territory.create({ ...scope, name: 'Safe route', type: 'LOGISTICS_ROUTE', center: { x: 120, y: 64, z: 0 }, radius: 30, metadata: { reliability: 0.95, traffic: 0.1 } });
  const storages = [{ id: 'near', ...scope, position: { x: 40, y: 64, z: 0 }, capacitySlots: 27, occupiedSlots: 20 }, { id: 'safe', ...scope, position: { x: 120, y: 64, z: 0 }, capacitySlots: 27, occupiedSlots: 8 }]; const ranked = await service.rankStorages({ origin: { x: 0, y: 64, z: 0 }, storages }); assert.equal(ranked[0].storage.id, 'safe'); assert.ok(ranked[0].cost < ranked[1].cost);
});

test('risk-aware logistics excludes a warehouse without required capacity', async () => {
  const territory = createTerritoryService({ repository: new MemoryRepository() }); const service = createTerritoryLogisticsService({ territory }); const scope = { worldKey: 'localhost:25565', dimension: 'overworld' }; const selected = await service.chooseStorage({ origin: { x: 0, y: 64, z: 0 }, requiredSlots: 2, storages: [{ id: 'full', ...scope, position: { x: 5, y: 64, z: 0 }, capacitySlots: 27, occupiedSlots: 26 }, { id: 'open', ...scope, position: { x: 50, y: 64, z: 0 }, capacitySlots: 27, occupiedSlots: 10 }] }); assert.equal(selected.storage.id, 'open');
});

test('threat detector classifies critical danger and selects evacuation away from base', async () => {
  const threats = createThreatService({ repository: new MemoryRepository(), events: new EventBus() }); const threat = await threats.detect({ entityType: 'warden', distance: 3, botHealth: 3, armor: 0.1, weapon: 0, enemyCount: 2, time: 'night', nearbyFriendlyBots: 0, distanceFromBase: 200, escapeRoute: false, missionImportance: 0.8, worldKey: 'localhost:25565', dimension: 'overworld', position: { x: 200, y: -40, z: 0 }, sourceBotId: 'scout' }); assert.equal(threat.level, 'CRITICAL'); assert.equal(threat.response, 'EVACUATE'); assert.equal((await threats.status()).status, 'DEGRADED'); await threats.resolve(threat.id, { resolution: 'Warden no longer tracked' }); assert.equal((await threats.status()).active, 0);
});

test('low threat is observed without degrading defense health', async () => {
  const threats = createThreatService({ repository: new MemoryRepository() }); const threat = await threats.detect({ entityType: 'zombie', distance: 60, botHealth: 20, armor: 1, weapon: 1, enemyCount: 1, time: 'day', nearbyFriendlyBots: 3, distanceFromBase: 256, escapeRoute: true, missionImportance: 0, worldKey: 'localhost:25565', position: { x: 60, y: 64, z: 0 }, sourceBotId: 'guard' }); assert.ok(['NONE', 'LOW'].includes(threat.level)); assert.equal((await threats.status()).status, 'HEALTHY');
});
