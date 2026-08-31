import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApplication } from '../src/index.js';
import { MineflayerAdapter } from '../src/plugins/minecraft/mineflayer-adapter.js';
import { createRequire } from 'node:module';

class OperationalAdapter extends EventEmitter {
  constructor() { super(); this.status = 'READY'; this.messages = []; this.collected = []; this.items = []; this.position = { x: 1, y: 64, z: 2 }; }
  async connect() { this.connectCalls = (this.connectCalls ?? 0) + 1; this.status = 'READY'; this.emit('login'); this.emit('spawn'); }
  async disconnect() { this.status = 'DISCONNECTED'; this.emit('end'); }
  async chat(message) { this.messages.push(message); return { sent: true }; }
  async collect(input) { this.collected.push(input); return { block: input.block, collectedTargets: input.count }; }
  async craftItem({ item }) { this.items.push({ name: item, count: 1 }); return { item, count: 1 }; }
  async craftRequirements({ item, count }) { return { item, count, missing: [], steps: [] }; }
  async analyzeBlock({ block }) { const requiredTools = /stone|ore|obsidian/.test(block) ? ['wooden_pickaxe'] : []; return { block, diggable: true, handMineable: !requiredTools.length, requiredTools }; }
  async findSourceBlocks() { return []; }
  async smartMove(input) { this.lastMove = input; return { position: input }; }
  async setHome({ name = 'home' } = {}) { this.home = { name, x: 1, y: 64, z: 2 }; return this.home; }
  async goHome() { return { position: this.home }; }
  async dropItem({ item }) { const found = this.items.find(entry => entry.name === item && entry.count > 0); if (!found) throw new Error('missing item'); found.count--; this.worldDrop = item; return { item }; }
  async pickupItem({ item }) { this.items.push({ name: item, count: 1 }); return { item, collected: true }; }
  async navigate(input) { this.lastNavigate = input; this.position = { ...input }; return { position: input }; }
  async navigateTo({ position }) { this.lastNavigate = position; this.position = { ...position }; return { position }; }
  async stopNavigation() { this.navigationStopped = true; return { stopped: true }; }
  async resolveNavigationTarget({ type, username }) { if (type !== 'PLAYER' || username !== 'Alice') throw new Error('player is not visible'); return { x: 4, y: 64, z: 2 }; }
  async followPlayer(input) { this.following = input.username; return { player: input.username }; }
  async comeToPlayer(input) { this.cameTo = input.username; return { player: input.username }; }
  async findSheep() { return { entityId: 'sheep-1' }; }
  async shearSheep(input) { this.sheared = input.entityId; return { entityId: input.entityId, verified: true }; }
  async findCow() { return { entityId: 'cow-1' }; }
  async milkCow(input) { this.milked = input.entityId; return { entityId: input.entityId, verified: true }; }
  async sleep() { this.slept = true; return { state: 'SLEEPING' }; }
  async stopActions() {}
  async startViewer({ port, mode }) { this.camera = { active: true, port, mode }; return this.camera; }
  async stopViewer() { this.camera = { active: false, port: null }; return this.camera; }
  snapshot() { return { connection: this.status, position: { ...this.position }, health: 20, food: 20, inventorySummary: this.items.filter(item => item.count > 0), plugins: {}, camera: this.camera ?? { active: false, port: null }, timestamp: new Date().toISOString() }; }
}

async function waitFor(predicate, timeout = 1000) {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > timeout) throw new Error('Timed out waiting for condition'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test('authorized chat command creates and completes a real capability goal', async () => {
  let adapter;
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent', MINEHIVE_ADMINS: 'Alice' }, overrides: { adapterFactory: () => (adapter = new OperationalAdapter()) } });
  app.bots.create({ id: 'worker', username: 'Worker' }); await app.bots.start('worker'); await app.bots.get('worker').transitionQueue;
  adapter.emit('chat', 'Mallory', '!worker collect oak_log 2');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(app.goals.list().length, 0);
  adapter.emit('chat', 'Alice', '!hive collect oak_log 2');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(app.goals.list().length, 0);
  adapter.emit('chat', 'Alice', '!worker collect oak_log 2');
  await waitFor(() => app.goals.list()[0]?.status === 'COMPLETED');
  assert.deepEqual(adapter.collected, [{ block: 'oak_log', count: 2 }]); assert.ok(adapter.messages.some(message => message.includes('coordinator completed'))); assert.ok(adapter.messages.some(message => message.includes('task baru: collect'))); assert.ok(adapter.messages.some(message => message.includes('task selesai: collect')));
  adapter.emit('chat', 'Alice', '!worker shear'); await waitFor(() => adapter.sheared === 'sheep-1'); adapter.emit('chat', 'Alice', '!worker milk'); await waitFor(() => adapter.milked === 'cow-1'); adapter.emit('chat', 'Alice', '!worker sleep'); await waitFor(() => adapter.slept === true);
  adapter.emit('chat', 'Alice', '!worker follow Bob'); await waitFor(() => adapter.following === 'Bob'); adapter.emit('chat', 'Alice', '!worker come'); await waitFor(() => adapter.lastNavigate?.x === 4); adapter.emit('chat', 'Alice', '!worker goto 8 64 -2'); await waitFor(() => adapter.lastNavigate?.x === 8); adapter.emit('chat', 'Alice', '!worker berapa 1+1'); await waitFor(() => adapter.messages.some(message => message.includes('1 + 1 = 2'))); assert.equal(adapter.following, 'Bob'); assert.equal(adapter.lastNavigate.z, -2); await app.stop();
});

test('class and global selectors route commands to the intended bots', async () => {
  const adapters = new Map();
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent', MINEHIVE_ADMINS: 'Alice' }, overrides: { adapterFactory: input => { const adapter = new OperationalAdapter(); adapters.set(input.id, adapter); return adapter; } } });
  app.bots.create({ id: 'miner-1', name: 'MinerOne', metadata: { commandAlias: 'one', className: 'miner' } });
  app.bots.create({ id: 'builder-1', name: 'BuilderOne', metadata: { commandAlias: 'two', className: 'builder' } });
  await app.bots.start('miner-1'); await app.bots.start('builder-1'); await Promise.all(['miner-1', 'builder-1'].map(id => app.bots.get(id).transitionQueue));
  for (const adapter of adapters.values()) adapter.emit('chat', 'Alice', '!miner collect stone 1');
  await waitFor(() => adapters.get('miner-1').collected.length === 1); assert.equal(adapters.get('builder-1').collected.length, 0);
  for (const adapter of adapters.values()) adapter.emit('chat', 'Alice', '!global collect dirt 2');
  await waitFor(() => adapters.get('miner-1').collected.length === 2 && adapters.get('builder-1').collected.length === 1);
});

test('bot profile editor updates identity and protects live connection settings', async () => {
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => new OperationalAdapter() } }); const bot = await app.botProfiles.create({ username: 'Worker', name: 'Worker', host: 'localhost', port: 25565, commandAlias: 'worker', className: 'miner' }); await app.bots.start(bot.id); await app.bots.get(bot.id).transitionQueue;
  const edited = await app.botProfiles.update(bot.id, { name: 'Logistics Worker', commandAlias: 'courier', className: 'logistics', autoConnect: true }); assert.equal(edited.name, 'Logistics Worker'); assert.equal(edited.metadata.commandAlias, 'courier'); await assert.rejects(app.botProfiles.update(bot.id, { host: 'other-server' }), /Disconnect bot/);
  await app.bots.stop(bot.id); const moved = await app.botProfiles.update(bot.id, { host: 'other-server', port: 25566 }); assert.equal(app.bots.get(bot.id).options.host, 'other-server'); assert.equal((await app.botProfiles.list())[0].port, 25566); assert.equal(moved.status, 'OFFLINE'); await app.stop();
});

test('Mineflayer adapter normalizes client chat, snapshot and shutdown', async () => {
  class Client extends EventEmitter {
    constructor() { super(); this.username = 'Bot'; this.health = 20; this.food = 19; this.game = { dimension: 'overworld' }; this.entity = { position: { x: 1, y: 2, z: 3 } }; this.inventory = { items: () => [{ name: 'dirt', count: 4 }] }; this.sent = []; }
    chat(message) { this.sent.push(message); }
    clearControlStates() { this.cleared = true; }
    quit(reason) { this.reason = reason; this.emit('end'); }
  }
  const client = new Client(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false });
  await adapter.connect({ username: 'Bot' }); client.emit('spawn'); await adapter.chat('hello');
  assert.equal((await adapter.setHome({ name: 'base' })).name, 'base');
  assert.deepEqual(adapter.snapshot().position, { x: 1, y: 2, z: 3 }); assert.deepEqual(client.sent, ['hello']);
  await adapter.disconnect('done'); assert.equal(client.cleared, true); assert.equal(client.reason, 'done'); assert.equal(adapter.status, 'DISCONNECTED');
});

test('Mineflayer survey detects supported markers and removes duplicate positions', async () => {
  const { Vec3 } = await import('vec3');
  class SurveyClient extends EventEmitter {
    constructor() { super(); this.entity = { position: new Vec3(0, 64, 0) }; this.game = { dimension: 'overworld' }; this.inventory = { items: () => [] }; this.registry = { blocksByName: { bell: { id: 1 }, end_portal_frame: { id: 2 }, diamond_ore: { id: 3 } } }; }
    findBlocks({ matching }) { if (matching === 1) return [new Vec3(8, 65, 4), new Vec3(8, 65, 4)]; if (matching === 2) return [new Vec3(-12, 30, 9)]; return []; }
    clearControlStates() {} quit() { this.emit('end'); }
  }
  const client = new SurveyClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); client.emit('spawn'); const result = await adapter.survey({ maxDistance: 256 });
  assert.equal(result.maxDistance, 128); assert.deepEqual(result.discoveries.map(discovery => discovery.type), ['village', 'stronghold']); assert.deepEqual(result.discoveries[0].position, { x: 8, y: 65, z: 4 }); await adapter.disconnect();
});

test('movement policy disables risky shortcuts and enables safe wooden door navigation', async () => {
  class Movements { constructor() { this.allow1by1towers = true; this.allowParkour = true; this.allowFreeMotion = true; this.scafoldingBlocks = [1, 2]; this.placeCost = 1; this.maxDropDown = 4; this.canOpenDoors = false; this.openable = new Set([99]); } }
  class MovementClient extends EventEmitter { constructor() { super(); this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.inventory = { items: () => [] }; this.registry = { blocksArray: [{ id: 4, name: 'oak_door' }, { id: 5, name: 'oak_trapdoor' }, { id: 6, name: 'iron_door' }] }; this.pathfinder = { setMovements: movements => { this.movements = movements; }, setGoal() {} }; } clearControlStates() {} quit() { this.emit('end'); } }
  const client = new MovementClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); adapter.pathfinderModule = { Movements }; client.emit('spawn'); await new Promise(resolve => setImmediate(resolve)); assert.equal(client.movements.allow1by1towers, false); assert.equal(client.movements.allowParkour, false); assert.deepEqual(client.movements.scafoldingBlocks, []); assert.equal(client.movements.placeCost, Number.POSITIVE_INFINITY); assert.equal(client.movements.maxDropDown, 3); assert.equal(client.movements.canOpenDoors, true); assert.equal(client.movements.openable.has(4), true); assert.equal(client.movements.openable.has(5), false); assert.equal(client.movements.openable.has(6), false); assert.equal(client.movements.openable.has(99), true); await adapter.disconnect();
});

test('movement setup failures become observable plugin errors', async () => {
  class BrokenMovements { constructor() { throw new Error('movement setup failed'); } }
  class MovementClient extends EventEmitter { constructor() { super(); this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.inventory = { items: () => [] }; this.pathfinder = { setGoal() {} }; } clearControlStates() {} quit() { this.emit('end'); } }
  const client = new MovementClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); adapter.pathfinderModule = { Movements: BrokenMovements }; const failure = new Promise(resolve => adapter.once('pluginError', resolve)); client.emit('spawn'); const event = await failure; assert.equal(event.plugin, 'movement'); assert.match(event.error.message, /setup failed/); assert.equal(adapter.status, 'DEGRADED'); await adapter.disconnect();
});

test('movement commands reject non-numeric ranges before pathfinding', async () => {
  class GoalNear { constructor() { throw new Error('goal must not be constructed'); } } class MovementClient extends EventEmitter { constructor() { super(); this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.inventory = { items: () => [] }; this.pathfinder = { setGoal() {}, goto() {} }; } clearControlStates() {} quit() { this.emit('end'); } }
  const client = new MovementClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); adapter.pathfinderModule = { goals: { GoalNear } }; client.emit('spawn'); await assert.rejects(adapter.navigate({ x: 1, y: 64, z: 1, range: 'invalid' }), /range must be numeric/); await assert.rejects(adapter.survey({ maxDistance: Number.NaN }), /distance must be numeric/); await adapter.disconnect();
});

test('navigation rejects a path that requires automatic block placement', async () => {
  class GoalNear { constructor(x, y, z, range) { Object.assign(this, { x, y, z, range }); } }
  class ScaffoldClient extends EventEmitter { constructor() { super(); this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.inventory = { items: () => [] }; this.pathfinder = { goto: async () => { queueMicrotask(() => this.emit('path_update', { path: [{ toPlace: [{ x: 0, y: 63, z: 0 }] }] })); return new Promise(() => {}); }, setGoal() {} }; } clearControlStates() {} quit() { this.emit('end'); } }
  const client = new ScaffoldClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); adapter.pathfinderModule = { goals: { GoalNear } }; client.emit('spawn'); await assert.rejects(adapter.navigate({ x: 0, y: 70, z: 0 }), /requires scaffolding/); await adapter.disconnect();
});

test('Mineflayer storage adapter verifies chest deposits and withdrawals', async () => {
  const { Vec3 } = await import('vec3'); class GoalNear { constructor(x, y, z, range) { Object.assign(this, { x, y, z, range }); } }
  class StorageClient extends EventEmitter {
    constructor() { super(); this.entity = { position: new Vec3(0, 64, 0) }; this.game = { dimension: 'overworld' }; this.botItems = [{ name: 'stone', type: 1, count: 8 }]; this.chestItems = [{ name: 'stone', type: 1, count: 10 }]; this.inventory = { items: () => this.botItems.filter(item => item.count > 0) }; this.registry = { itemsByName: { stone: { id: 1 } } }; this.pathfinder = { goto: async goal => { this.entity.position = new Vec3(goal.x, goal.y, goal.z); }, setGoal() {} }; this.storageBlock = { name: 'chest', position: new Vec3(3, 64, 0) }; }
    findBlock() { return this.storageBlock; } blockAt() { return this.storageBlock; }
    async openContainer() { const slots = new Array(63); slots[0] = { ...this.chestItems[0] }; slots[27] = { ...this.botItems[0] }; return { type: 'minecraft:chest', inventoryStart: 27, inventoryEnd: 63, slots, containerItems: () => slots.slice(0, 27).filter(item => item?.count > 0), deposit: async (_type, _metadata, count) => { setTimeout(() => { slots[27].count -= count; slots[0].count += count; }, 40); }, withdraw: async (_type, _metadata, count) => { setTimeout(() => { slots[0].count -= count; slots[27].count += count; }, 40); }, close: () => { this.botItems[0].count = slots[27].count; this.chestItems[0].count = slots[0].count; } }; }
    clearControlStates() {} quit() { this.emit('end'); }
  }
  const client = new StorageClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); adapter.pathfinderModule = { goals: { GoalNear } }; client.emit('spawn'); const found = await adapter.findNearestStorage({ maxDistance: 16 }); assert.equal(found.inventory[0].count, 10);
  const deposited = await adapter.depositStorage({ position: found.position, item: 'stone', count: 5 }); assert.equal(deposited.verification.storageAfter, 15); const withdrawn = await adapter.withdrawStorage({ position: found.position, item: 'stone', count: 4 }); assert.equal(withdrawn.verification.botAfter, 7); await adapter.disconnect();
});

test('come is one-shot navigation while follow keeps a dynamic player goal', async () => {
  class GoalNear { constructor(x, y, z, range) { Object.assign(this, { kind: 'near', x, y, z, range }); } } class GoalFollow { constructor(entity, range) { Object.assign(this, { kind: 'follow', entity, range }); } }
  class MoveClient extends EventEmitter { constructor() { super(); this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.inventory = { items: () => [] }; this.players = { Steve: { entity: { position: { x: 10, y: 64, z: 5 } } } }; this.pathfinder = { goto: async goal => { this.gotoGoal = goal; this.entity.position = { x: goal.x, y: goal.y, z: goal.z }; }, setGoal: (goal, dynamic) => { this.followGoal = goal; this.dynamic = dynamic; } }; } clearControlStates() {} quit() { this.emit('end'); } }
  const client = new MoveClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); adapter.pathfinderModule = { goals: { GoalNear, GoalFollow } }; client.emit('spawn'); await adapter.comeToPlayer({ username: 'Steve' }); assert.equal(client.gotoGoal.kind, 'near'); await adapter.followPlayer({ username: 'Steve' }); assert.equal(client.followGoal.kind, 'follow'); assert.equal(client.dynamic, true); await adapter.disconnect();
});

test('crafting capability resolves a ready recipe', async () => {
  class CraftClient extends EventEmitter {
    constructor() { super(); this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.health = 20; this.food = 20; this.items = [{ name: 'oak_planks', type: 1, count: 3 }, { name: 'stick', type: 2, count: 2 }];
      this.inventory = { items: () => this.items }; this.registry = { itemsByName: { wooden_pickaxe: { id: 3 } }, items: { 1: { name: 'oak_planks' }, 2: { name: 'stick' } }, blocksByName: { crafting_table: { id: 4 } } };
      this.recipe = { result: { id: 3, count: 1 }, delta: [{ id: 1, count: -3 }, { id: 2, count: -2 }], requiresTable: false }; }
    findBlock() { return null; } recipesAll() { return [this.recipe]; } recipesFor() { return [this.recipe]; }
    async craft() { this.items.push({ name: 'wooden_pickaxe', type: 3, count: 1 }); }
    clearControlStates() {} quit() { this.emit('end'); }
  }
  const client = new CraftClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); client.emit('spawn');
  const result = await adapter.craftItem({ item: 'wooden_pickaxe', count: 1 }); assert.equal(result.count, 1); await adapter.disconnect();
});

test('crafting builds and safely places a required crafting table', async () => {
  const { Vec3 } = await import('vec3');
  class TableCraftClient extends EventEmitter {
    constructor() { super(); this.entity = { position: new Vec3(0, 64, 0) }; this.game = { dimension: 'overworld' }; this.items = [{ name: 'oak_planks', type: 1, count: 7 }, { name: 'stick', type: 2, count: 2 }]; this.placed = false;
      this.inventory = { items: () => this.items }; this.registry = { itemsByName: { oak_planks: { id: 1 }, stick: { id: 2 }, wooden_pickaxe: { id: 3 }, crafting_table: { id: 4 } }, items: { 1: { name: 'oak_planks' }, 2: { name: 'stick' } }, blocksByName: { crafting_table: { id: 4 } } };
      this.pickaxeRecipe = { result: { id: 3, count: 1 }, delta: [{ id: 1, count: -3 }, { id: 2, count: -2 }], requiresTable: true }; this.tableRecipe = { result: { id: 4, count: 1 }, delta: [{ id: 1, count: -4 }], requiresTable: false }; }
    findBlock() { return this.placed ? { name: 'crafting_table', position: new Vec3(1, 64, 0) } : null; }
    recipesAll(id) { return id === 4 ? [this.tableRecipe] : [this.pickaxeRecipe]; } recipesFor(id) { return id === 4 ? [this.tableRecipe] : [this.pickaxeRecipe]; }
    async craft(recipe) { if (recipe === this.tableRecipe) this.items.push({ name: 'crafting_table', type: 4, count: 1 }); else this.items.push({ name: 'wooden_pickaxe', type: 3, count: 1 }); }
    blockAt(position) { return position.y === 63 ? { name: 'stone', position } : { name: 'air', position }; } async equip() {} async placeBlock() { this.placed = true; this.items.find(item => item.name === 'crafting_table').count = 0; }
    clearControlStates() {} quit() { this.emit('end'); }
  }
  const client = new TableCraftClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); client.emit('spawn');
  const result = await adapter.craftItem({ item: 'wooden_pickaxe' }); assert.equal(result.count, 1); assert.equal(client.placed, true); await adapter.disconnect();
});

test('navigation accepts a door activation step and continues to its destination', async () => {
  class GoalNear { constructor(x, y, z, range) { Object.assign(this, { x, y, z, range }); } }
  class DoorClient extends EventEmitter { constructor() { super(); this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.inventory = { items: () => [] }; this.pathfinder = { goto: async goal => { this.emit('path_update', { path: [{ toPlace: [{ x: 1, y: 64, z: 0, useOne: true }] }] }); this.entity.position = { x: goal.x, y: goal.y, z: goal.z }; this.emit('move'); }, setGoal() {} }; } clearControlStates() {} quit() { this.emit('end'); } }
  const client = new DoorClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); adapter.pathfinderModule = { goals: { GoalNear } }; client.emit('spawn'); const result = await adapter.navigate({ x: 2, y: 64, z: 0, range: 1 }); assert.deepEqual(result.position, { x: 2, y: 64, z: 0 }); await adapter.disconnect();
});

test('crafting executes every registry wood and stone tool material recipe', async () => {
  const require = createRequire(import.meta.url); const registry = require('prismarine-registry')('1.20.4'); const Recipe = require('prismarine-recipe')(registry).Recipe; const materials = { wooden_sword: ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'crimson_planks', 'warped_planks', 'mangrove_planks', 'bamboo_planks', 'cherry_planks'], stone_pickaxe: ['cobblestone', 'blackstone', 'cobbled_deepslate'] };
  class MaterialClient extends EventEmitter {
    constructor(output, material) { super(); this.registry = registry; this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.items = [{ name: material, type: registry.itemsByName[material].id, count: output === 'wooden_sword' ? 2 : 3 }, { name: 'stick', type: registry.itemsByName.stick.id, count: output === 'wooden_sword' ? 1 : 2 }]; this.inventory = { items: () => this.items }; this.table = { name: 'crafting_table', position: { x: 1, y: 64, z: 0 } }; }
    findBlock() { return this.table; } recipesAll(id, metadata, table) { return Recipe.find(id, metadata).filter(recipe => !recipe.requiresTable || table); }
    async craft(recipe, count) { for (const delta of recipe.delta) { const name = registry.items[delta.id]?.name; const existing = this.items.find(item => item.name === name); if (existing) existing.count += delta.count * count; else if (delta.count > 0) this.items.push({ name, type: delta.id, count: delta.count * count }); } }
    clearControlStates() {} quit() { this.emit('end'); }
  }
  for (const [output, variants] of Object.entries(materials)) for (const material of variants) { const client = new MaterialClient(output, material); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); client.emit('spawn'); const result = await adapter.craftItem({ item: output, count: 1 }); assert.equal(result.inventory.find(item => item.name === output)?.count, 1, `${output} must accept ${material}`); await adapter.disconnect(); }
  const woodSources = [['oak_log', 1], ['spruce_log', 1], ['birch_log', 1], ['jungle_log', 1], ['acacia_log', 1], ['dark_oak_log', 1], ['crimson_stem', 1], ['warped_stem', 1], ['mangrove_log', 1], ['bamboo_block', 2], ['cherry_log', 1]];
  for (const [source, count] of woodSources) { const client = new MaterialClient('wooden_sword', 'oak_planks'); client.items = [{ name: source, type: registry.itemsByName[source].id, count }]; const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); client.emit('spawn'); const result = await adapter.craftItem({ item: 'wooden_sword', count: 1 }); assert.equal(result.inventory.find(item => item.name === 'wooden_sword')?.count, 1, `wooden_sword must craft recursively from ${source}`); await adapter.disconnect(); }
});

test('smelting produces verified iron and cooked food', async () => {
  class SmeltingClient extends EventEmitter {
    constructor(inputName, outputName) { super(); this.inputName = inputName; this.outputName = outputName; this.items = [{ name: inputName, type: 1, count: 2 }, { name: 'coal', type: 2, count: 1 }]; this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.inventory = { items: () => this.items }; this.registry = { itemsByName: { [inputName]: { id: 1 }, coal: { id: 2 }, [outputName]: { id: 3 } }, blocksByName: { furnace: { id: 10 } } }; }
    findBlock() { return { name: 'furnace', position: { x: 1, y: 64, z: 0 } }; }
    async openFurnace() { let outputCount = 0; let inputCount = 0; return { inputItem: () => null, outputItem: () => outputCount ? { name: this.outputName, count: outputCount } : null, putInput: async (_type, _metadata, count) => { this.items.find(item => item.name === this.inputName).count -= count; inputCount = count; }, putFuel: async (_type, _metadata, count) => { this.items.find(item => item.name === 'coal').count -= count; outputCount = inputCount; }, takeOutput: async () => { this.items.push({ name: this.outputName, type: 3, count: outputCount }); outputCount = 0; }, close() {} }; }
    clearControlStates() {} quit() { this.emit('end'); }
  }
  for (const recipe of [{ input: 'raw_iron', output: 'iron_ingot' }, { input: 'beef', output: 'cooked_beef' }]) { const client = new SmeltingClient(recipe.input, recipe.output); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); client.emit('spawn'); const plan = await adapter.smeltRequirements({ item: recipe.output, count: 2 }); assert.equal(plan.input.name, recipe.input); const result = await adapter.smeltItem({ item: recipe.output, count: 2, fuel: 'coal' }, {}); assert.equal(result.count, 2); assert.equal(adapter.snapshot().inventorySummary.find(item => item.name === recipe.output).count, 2); assert.equal(adapter.snapshot().inventorySummary.find(item => item.name === recipe.input).count, 0); await adapter.disconnect(); }
});

test('registry analysis identifies mandatory tools and recursive raw materials', async () => {
  const require = createRequire(import.meta.url); const registry = require('prismarine-registry')('1.20.4'); const Recipe = require('prismarine-recipe')(registry).Recipe;
  class RegistryClient extends EventEmitter {
    constructor(items = []) { super(); this.registry = registry; this.entity = { position: { x: 0, y: 64, z: 0 } }; this.game = { dimension: 'overworld' }; this.inventory = { items: () => items }; }
    recipesAll(id, metadata, table) { return Recipe.find(id, metadata).filter(recipe => !recipe.requiresTable || table); } findBlock() { return null; } clearControlStates() {} quit() { this.emit('end'); }
  }
  const client = new RegistryClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); client.emit('spawn');
  const block = await adapter.analyzeBlock({ block: 'iron_ore' }); assert.equal(block.handMineable, false); assert.ok(block.requiredTools.includes('stone_pickaxe')); assert.ok(!block.requiredTools.includes('wooden_pickaxe'));
  const plan = await adapter.craftRequirements({ item: 'wooden_pickaxe', count: 1 }); assert.deepEqual(plan.missing, [{ name: 'oak_log', count: 3 }]); assert.ok((await adapter.findSourceBlocks({ item: 'diamond' })).includes('diamond_ore'));
  assert.deepEqual(await adapter.smeltRequirements({ item: 'iron_ingot', count: 9 }), { item: 'iron_ingot', count: 9, input: { name: 'raw_iron', count: 9 }, fuel: { name: 'coal', count: 2 }, furnace: false }); await adapter.disconnect();

  const items = [{ name: 'birch_log', count: 2, type: registry.itemsByName.birch_log.id }, { name: 'cobbled_deepslate', count: 3, type: registry.itemsByName.cobbled_deepslate.id }]; const materialClient = new RegistryClient(items); const materialAdapter = new MineflayerAdapter({ factory: () => materialClient, plugins: false }); await materialAdapter.connect({}); materialClient.emit('spawn');
  const sword = await materialAdapter.craftRequirements({ item: 'wooden_sword' }); assert.equal(sword.missing.length, 0); assert.ok(sword.selectedRecipe.ingredients.some(item => item.name === 'birch_planks'));
  const pickaxe = await materialAdapter.craftRequirements({ item: 'stone_pickaxe' }); assert.equal(pickaxe.missing.length, 0); assert.ok(pickaxe.selectedRecipe.ingredients.some(item => item.name === 'cobbled_deepslate')); await materialAdapter.disconnect();
});

test('deforestation removes the connected trunk and replants its sapling', async () => {
  const { Vec3 } = await import('vec3');
  class ForestClient extends EventEmitter {
    constructor() { super(); this.entity = { position: new Vec3(0, 64, 0) }; this.game = { dimension: 'overworld' }; this.health = 20; this.food = 20; this.items = [{ name: 'oak_sapling', count: 1 }]; this.inventory = { items: () => this.items }; this.blocks = new Map([['0,63,0', 'dirt'], ['0,64,0', 'oak_log'], ['0,65,0', 'oak_log'], ['0,66,0', 'oak_log']]); this.collectBlock = { collect: async blocks => { for (const block of blocks) this.blocks.delete(this.key(block.position)); }, cancelTask: async () => {} }; }
    key(position) { return `${position.x},${position.y},${position.z}`; } findBlocks() { return [new Vec3(0, 64, 0)]; } blockAt(position) { const name = this.blocks.get(this.key(position)) ?? 'air'; return { name, position }; } async equip() {} async placeBlock(ground) { this.blocks.set(this.key(ground.position.offset(0, 1, 0)), 'oak_sapling'); this.items[0].count--; } clearControlStates() {} quit() { this.emit('end'); }
  }
  const client = new ForestClient(); const adapter = new MineflayerAdapter({ factory: () => client, plugins: false }); await adapter.connect({}); client.emit('spawn'); const result = await adapter.deforest({ count: 1, replant: true }); assert.equal(result.logs, 3); assert.equal(result.replanted, 1); assert.equal(client.blocks.get('0,64,0'), 'oak_sapling'); await adapter.disconnect();
});

test('unexpected disconnect triggers bounded reconnect', async () => {
  let adapter;
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent', MINEHIVE_RECONNECT: 'true', MINEHIVE_RECONNECT_ATTEMPTS: '2', MINEHIVE_RECONNECT_DELAY_MS: '1' }, overrides: { adapterFactory: () => (adapter = new OperationalAdapter()) } });
  const bot = app.bots.create({ id: 'recoverable' }); await app.bots.start(bot.id); await app.bots.get(bot.id).transitionQueue;
  adapter.status = 'DISCONNECTED'; adapter.emit('end', 'network');
  await waitFor(() => adapter.connectCalls === 2); await app.bots.get(bot.id).transitionQueue;
  assert.equal(app.bots.get(bot.id).snapshot().status, 'READY'); await app.stop();
});

test('each bot camera receives an independent live-view port', async () => {
  const adapters = [];
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent', MINEHIVE_VIEWER_BASE_PORT: '43100' }, overrides: { adapterFactory: () => { const adapter = new OperationalAdapter(); adapters.push(adapter); return adapter; } } });
  app.bots.create({ id: 'camera-a' }); app.bots.create({ id: 'camera-b' }); await app.bots.start('camera-a'); await app.bots.start('camera-b');
  await Promise.all(app.bots.list().map(bot => app.bots.get(bot.id).transitionQueue));
  await assert.rejects(app.startCamera('camera-a', 'invalid'), /Viewer mode/);
  const first = await app.startCamera('camera-a', 'surrounding'); const second = await app.startCamera('camera-b', 'first_person');
  assert.notEqual(first.port, second.port); assert.equal(first.mode, 'surrounding'); assert.equal(second.mode, 'first_person'); assert.equal(app.bots.get('camera-a').snapshot().runtime.camera.active, true);
  await app.stopCamera('camera-a'); assert.equal(app.bots.get('camera-a').snapshot().runtime.camera.active, false); await app.stop();
});
