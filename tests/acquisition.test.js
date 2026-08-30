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
      craftRequirements: async () => ({ missing: [], steps: ['craft'] })
    }
  };
  const bots = { list: () => [bot], get: () => bot };
  const service = createAcquisitionService({ bots, logistics: { stock: async () => [] }, events: { publish: async () => {} }, logger: { info: () => {} } });

  const result = await service.request({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stick', count: 1, purpose: 'craft stick' });
  assert.equal(result.status, 'CRAFT_READY');
  assert.equal(result.requirement.item, 'stick');
  assert.deepEqual(result.recipe.steps, ['craft']);
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

test('acquisition generates unique request IDs even for identical keys in the same millisecond', () => {
  const original = Date.now;
  Date.now = () => 123456;
  try {
    const service = createAcquisitionService({ bots: { list: () => [{ id: 'bot-a', status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: [] }) } }], get: id => ({ id, status: 'READY', options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ inventorySummary: [] }) } }) }, logistics: { stock: async () => [] }, events: { publish: async () => {} }, logger: { info: () => {} } });
    const first = service.normalizeRequirement({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 1 });
    const second = service.normalizeRequirement({ requesterBotId: 'bot-a', type: 'ITEM', item: 'stone', count: 1 });
    assert.notEqual(first.id, second.id);
  } finally {
    Date.now = original;
  }
});
