import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcquisitionService } from '../src/logistics/acquisition/acquisition-service.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';

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

test('collection task runner receives block instead of item', async () => {
  const calls = []; const items = [];
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: {
    snapshot: () => ({ inventorySummary: items, dimension: 'overworld' }),
    findSourceBlocks: async () => ['oak_log'],
    collect: async input => { calls.push(input); items.push({ name: 'oak_log', count: input.count }); return input; }
  } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  service.configureTaskRunner(async ({ capability, input, resources, runtime }) => { assert.equal(capability, 'minecraft.collection'); assert.equal(input.block, 'oak_log'); assert.equal(input.item, undefined); assert.deepEqual(resources, { ownerType: 'ACQUISITION', reason: 'ACQUISITION_RESERVED', inputs: [], outputs: [{ item: 'oak_log', count: 1 }] }); return runtime.adapter.collect(input); });
  await service.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'oak_log', count: 1 });
  assert.equal(calls[0].block, 'oak_log');
});

test('smelting acquires input and fuel before executing the smelt task', async () => {
  const items = []; const collected = []; let smelted = false;
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: {
    snapshot: () => ({ inventorySummary: items, dimension: 'overworld' }),
    findSourceBlocks: async ({ item }) => item === 'raw_iron' ? ['iron_ore'] : item === 'coal' ? ['coal_ore'] : [],
    collect: async ({ block, count }) => { collected.push({ block, count }); items.push({ name: block === 'iron_ore' ? 'raw_iron' : 'coal', count }); },
    smeltRequirements: async ({ item }) => item === 'iron_ingot' ? ({ item, input: { name: 'raw_iron', count: 1 }, fuel: { name: 'coal', count: 1 }, furnace: true }) : null,
    smeltItem: async ({ item, count }) => { smelted = true; items.push({ name: item, count }); return { item, count }; }
  } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  const result = await service.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'iron_ingot', count: 1 });
  assert.equal(result.status, 'COMPLETED'); assert.equal(smelted, true); assert.deepEqual(collected, [{ block: 'iron_ore', count: 1 }, { block: 'coal_ore', count: 1 }]);
});

test('craft-ready protects the complete quantity-aware ingredient contract', async () => {
  const items = [{ name: 'oak_planks', count: 2 }]; let contract;
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: items, dimension: 'overworld' }), craftRequirements: async () => ({ craftable: true, missing: [], ingredients: [{ item: 'oak_planks', count: 2 }], steps: [{ item: 'stick', crafts: 1, resultCount: 4 }] }), craftItem: async () => { items[0].count -= 2; items.push({ name: 'stick', count: 4 }); return { item: 'stick', count: 4 }; } } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} } }); service.configureTaskRunner(async input => { contract = input.resources; return input.runtime.adapter.craftItem(input.input); }); await service.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stick', count: 4 }); assert.deepEqual(contract.inputs, [{ item: 'oak_planks', count: 2 }]); assert.deepEqual(contract.outputs, [{ item: 'stick', count: 4 }]);
});

test('special source reserves only dependencies declared as consumable', async () => {
  const items = [{ name: 'bucket', count: 1 }, { name: 'shears', count: 1 }]; let contract;
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: items, dimension: 'overworld' }) } }; const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} } }); service.registerSpecialSource({ name: 'test-milk', capability: 'minecraft.acquire-milk', matches: item => item === 'milk_bucket', dependencies: () => [{ type: 'ITEM', item: 'bucket', count: 1, consume: true }, { type: 'ITEM', item: 'shears', count: 1, consume: false }], execute: async () => ({ acquired: 1 }) }); service.configureTaskRunner(async input => { contract = input.resources; items.push({ name: 'milk_bucket', count: 1 }); return { acquired: 1 }; }); await service.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'milk_bucket', count: 1 }); assert.deepEqual(contract.inputs, [{ item: 'bucket', count: 1 }]); assert.deepEqual(contract.outputs, [{ item: 'milk_bucket', count: 1 }]);
});

test('smelting task receives an acquisition input and output resource contract', async () => {
  const items = []; const contracts = [];
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: {
    snapshot: () => ({ inventorySummary: items, dimension: 'overworld' }), findSourceBlocks: async ({ item }) => item === 'raw_iron' ? ['iron_ore'] : ['coal_ore'],
    collect: async ({ block, count }) => { items.push({ name: block === 'iron_ore' ? 'raw_iron' : 'coal', count }); }, smeltRequirements: async ({ item }) => item === 'iron_ingot' ? ({ input: { name: 'raw_iron', count: 1 }, fuel: { name: 'coal', count: 1 }, furnace: true }) : null,
    smeltItem: async ({ item, count }) => { items.push({ name: item, count }); return { item, count }; }
  } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  service.configureTaskRunner(async ({ capability, input, resources, runtime }) => { contracts.push({ capability, resources }); if (capability === 'minecraft.collection') return runtime.adapter.collect(input); return runtime.adapter.smeltItem(input); });
  await service.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'iron_ingot', count: 1 }); const smelt = contracts.find(entry => entry.capability === 'minecraft.smelting');
  assert.deepEqual(smelt.resources, { ownerType: 'ACQUISITION', reason: 'ACQUISITION_RESERVED', inputs: [{ item: 'raw_iron', count: 1 }, { item: 'coal', count: 1 }], outputs: [{ item: 'iron_ingot', count: 1 }] });
});

test('identical concurrent acquisitions share one execution', async () => {
  const items = []; let executions = 0;
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: {
    snapshot: () => ({ inventorySummary: items, dimension: 'overworld' }),
    findSourceBlocks: async () => ['stone'],
    collect: async ({ count }) => { executions++; await new Promise(resolve => setTimeout(resolve, 5)); items.push({ name: 'stone', count }); return { count }; }
  } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  const [first, second] = await Promise.all([
    service.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 1 }),
    service.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 1 })
  ]);
  assert.equal(executions, 1); assert.equal(first.requestId, second.requestId); assert.equal(first.status, 'COMPLETED');
});

test('acquisition request records survive service reinitialization', async () => {
  const repository = new MemoryRepository();
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: [{ name: 'stone', count: 1 }], dimension: 'overworld' }) } };
  const bots = { list: () => [bot], get: () => bot };
  const first = createAcquisitionService({ bots, repository, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  const result = await first.acquire({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 1 });
  const second = createAcquisitionService({ bots, repository, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  assert.equal(await second.initialize(), 1); assert.equal(second.list()[0].id, result.requestId); assert.equal(second.list()[0].status, 'COMPLETED');
});

test('bot death marks unfinished acquisition requests for recovery', async () => {
  const bot = { id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: [], dimension: 'overworld' }), findSourceBlocks: async () => ['stone'] } };
  const service = createAcquisitionService({ bots: { list: () => [bot], get: () => bot }, logistics: { stock: async () => [] }, events: { publish: async () => {} } });
  await service.request({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 1 });
  const affected = await service.handleBotDeath('bot-a');
  assert.equal(affected.length, 1); assert.equal(affected[0].status, 'RECOVERY_REQUIRED'); assert.equal(service.status().activeRequests, 0);
});
