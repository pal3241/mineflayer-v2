import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { WorldMemoryService } from '../src/memory/world-memory-service.js';

test('shared world memory is isolated per server and dimension', async () => {
  const memory = new WorldMemoryService({ repository: new MemoryRepository() });
  await memory.remember({ host: 'server-a', port: 25565, dimension: 'overworld', type: 'village', name: 'desa-utara', position: { x: 100, y: 64, z: 20 }, sourceBotId: 'scout' });
  await memory.remember({ host: 'server-a', port: 25565, dimension: 'the_nether', type: 'structure', name: 'fortress', position: { x: 10, y: 70, z: 10 } });
  await memory.remember({ host: 'server-b', port: 25565, dimension: 'overworld', type: 'stronghold', name: 'portal', position: { x: -500, y: 30, z: 80 } });
  assert.deepEqual((await memory.search({ host: 'server-a', port: 25565, dimension: 'overworld' })).map(item => item.name), ['desa-utara']); assert.deepEqual((await memory.search({ host: 'server-b', port: 25565 })).map(item => item.name), ['portal']);
});

test('remembering the same named place updates provenance record instead of duplicating it', async () => {
  const memory = new WorldMemoryService({ repository: new MemoryRepository() }); const first = await memory.remember({ host: 'server', dimension: 'overworld', type: 'village', name: 'desa', position: { x: 1, y: 64, z: 1 }, confidence: 0.7 }); const updated = await memory.remember({ host: 'server', dimension: 'overworld', type: 'village', name: 'desa', position: { x: 5, y: 64, z: 5 }, confidence: 0.9 }); assert.equal(updated.id, first.id); assert.equal(updated.version, 2); assert.deepEqual(updated.position, { x: 5, y: 64, z: 5 });
});

test('world memory rejects corrupt numeric and server boundaries', async () => {
  const memory = new WorldMemoryService({ repository: new MemoryRepository() }); const valid = { host: 'server', port: 25565, dimension: 'overworld', type: 'base', name: 'utama', position: { x: 0, y: 64, z: 0 } };
  await assert.rejects(memory.remember({ ...valid, confidence: 'not-a-number' }), /confidence must be finite/); await assert.rejects(memory.remember({ ...valid, port: 70000 }), /server port/); await assert.rejects(memory.remember({ ...valid, dimension: '../world' }), /dimension/); await assert.rejects(memory.search({ limit: 'invalid' }), /limit must be an integer/); await assert.rejects(memory.search({ near: { x: 0, y: Number.NaN, z: 0 } }), /near position/);
});
