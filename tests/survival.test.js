import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { MineflayerAdapter } from '../src/plugins/minecraft/mineflayer-adapter.js';
import { createAcquisitionService } from '../src/logistics/acquisition/acquisition-service.js';
import { createSurvivalService } from '../src/survival/survival-service.js';
import { EventBus } from '../src/core/event-bus.js';
import { createApplication } from '../src/index.js';

class SurvivalClient extends EventEmitter {
  constructor() {
    super(); this.entity = { position: new Vec3(0, 64, 0) }; this.game = { dimension: 'overworld' }; this.time = { isNight: true, timeOfDay: 14000 }; this.health = 20; this.food = 20; this.entities = {}; this.equipment = {}; this.heldItem = null; this.isSleeping = false;
    this.items = []; this.inventory = new EventEmitter(); this.inventory.items = () => this.items; this.inventory.slots = []; this.inventory.emptySlotCount = () => 36 - this.items.length; this.registry = { itemsByName: { leather_helmet: { maxDurability: 55 }, iron_helmet: { maxDurability: 165 }, diamond_helmet: { maxDurability: 363 } } }; this.blocks = new Map();
  }
  getEquipmentDestSlot(destination) { return { head: 5, torso: 6, legs: 7, feet: 8, 'off-hand': 45 }[destination]; }
  async equip(item, destination) { const previous = this.equipment[destination]; if (previous && destination !== 'hand') this.items.push(previous); if (destination !== 'hand') this.items = this.items.filter(entry => entry !== item); this.equipment[destination] = item; if (destination === 'hand') this.heldItem = item; }
  async unequip(destination) { const previous = this.equipment[destination]; if (previous) this.items.push(previous); delete this.equipment[destination]; if (destination === 'hand') this.heldItem = null; }
  async activateEntity(entity) { if (entity.name === 'sheep') { entity.sheared = true; addItem(this.items, 'white_wool', 2); } if (entity.name === 'cow') { addItem(this.items, 'bucket', -1); addItem(this.items, 'milk_bucket', 1); } }
  blockAt(position) { return this.blocks.get(positionKey(position)) ?? null; }
  async activateBlock(block) { block.properties.open = !block.properties.open; }
  findBlocks() { return [...this.blocks.values()].filter(block => block.name.endsWith('_bed')).map(block => block.position); }
  async sleep(block) { if (block.properties.occupied) throw new Error('occupied'); this.isSleeping = true; }
  async wake() { this.isSleeping = false; }
  clearControlStates() {}
  quit() { this.emit('end'); }
}

test('auto armor equips upgrades, rejects downgrade, and skips low durability candidates', async () => {
  const { adapter, client } = await readyAdapter(); client.equipment.head = { name: 'leather_helmet', count: 1, durabilityUsed: 0 }; client.items.push({ name: 'iron_helmet', count: 1, durabilityUsed: 0 }, { name: 'diamond_helmet', count: 1, durabilityUsed: 360 });
  const first = await adapter.autoEquipArmor({ preserveDurability: true, minimumDurability: 10, preferProtection: true, preferDurability: false, allowBindingCurse: false }); assert.equal(first.after.equipped.head.name, 'iron_helmet'); assert.equal(first.equipped.length, 1);
  const second = await adapter.autoEquipArmor({ preserveDurability: true, minimumDurability: 10, preferProtection: true, preferDurability: false, allowBindingCurse: false }); assert.equal(second.after.equipped.head.name, 'iron_helmet'); assert.equal(second.equipped.length, 0); await adapter.disconnect();
});

test('sheep and cow interactions verify wool and milk inventory deltas', async () => {
  const { adapter, client } = await readyAdapter(); client.items.push({ name: 'shears', count: 1 }, { name: 'bucket', count: 2 }); client.entities = { 1: { id: 1, type: 'mob', name: 'sheep', color: 'white', sheared: false, position: new Vec3(2, 64, 0) }, 2: { id: 2, type: 'mob', name: 'cow', position: new Vec3(3, 64, 0) } }; adapter.navigate = async input => { client.entity.position = new Vec3(input.x, input.y, input.z); return { position: client.entity.position }; };
  assert.equal(adapter.findSheep({ color: 'white', maxDistance: 16 }).entityId, '1'); const wool = await adapter.acquireWool({ color: 'white', count: 2, maxDistance: 16, minimumSheepReserve: 2, allowAnimalKill: false }, {}); assert.equal(wool.acquired, 2); assert.equal(wool.animalKilled, false);
  const milk = await adapter.acquireMilk({ count: 2, maxDistance: 16, minimumCowReserve: 2 }, {}); assert.equal(milk.acquired, 2); assert.equal(countItem(client.items, 'bucket'), 0); assert.equal(countItem(client.items, 'milk_bucket'), 2); await adapter.disconnect();
});

test('milk reports full inventory and an entity that disappears during movement', async () => {
  const { adapter, client } = await readyAdapter(); client.items.push({ name: 'bucket', count: 2 }); client.inventory.emptySlotCount = () => 0; client.entities = { 1: { id: 1, type: 'mob', name: 'cow', position: new Vec3(3, 64, 0) } }; adapter.navigate = async () => ({ position: client.entity.position });
  await assert.rejects(adapter.milkCow({ entityId: 1 }, {}), error => error.code === 'INVENTORY_FULL'); client.inventory.emptySlotCount = () => 1; adapter.navigate = async () => { delete client.entities[1]; return { position: client.entity.position }; };
  await assert.rejects(adapter.milkCow({ entityId: 1 }, {}), error => error.code === 'ENTITY_NOT_FOUND'); await adapter.disconnect();
});

test('animal resource movement honors AbortSignal cancellation', async () => {
  const { adapter, client } = await readyAdapter(); client.items.push({ name: 'shears', count: 1 }); client.entities = { 1: { id: 1, type: 'mob', name: 'sheep', color: 'white', sheared: false, position: new Vec3(4, 64, 0) } }; const controller = new AbortController(); controller.abort(new Error('survival task cancelled')); await assert.rejects(adapter.acquireWool({ color: 'white', count: 1, maxDistance: 16, minimumSheepReserve: 2, allowAnimalKill: false }, { signal: controller.signal }), /survival task cancelled/); await adapter.disconnect();
});

test('sleep lifecycle validates time, bed occupancy, and wake state', async () => {
  const { adapter, client } = await readyAdapter(); const bed = fakeBlock('white_bed', new Vec3(2, 64, 0), { occupied: false }); client.blocks.set(positionKey(bed.position), bed); adapter.navigate = async () => ({ position: bed.position }); const found = adapter.findBed({ maxDistance: 16 }); assert.deepEqual(found.position, { x: 2, y: 64, z: 0 }); const sleeping = await adapter.sleep({ position: bed.position, maxDistance: 16 }, {}); assert.equal(sleeping.state, 'SLEEPING'); assert.equal((await adapter.wake()).state, 'AWAKE'); client.time.isNight = false; client.time.timeOfDay = 6000; await assert.rejects(adapter.sleep({ position: bed.position, maxDistance: 16 }, {}), error => error.code === 'SLEEP_UNAVAILABLE'); await adapter.disconnect();
});

test('door and trapdoor interactions verify state and reject direct iron doors', async () => {
  const { adapter, client } = await readyAdapter(); const door = fakeBlock('oak_door', new Vec3(1, 64, 0), { open: false }); const trapdoor = fakeBlock('oak_trapdoor', new Vec3(2, 64, 0), { open: true }); const iron = fakeBlock('iron_door', new Vec3(3, 64, 0), { open: false }); for (const block of [door, trapdoor, iron]) client.blocks.set(positionKey(block.position), block);
  assert.equal((await adapter.openDoor({ position: door.position, cooldownMs: 100 })).after.open, true); assert.equal((await adapter.openDoor({ position: door.position, cooldownMs: 100 })).changed, false); assert.equal((await adapter.closeTrapdoor({ position: trapdoor.position, cooldownMs: 100 })).after.open, false); await assert.rejects(adapter.openDoor({ position: iron.position, cooldownMs: 100 }), error => error.code === 'CAPABILITY_UNAVAILABLE'); await adapter.disconnect();
});

test('acquisition resolves wool and milk through registered survival special sources', async () => {
  const items = []; const adapter = { snapshot: () => ({ inventorySummary: items, dimension: 'overworld', position: { x: 0, y: 64, z: 0 } }), craftRequirements: async ({ item }) => ({ craftable: ['shears', 'bucket'].includes(item), missing: [] }), craftItem: async ({ item, count }) => { addItem(items, item, count); return { item, count }; }, smeltRequirements: async () => null, findSourceBlocks: async () => [], acquireWool: async ({ count }) => { addItem(items, 'white_wool', count); return { acquired: count }; }, acquireMilk: async ({ count }) => { addItem(items, 'bucket', -count); addItem(items, 'milk_bucket', count); return { acquired: count }; } };
  const runtime = { id: 'survivor', bot: { id: 'survivor' }, options: { host: 'localhost', port: 25565 }, adapter }; const bots = { list: () => [{ id: 'survivor', status: 'READY', runtime: adapter.snapshot(), options: runtime.options }], get: () => runtime }; const events = new EventBus(); const acquisition = createAcquisitionService({ bots, logistics: null, events, logger: null, repository: null, config: {} }); createSurvivalService({ acquisition, events, logger: null, config: {} });
  const wool = await acquisition.acquire({ requesterBotId: 'survivor', type: 'ITEM', item: 'white_wool', count: 3 }); assert.equal(wool.source, 'special'); assert.equal(countItem(items, 'shears'), 1); assert.equal(countItem(items, 'white_wool'), 3);
  const milk = await acquisition.acquire({ requesterBotId: 'survivor', type: 'ITEM', item: 'milk_bucket', count: 2 }); assert.equal(milk.source, 'special'); assert.equal(countItem(items, 'milk_bucket'), 2);
});

test('survival capability executes through GoalService and TaskExecutor', async () => {
  class TaskAdapter extends EventEmitter { constructor() { super(); this.calls = 0; } async connect() { this.emit('login'); this.emit('spawn'); } async disconnect() { this.emit('end'); } snapshot() { return { connection: 'READY', position: { x: 0, y: 64, z: 0 }, dimension: 'overworld', health: 20, food: 20, inventorySummary: [], camera: { active: false } }; } async autoEquipArmor() { this.calls++; return { changed: false, verified: true }; } }
  const adapter = new TaskAdapter(); const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => adapter } }); try { const bot = app.bots.create({ id: 'survivor-task', username: 'SurvivorTask' }); await app.bots.start(bot.id); await app.bots.get(bot.id).transitionQueue; const goal = app.goals.create({ description: 'Evaluate armor', steps: [{ type: 'survival', input: {}, requiredCapabilities: ['minecraft.armor.auto-equip'] }] }); const result = await app.goals.run(goal.id); assert.equal(result.status, 'COMPLETED'); assert.ok(adapter.calls >= 1); } finally { await app.stop(); }
});

async function readyAdapter() { const client = new SurvivalClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); client.emit('spawn'); return { adapter, client }; }
function fakeBlock(name, position, properties) { return { name, position, properties, getProperties() { return { ...this.properties }; } }; }
function positionKey(position) { return `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`; }
function countItem(items, name) { return items.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0); }
function addItem(items, name, amount) { const item = items.find(entry => entry.name === name); if (!item && amount > 0) items.push({ name, count: amount }); else if (item) { item.count += amount; if (item.count <= 0) items.splice(items.indexOf(item), 1); } }
