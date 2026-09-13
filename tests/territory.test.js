import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createTerritoryService } from '../src/territory/index.js';

function setup() { const events = new EventBus(); return { events, territory: createTerritoryService({ repository: new MemoryRepository(), events }) }; }

test('territory stores asymmetric typed regions and builds a map summary', async () => {
  const { territory } = setup(); const base = await territory.create({ worldKey: 'localhost:25565', dimension: 'overworld', name: 'Main Base', type: 'BASE', center: { x: 0, y: 64, z: 0 }, radius: 32, explored: true }); await territory.create({ worldKey: 'localhost:25565', dimension: 'overworld', name: 'North Iron', type: 'RESOURCE', center: { x: 120, y: 20, z: -80 }, radius: 24, resources: ['iron_ore', 'coal_ore'], dangerLevel: 0.25, explored: true });
  const map = await territory.map({ worldKey: 'localhost:25565', dimension: 'overworld' }); assert.equal(map.regionCount, 2); assert.equal(map.counts.BASE, 1); assert.equal(map.counts.RESOURCE, 1); assert.equal((await territory.get(base.id)).name, 'Main Base');
});

test('territory position lookup returns smallest containing region first', async () => {
  const { territory } = setup(); await territory.create({ worldKey: 'localhost:25565', dimension: 'overworld', name: 'Safe Area', type: 'SAFE', center: { x: 0, y: 64, z: 0 }, radius: 64 }); await territory.create({ worldKey: 'localhost:25565', dimension: 'overworld', name: 'Lava Pit', type: 'DANGER', center: { x: 5, y: 64, z: 0 }, radius: 8, dangerLevel: 0.9 });
  const regions = await territory.at({ worldKey: 'localhost:25565', dimension: 'overworld', position: { x: 5, y: 64, z: 0 } }); assert.deepEqual(regions.map(region => region.type), ['DANGER', 'SAFE']);
});

test('territory validates mutations, versions updates, and emits lifecycle events', async () => {
  const { territory, events } = setup(); const lifecycle = []; events.subscribe('territory.region.updated', event => lifecycle.push(event.payload)); const region = await territory.create({ worldKey: 'mc.example:25565', type: 'FRONTIER', center: { x: 0, y: 70, z: 0 }, radius: 16 }); const updated = await territory.update(region.id, { dangerLevel: 0.4, resources: ['oak_log'] }); assert.equal(updated.version, 2); assert.equal(lifecycle.length, 1); await assert.rejects(territory.create({ worldKey: 'bad', type: 'UNKNOWN', center: { x: 0, y: 0, z: 0 }, radius: 0 }), error => error.code === 'VALIDATION_ERROR'); assert.deepEqual(await territory.remove(region.id), { removed: true, id: region.id });
});
