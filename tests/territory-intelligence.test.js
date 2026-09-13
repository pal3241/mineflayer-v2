import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createTerritoryIntelligenceService, createTerritoryService } from '../src/territory/index.js';

function setup(options = {}) { const events = new EventBus(); const territory = createTerritoryService({ repository: new MemoryRepository(), events }); const intelligence = createTerritoryIntelligenceService({ territory, repository: new MemoryRepository(), events, ...options }); return { events, territory, intelligence }; }

test('resource intelligence merges nearby evidence without duplicating zones', async () => {
  const { territory, intelligence } = setup(); const first = await intelligence.recordResource({ worldKey: 'localhost:25565', dimension: 'overworld', position: { x: 100, y: 20, z: 100 }, resources: ['iron_ore'], confidence: 0.8, source: 'SURVEY' }); const second = await intelligence.recordResource({ worldKey: 'localhost:25565', dimension: 'overworld', position: { x: 108, y: 22, z: 104 }, resources: ['coal_ore'], confidence: 0.9, source: 'SURVEY' });
  assert.equal(second.id, first.id); assert.deepEqual(second.resources, ['iron_ore', 'coal_ore']); assert.equal(second.metadata.intelligence.evidenceCount, 2); assert.equal((await territory.list({ type: 'RESOURCE' })).length, 1);
});

test('repeated danger evidence increases risk monotonically and remains bounded', async () => {
  const { intelligence } = setup(); const first = await intelligence.recordDanger({ worldKey: 'localhost:25565', dimension: 'overworld', position: { x: 0, y: 64, z: 0 }, severity: 0.8, confidence: 0.9, source: 'DEATH' }); const second = await intelligence.recordDanger({ worldKey: 'localhost:25565', dimension: 'overworld', position: { x: 4, y: 64, z: 2 }, severity: 0.8, confidence: 0.9, source: 'DEATH' });
  assert.equal(second.id, first.id); assert.ok(second.dangerLevel > first.dangerLevel); assert.ok(second.dangerLevel <= 1); assert.equal((await intelligence.status()).dangerSignals, 2);
});

test('discovery and death adapters create auditable resource and danger signals', async () => {
  const { intelligence, territory } = setup(); const discovery = { discoveries: [{ id: 'memory-1', worldKey: 'server.test:25565', dimension: 'overworld', type: 'resource', name: 'resource-iron-1-2', position: { x: 32, y: 12, z: 48 }, confidence: 0.85, updatedAt: new Date().toISOString(), metadata: { marker: 'iron_ore' } }] }; await intelligence.ingestDiscoveries(discovery); await intelligence.ingestDiscoveries(discovery); await intelligence.ingestDeath({ id: 'death-1', botId: 'bot1', worldKey: 'server.test:25565', dimension: 'overworld', position: { x: -20, y: 11, z: 6 }, cause: 'lava' });
  assert.equal((await territory.list({ type: 'RESOURCE' })).length, 1); assert.equal((await territory.list({ type: 'RESOURCE' }))[0].metadata.intelligence.evidenceCount, 1); assert.equal((await territory.list({ type: 'DANGER' }))[0].dangerLevel, 0.81); assert.deepEqual((await intelligence.signals({ worldKey: 'server.test:25565' })).map(signal => signal.kind).sort(), ['DANGER', 'RESOURCE']);
});

test('signal history evicts oldest evidence at the configured bound', async () => {
  const { intelligence } = setup({ maxSignals: 10 }); for (let index = 0; index < 12; index++) await intelligence.recordDanger({ worldKey: 'localhost:25565', dimension: 'overworld', position: { x: index * 100, y: 64, z: 0 }, severity: 0.2, confidence: 1, sourceId: String(index) }); assert.equal((await intelligence.signals()).length, 10); assert.equal((await intelligence.status()).signals, 10);
});
