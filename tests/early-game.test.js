import assert from 'node:assert/strict';
import test from 'node:test';
import { createEarlyGameService } from '../src/autonomy/early-game-service.js';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';

function setup({ followerX = 5 } = {}) {
  const inventory = []; const equipment = []; const followed = []; const acquired = []; const capabilityCalls = []; const projects = new Map(); let projectSequence = 0;
  const snapshot = position => ({ health: 20, food: 20, position, dimension: 'overworld', inventorySummary: structuredClone(inventory), equipmentSummary: structuredClone(equipment) });
  const runtimes = {
    leader: { id: 'leader', bot: { id: 'leader', name: 'bot1', metadata: { commandAlias: 'bot1' } }, options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => snapshot({ x: 0, y: 64, z: 0 }), followPlayer: async input => followed.push({ botId: 'leader', ...input }) } },
    follower: { id: 'follower', bot: { id: 'follower', name: 'bot2', metadata: {} }, options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => snapshot({ x: followerX, y: 64, z: 0 }), followPlayer: async input => followed.push({ botId: 'follower', ...input }) } }
  };
  const bots = { list: () => Object.values(runtimes).map(value => ({ id: value.id, name: value.bot.name, metadata: value.bot.metadata, status: 'READY' })), get: id => runtimes[id] };
  const building = {
    list: async () => [...projects.values()],
    import: async input => { const value = { id: `project-${++projectSequence}`, status: 'PENDING_APPROVAL', metadata: input.metadata }; projects.set(value.id, value); return value; },
    get: async id => projects.get(id),
    materialStatus: async id => ({ materials: [{ name: 'oak_planks', missing: 1, ready: false }], blueprintId: id }),
    makeAll: async id => ({ blueprintId: id, status: 'COMPLETED' }),
    approve: async id => projects.set(id, { ...projects.get(id), status: 'READY' }),
    place: async id => projects.get(id),
    build: async id => projects.set(id, { ...projects.get(id), status: 'BUILDING' })
  };
  const service = createEarlyGameService({ repository: new MemoryRepository(), bots, building, acquisition: { acquire: async input => { acquired.push(input); return { requestId: 'request', source: 'COLLECT' }; } }, capabilities: { execute: async (name,input,context) => { capabilityCalls.push({name,input,context}); if(name==='minecraft.farming')return {planted:8,harvested:0};if(name==='minecraft.reforestation')return {planted:4};return { suitable: true, strategicScore: 1 }; } }, environmentModel: { areaAt: async () => null }, events: new EventBus(), config: { intervalMs: 60_000 } });
  return { service, inventory, equipment, acquired, followed, projects, capabilityCalls };
}

function setInventory(target, values) { target.splice(0, target.length, ...Object.entries(values).map(([name, count]) => ({ name, count }))); }

test('automatic early game follows wood, stone, shelter, then iron progression', async () => {
  const context = setup(); await context.service.initialize(); await context.service.activate({ leader: 'bot1' }); context.service.stop();
  setInventory(context.inventory, { bread: 12 }); await context.service.tick(); assert.equal(context.acquired.at(-1).item, 'oak_log');
  setInventory(context.inventory, { bread: 12, oak_log: 24 }); await context.service.tick(); assert.equal(context.acquired.at(-1).item, 'cobblestone');
  setInventory(context.inventory, { bread: 12, oak_log: 24, cobblestone: 64 }); const shelter = await context.service.tick(); assert.equal(shelter.lastAction.reason, 'MATERIALS_NOT_READY');
  const shelterProject = [...context.projects.values()].find(value => value.metadata.templateId === 'early-shelter-v1'); shelterProject.status = 'COMPLETED';
  await context.service.tick(); assert.equal(context.acquired.at(-1).item, 'bread'); assert.equal(context.acquired.at(-1).purpose, 'automatic early game iron_expedition_food');
  setInventory(context.inventory, { bread: 16, oak_log: 24, cobblestone: 64 }); await context.service.tick(); assert.equal(context.acquired.at(-1).item, 'stone_sword');
  setInventory(context.inventory, { bread: 16, oak_log: 24, cobblestone: 64, stone_sword: 1 }); await context.service.tick(); assert.equal(context.acquired.at(-1).item, 'torch');
  setInventory(context.inventory, { bread: 16, oak_log: 24, cobblestone: 64, stone_sword: 1, torch: 16 }); await context.service.tick(); const iron = context.acquired.at(-1); assert.equal(iron.item, 'iron_ingot'); assert.equal(iron.strategy, 'CAVE_FIRST'); assert.equal(iron.combatEscort, true); assert.equal(iron.avoidStripMining, true);
  setInventory(context.inventory, { bread: 16, oak_log: 24, cobblestone: 64, stone_sword: 1, torch: 16, iron_ingot: 12 }); await context.service.tick(); assert.equal(context.acquired.at(-1).item, 'iron_chestplate');
  setInventory(context.inventory, { bread: 16, oak_log: 24, cobblestone: 64, stone_sword: 1, torch: 16, iron_ingot: 4, iron_chestplate: 1 }); await context.service.tick(); assert.equal(context.acquired.at(-1).item, 'shield');
  setInventory(context.inventory, { bread: 16, oak_log: 24, cobblestone: 64, stone_sword: 1, torch: 16, iron_ingot: 3, iron_chestplate: 1, shield: 1 }); await context.service.tick(); assert.equal(context.acquired.at(-1).item, 'iron_pickaxe');
});

test('squad stops resource work and regroups beyond the 15 block leash', async () => {
  const context = setup({ followerX: 30 }); await context.service.initialize(); await context.service.activate({ leader: 'bot1' }); context.service.stop(); setInventory(context.inventory, { bread: 12 });
  const result = await context.service.tick(); assert.equal(result.status, 'REGROUPING'); assert.deepEqual(result.separated, ['follower']); assert.equal(context.acquired.length, 0); assert.ok(context.followed.some(call => call.botId === 'follower' && call.range === 10));
});

test('completion requires verified renewable food and wood supplies and recognizes equipped gear', async () => {
  const context=setup();await context.service.initialize();await context.service.activate({leader:'bot1'});context.service.stop();for(const project of context.projects.values())project.status='COMPLETED';
  setInventory(context.inventory,{bread:16,oak_log:24,cobblestone:64,stone_sword:1,torch:16,iron_ingot:1,iron_pickaxe:1,coal:16,stone_hoe:1,wheat_seeds:8,oak_sapling:4});setInventory(context.equipment,{iron_chestplate:1,shield:1});
  const farm=await context.service.tick();assert.equal(farm.reason,'FARM_ESTABLISHED');assert.equal(farm.milestones.farmEstablished,true);
  const grove=await context.service.tick();assert.equal(grove.reason,'TREE_GROVE_ESTABLISHED');assert.equal(grove.milestones.treeGroveEstablished,true);
  const complete=await context.service.tick();assert.equal(complete.status,'COMPLETED');assert.equal(complete.stage,'SELF_SUFFICIENT');assert.deepEqual(complete.lastAction.renewableSupply,['wheat_farm','tree_grove']);assert.ok(context.capabilityCalls.some(call=>call.name==='minecraft.farming'));assert.ok(context.capabilityCalls.some(call=>call.name==='minecraft.reforestation'));
});
