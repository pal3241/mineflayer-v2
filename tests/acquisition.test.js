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
