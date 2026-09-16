import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkshopService } from '../src/logistics/workshop-service.js';

function fixture({ exists = true } = {}) {
  let moved = false; const published = []; const invalidated = [];
  const remembered = { key: 'workshop:localhost:25565:overworld:crafting_table:20,64,0', kind: 'WORKSHOP', metadata: { kind: 'crafting_table' }, position: { x: 20, y: 64, z: 0 }, verified: true };
  const memory = { context: async () => ({ records: [remembered] }), invalidateWorkshop: async (...args) => invalidated.push(args) };
  const runtime = { id: 'bot-a', options: { host: 'localhost', port: 25565 }, adapter: {
    snapshot: () => ({ dimension: 'overworld', position: moved ? { x: 18, y: 64, z: 0 } : { x: 0, y: 64, z: 0 } }),
    findWorkshops: async ({ maxDistance }) => moved && exists && maxDistance <= 6 ? [{ kind: 'crafting_table', position: { x: 20, y: 64, z: 0 }, distance: 2 }] : [],
    navigate: async target => { assert.deepEqual({ x: target.x, y: target.y, z: target.z }, remembered.position); moved = true; }
  } };
  const service = createWorkshopService({ memory, events: { publish: async (type, payload) => published.push({ type, payload }) } });
  return { service, runtime, published, invalidated };
}

test('workshop memory routes a bot to a remembered crafting table and verifies it', async () => {
  const { service, runtime, published, invalidated } = fixture(); const result = await service.prepare({ runtime, kind: 'crafting_table' });
  assert.deepEqual(result.position, { x: 20, y: 64, z: 0 }); assert.equal(invalidated.length, 0); assert.equal(published.at(-1).type, 'logistics.workshop.observed');
});

test('workshop memory invalidates a missing remembered block', async () => {
  const { service, runtime, invalidated } = fixture({ exists: false }); const result = await service.prepare({ runtime, kind: 'crafting_table' });
  assert.equal(result, null); assert.deepEqual(invalidated, [['workshop:localhost:25565:overworld:crafting_table:20,64,0', 'BLOCK_MISSING_AFTER_NAVIGATION']]);
});
