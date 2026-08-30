import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcquisitionService } from '../src/logistics/acquisition/acquisition-service.js';

test('acquisition rejects an invalid requester instead of falling back to the first bot', async () => {
  const bots = {
    list: () => [{ id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: [] }) } }],
    get: id => ({ id, adapter: { snapshot: () => ({ inventorySummary: [] }) }, options: { host: 'localhost', port: 25565 } })
  };
  const service = createAcquisitionService({ bots, logistics: { stock: async () => [] }, events: { publish: async () => {} }, logger: { info: () => {} } });

  await assert.rejects(
    () => service.request({ requesterBotId: 'missing-bot', type: 'ITEM', item: 'stone', count: 1 }),
    /requesterBotId|not found|missing/i
  );
});

test('acquisition marks craft-ready requirements when the recipe has no missing ingredients', async () => {
  const bot = {
    id: 'bot-a',
    status: 'READY',
    options: { host: 'localhost', port: 25565 },
    adapter: {
      snapshot: () => ({ inventorySummary: [{ name: 'planks', count: 1 }] }),
      craftRequirements: async () => ({ craftable: true, missing: [], steps: ['craft'] })
    }
  };
  const bots = { list: () => [bot], get: () => bot };
  const service = createAcquisitionService({ bots, logistics: { stock: async () => [] }, events: { publish: async () => {} }, logger: { info: () => {} } });

  const result = await service.request({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stick', count: 1, purpose: 'craft stick' });
  assert.equal(result.status, 'CRAFT_READY');
  assert.equal(result.requirement.item, 'stick');
  assert.deepEqual(result.recipe.steps, ['craft']);
});

test('acquisition bypasses craft when an item is not craftable', async () => {
  const bot = {
    id: 'bot-a',
    status: 'READY',
    options: { host: 'localhost', port: 25565 },
    adapter: {
      snapshot: () => ({ inventorySummary: [], dimension: 'overworld' }),
      craftRequirements: async () => ({ craftable: false, missing: [] }),
      findSourceBlocks: async () => ['oak_log']
    }
  };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} }, logger: { info: () => {} } });

  const result = await service.request({ requesterBotId: 'bot-a', type: 'ITEM', item: 'oak_log', count: 1 });
  assert.equal(result.status, 'COLLECTION_PLANNED');
  assert.deepEqual(result.blocks, ['oak_log']);
});

test('acquisition aggregates stacked inventory before satisfying a request', async () => {
  const bot = {
    id: 'bot-a',
    status: 'READY',
    options: { host: 'localhost', port: 25565 },
    adapter: {
      snapshot: () => ({ inventorySummary: [{ name: 'stone', count: 2 }, { name: 'stone', count: 3 }] }),
      craftRequirements: async () => ({ missing: [], steps: [] })
    }
  };
  const bots = { list: () => [bot], get: () => bot };
  const service = createAcquisitionService({ bots, logistics: { stock: async () => [] }, events: { publish: async () => {} }, logger: { info: () => {} } });

  const result = await service.request({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 5 });
  assert.equal(result.status, 'SATISFIED');
  assert.equal(result.requirement.count, 5);
});

test('acquisition rejects tool requirements with more than one tool requested', () => {
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: [] }) } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} }, logger: { info: () => {} } });

  assert.throws(() => service.normalizeRequirement({ requesterBotId: 'bot-a', type: 'TOOL', category: 'PICKAXE', count: 2 }), /tool count|positive integer|1/);
});

test('acquisition generates unique request IDs even for identical keys in the same millisecond', async () => {
  const original = Date.now;
  Date.now = () => 123456;
  try {
    const service = createAcquisitionService({ bots: { list: () => [{ id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: [] }) } }], get: id => ({ id, status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: [] }) } }) }, logistics: { stock: async () => [] }, events: { publish: async () => {} }, logger: { info: () => {} } });
    await assert.rejects(() => service.request({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 1 }));
    await assert.rejects(() => service.request({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 1 }));
    const requests = service.list();
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].id, requests[1].id);
  } finally {
    Date.now = original;
  }
});

test('acquisition plans only the remaining item shortage', async () => {
  const calls = [];
  const items = [{ name: 'iron', count: 4 }];
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: {
    snapshot: () => ({ inventorySummary: items, dimension: 'overworld' }),
    findSourceBlocks: async () => ['iron_ore'],
    collect: async input => { calls.push(input); items[0].count += input.count; }
  } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  const plan = await service.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'iron', count: 10 });
  assert.equal(plan.status, 'COMPLETED');
  assert.equal(calls[0].count, 6);
});

test('fleet plans retain the selected item and execute at a meeting point', async () => {
  const donorItems = [{ name: 'stone', count: 8 }]; const targetItems = [];
  const makeAdapter = (items, position) => ({ snapshot: () => ({ inventorySummary: items, dimension: 'overworld', position }), smartMove: async input => { position.x = input.x; position.y = input.y; position.z = input.z; }, dropItem: async ({ count }) => { items[0].count -= count; }, pickupItem: async ({ item, count }) => items.push({ name: item, count }) });
  const target = { id: 'target', status: 'READY', options: { host: 'localhost', port: 25565 }, runtime: { dimension: 'overworld' }, adapter: makeAdapter(targetItems, { x: 0, y: 64, z: 0 }) };
  const donor = { id: 'donor', status: 'READY', options: { host: 'localhost', port: 25565 }, runtime: { dimension: 'overworld' }, adapter: makeAdapter(donorItems, { x: 10, y: 64, z: 0 }) };
  const bots = { list: () => [target, donor], get: id => id === 'target' ? target : donor };
  const service = createAcquisitionService({ bots, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  const result = await service.acquire({ requesterBotId: 'target', type: 'ITEM', item: 'stone', count: 3 });
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.item, 'stone'); assert.equal(result.execution.item, 'stone'); assert.deepEqual(result.execution.meeting, { x: 5, y: 64, z: 0 });
});

test('tool acquisition can execute a craft dependency', async () => {
  const items = [{ name: 'planks', count: 3 }];
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: {
    snapshot: () => ({ inventorySummary: items, dimension: 'overworld' }),
    craftRequirements: async ({ item }) => item === 'stone_pickaxe' ? { craftable: true, missing: [{ name: 'planks', count: 3 }] } : { craftable: false, missing: [] },
    craftItem: async ({ item }) => items.push({ name: item, count: 1 })
  } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  const result = await service.acquire({ requesterBotId: 'bot-a', type: 'TOOL', category: 'PICKAXE', acceptedItems: ['stone_pickaxe'], minimumTier: 'STONE' });
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.item, 'stone_pickaxe'); assert.equal(items.at(-1).name, 'stone_pickaxe');
});

test('allowPartial records the collected amount and remaining shortage', async () => {
  const items = [];
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: {
    snapshot: () => ({ inventorySummary: items, dimension: 'overworld' }),
    findSourceBlocks: async () => ['bad_source', 'good_source'],
    collect: async ({ block }) => { if (block === 'bad_source') throw new Error('source unavailable'); items.push({ name: 'stone', count: 2 }); }
  } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} }, config: { allowPartial: true } });
  const result = await service.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 5 });
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.collected, 2); assert.equal(result.remaining, 3); assert.equal(service.status().partialRequests, 1);
});
