import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApplication } from '../src/index.js';
import { LlmGateway, OpenAICompatibleProvider } from '../src/ai/llm-gateway.js';
import { EventEmitter } from 'node:events';

class FleetAdapter extends EventEmitter {
  constructor(items = [], { position = { x: 1, y: 64, z: 1 }, requireMaterials = false } = {}) { super(); this.status = 'READY'; this.items = items.map(value => typeof value === 'string' ? { name: value, count: 1 } : { ...value }); this.storageItems = []; this.collected = []; this.position = position; this.requireMaterials = requireMaterials; }
  async connect() { this.emit('login'); this.emit('spawn'); }
  async disconnect() { this.emit('end'); }
  async smartMove(input) { this.movedTo = input; }
  async dropItem({ item, count = 1 }) { this.items.find(entry => entry.name === item).count -= count; this.dropped = item; }
  async pickupItem({ item, count = 1 }) { this.items.push({ name: item, count }); }
  async analyzeBlock({ block }) { const requiredTools = /stone|ore|obsidian/.test(block) ? ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'] : []; return { block, diggable: true, handMineable: !requiredTools.length, requiredTools }; }
  async craftRequirements({ item, count }) { return { item, count, missing: this.requireMaterials && item.endsWith('_pickaxe') && this.count('oak_log') < 3 ? [{ name: 'oak_log', count: 3 - this.count('oak_log') }] : [], steps: [{ item, crafts: count }] }; }
  async findSourceBlocks({ item }) { return item === 'oak_log' ? ['oak_log'] : []; }
  async survey({ maxDistance }) { this.surveyed = maxDistance; return { maxDistance, scannedAt: new Date().toISOString(), discoveries: [{ type: 'village', name: 'bell', marker: 'bell', confidence: 0.95, position: { x: 24, y: 70, z: -12 } }] }; }
  async findNearestStorage() { return this.storageObservation(); }
  async inspectStorage() { return this.storageObservation(); }
  async depositStorage({ item, count }) { const source = this.items.find(entry => entry.name === item); const beforeBot = this.count(item); const beforeStorage = this.storageCount(item); source.count -= count; const stored = this.storageItems.find(entry => entry.name === item); if (stored) stored.count += count; else this.storageItems.push({ name: item, count }); return { item, transferred: count, storage: this.storageObservation(), verification: { botBefore: beforeBot, botAfter: this.count(item), storageBefore: beforeStorage, storageAfter: this.storageCount(item) } }; }
  async withdrawStorage({ item, count }) { const source = this.storageItems.find(entry => entry.name === item); const beforeBot = this.count(item); const beforeStorage = this.storageCount(item); source.count -= count; const carried = this.items.find(entry => entry.name === item); if (carried) carried.count += count; else this.items.push({ name: item, count }); return { item, transferred: count, storage: this.storageObservation(), verification: { botBefore: beforeBot, botAfter: this.count(item), storageBefore: beforeStorage, storageAfter: this.storageCount(item) } }; }
  storageObservation() { return { kind: 'chest', position: { x: 3, y: 64, z: 1 }, inventory: this.storageItems.filter(item => item.count > 0), capacitySlots: 27, occupiedSlots: this.storageItems.filter(item => item.count > 0).length }; }
  storageCount(name) { return this.storageItems.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0); }
  async craftItem({ item }) { if (this.requireMaterials && item.endsWith('_pickaxe') && this.count('oak_log') < 3) throw new Error('missing wood'); this.items.push({ name: item, count: 1 }); }
  async collect(input) { this.collected.push(input); if (input.block === 'oak_log') this.items.push({ name: 'oak_log', count: input.count }); return { collectedTargets: input.count }; }
  async farm(input) { this.farmed = input; return input; }
  async deforest(input) { this.deforested = input; return { trees: 1, logs: 5, replanted: 1, sites: [{ x: 2, y: 64, z: 2, log: 'oak_log' }] }; }
  async reforest(input) { this.reforested = input; return { planted: input.sites.length }; }
  async startCombat(input) { this.combat = input; return { mode: input.mode.toUpperCase(), status: 'ACTIVE' }; }
  async comeToPlayer(input) { this.cameTo = input; return input; }
  async followPlayer(input) { this.following = input; return input; }
  count(name) { return this.items.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0); }
  async stopActions() {}
  snapshot() { return { connection: 'READY', position: this.position, dimension: 'overworld', health: 20, food: 20, inventorySummary: this.items.filter(item => item.count > 0), camera: { active: false }, timestamp: new Date().toISOString() }; }
}

test('local OpenAI-compatible LLM returns a validated coordinator intent', async () => {
  let requestBody; const server = createServer(async (request, response) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); requestBody = JSON.parse(Buffer.concat(chunks)); response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: '{"intent":"collect","selector":"class:miner","block":"stone","item":null,"count":8,"player":null,"x":null,"y":null,"z":null,"home":null}' } }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const gateway = new LlmGateway({ provider: 'local', localEndpoint: `http://127.0.0.1:${server.address().port}`, localModel: 'test', localStructuredOutput: false, timeoutMs: 1000 }, { warn() {} });
    const fleet = [{ id: 'bot1', position: { x: 1, y: 64, z: 1 }, inventory: [{ name: 'stone_pickaxe', count: 1 }], nearby: [] }]; const result = await gateway.interpret('get stone', { fleet }); assert.equal(result.intent, 'collect'); assert.equal(result.block, 'stone'); assert.equal(result.count, 8); assert.equal(requestBody.max_tokens, 10); assert.deepEqual(JSON.parse(requestBody.messages[1].content).fleet, fleet);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('OpenRouter provider rotates to the next key after a rate limit', async () => {
  const seen = []; const server = createServer(async (request, response) => { for await (const _ of request) {} const authorization = request.headers.authorization; seen.push(authorization); if (authorization === 'Bearer key-one') { response.writeHead(429, { 'retry-after': '60' }); return response.end('limited'); } response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: '{"intent":"status"}' } }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = new OpenAICompatibleProvider({ endpoint: `http://127.0.0.1:${server.address().port}`, apiKeys: ['key-one', 'key-two', 'key-three'], model: 'test', structuredOutput: false, timeoutMs: 1000 });
    assert.equal(await provider.complete([{ role: 'user', content: 'status' }], {}), '{"intent":"status"}'); assert.deepEqual(seen, ['Bearer key-one', 'Bearer key-two']); assert.deepEqual(provider.status(), { keyCount: 3, activeKey: 2, availableKeys: 2 });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('auto provider stays deterministic until a local model or OpenRouter key is configured', async () => {
  const gateway = new LlmGateway({ provider: 'auto', localEndpoint: 'http://127.0.0.1:11434/v1', model: 'openrouter/auto' }, { warn() {} });
  assert.equal(gateway.status().enabled, false);
  const result = await gateway.interpret('ikuti Steve', { selector: 'bot:worker' });
  assert.equal(result.intent, 'follow'); assert.equal(result.selector, 'bot:worker'); assert.equal(result.player, 'steve');
});

test('invalid LLM command safely falls back to the deterministic parser', async () => {
  const server = createServer(async (request, response) => { for await (const _ of request) {} response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: '{"intent":"move","selector":"auto","x":null,"y":null,"z":null}' } }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const gateway = new LlmGateway({ provider: 'local', localEndpoint: `http://127.0.0.1:${server.address().port}`, localModel: 'test', localStructuredOutput: false, timeoutMs: 1000 }, { warn() {} });
    const result = await gateway.interpret('move 10 64 -5'); assert.deepEqual([result.x, result.y, result.z], [10, 64, -5]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('coordinator borrows an idle pickaxe before collecting stone', async () => {
  const adapters = new Map();
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: input => { const adapter = new FleetAdapter(input.id === 'donor' ? ['stone_pickaxe'] : []); adapters.set(input.id, adapter); return adapter; } } });
  app.bots.create({ id: 'target', name: 'Target', metadata: { commandAlias: 'target', className: 'miner' } }); app.bots.create({ id: 'donor', name: 'Donor', metadata: { commandAlias: 'donor', className: 'support' } });
  await app.bots.start('target'); await app.bots.start('donor'); await Promise.all(['target', 'donor'].map(id => app.bots.get(id).transitionQueue));
  app.coordinator.gateway.provider = null;
  const result = await app.coordinator.coordinate({ text: 'collect stone 4', selector: 'bot:target', actor: 'test' });
  assert.equal(result.results[0].status, 'COMPLETED'); assert.ok(adapters.get('target').items.some(item => item.name === 'stone_pickaxe' && item.count > 0)); assert.equal(adapters.get('donor').items[0].count, 0); assert.equal(adapters.get('target').collected[0].block, 'stone'); await app.stop();
});

test('nearest-bot algorithm ignores a farther tool donor', async () => {
  const adapters = new Map(); const positions = { target: { x: 0, y: 64, z: 0 }, near: { x: 3, y: 64, z: 4 }, far: { x: 30, y: 64, z: 0 } };
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: input => { const adapter = new FleetAdapter(input.id === 'target' ? [] : ['stone_pickaxe'], { position: positions[input.id] }); adapters.set(input.id, adapter); return adapter; } } });
  for (const id of ['target', 'far', 'near']) { app.bots.create({ id, metadata: { commandAlias: id, className: 'worker' } }); await app.bots.start(id); await app.bots.get(id).transitionQueue; }
  app.coordinator.gateway.provider = null; const view = app.coordinator.fleetView().find(bot => bot.id === 'target'); assert.deepEqual(view.nearby.map(bot => bot.id), ['near', 'far']); assert.deepEqual(view.nearby.map(bot => bot.distance), [5, 30]);
  await app.coordinator.coordinate({ text: 'collect stone 1', selector: 'bot:target', actor: 'test' }); assert.equal(adapters.get('near').items[0].count, 0); assert.equal(adapters.get('far').items[0].count, 1); await app.stop();
});

test('coordinator crafts a pickaxe when no idle donor has one', async () => {
  let adapter;
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => (adapter = new FleetAdapter()) } });
  app.bots.create({ id: 'solo', name: 'Solo', metadata: { commandAlias: 'solo', className: 'miner' } }); await app.bots.start('solo'); await app.bots.get('solo').transitionQueue; app.coordinator.gateway.provider = null;
  const result = await app.coordinator.coordinate({ text: 'ambil stone 3', selector: 'bot:solo', actor: 'test' });
  assert.equal(result.results[0].status, 'COMPLETED'); assert.ok(adapter.items.some(item => item.name === 'wooden_pickaxe')); assert.deepEqual(adapter.collected, [{ block: 'stone', count: 3 }]); await app.stop();
});

test('coordinator borrows missing crafting material before making a required tool', async () => {
  const adapters = new Map(); const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: input => { const adapter = input.id === 'target' ? new FleetAdapter([], { requireMaterials: true }) : new FleetAdapter([{ name: 'oak_log', count: 3 }]); adapters.set(input.id, adapter); return adapter; } } });
  for (const id of ['target', 'materials']) { app.bots.create({ id, metadata: { commandAlias: id, className: 'worker' } }); await app.bots.start(id); await app.bots.get(id).transitionQueue; }
  app.coordinator.gateway.provider = null; const result = await app.coordinator.coordinate({ text: 'collect stone 1', selector: 'bot:target', actor: 'test' }); assert.equal(result.results[0].status, 'COMPLETED'); assert.equal(adapters.get('materials').count('oak_log'), 0); assert.ok(adapters.get('target').count('wooden_pickaxe') > 0); await app.stop();
});

test('coordinator collects missing material itself when no bot can donate it', async () => {
  let adapter; const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => (adapter = new FleetAdapter([], { requireMaterials: true })) } });
  app.bots.create({ id: 'solo', metadata: { commandAlias: 'solo', className: 'worker' } }); await app.bots.start('solo'); await app.bots.get('solo').transitionQueue; app.coordinator.gateway.provider = null;
  const result = await app.coordinator.coordinate({ text: 'collect stone 1', selector: 'bot:solo', actor: 'test' }); assert.equal(result.results[0].status, 'COMPLETED'); assert.ok(adapter.collected.some(entry => entry.block === 'oak_log' && entry.count === 3)); assert.ok(adapter.count('wooden_pickaxe') > 0); await app.stop();
});

test('group coordinator distributes collection count exactly across bots', async () => {
  const adapters = new Map(); const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: input => { const adapter = new FleetAdapter(); adapters.set(input.id, adapter); return adapter; } } });
  for (const id of ['one', 'two', 'three']) { app.bots.create({ id, metadata: { commandAlias: id, className: 'miner' } }); await app.bots.start(id); await app.bots.get(id).transitionQueue; }
  app.coordinator.gateway.provider = null; const result = await app.coordinator.coordinate({ text: 'collect dirt 5', selector: 'class:miner', actor: 'test' });
  assert.equal(result.results.length, 3); assert.deepEqual([...adapters.values()].map(adapter => adapter.collected[0].count), [2, 2, 1]); assert.equal([...adapters.values()].reduce((sum, adapter) => sum + adapter.collected[0].count, 0), 5); await app.stop();
});

test('natural-language coordinator prepares hoe, axe, and sword for world actions', async () => {
  let adapter; const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => (adapter = new FleetAdapter()) } }); app.bots.create({ id: 'worker', metadata: { commandAlias: 'worker', className: 'worker' } }); await app.bots.start('worker'); await app.bots.get('worker').transitionQueue; app.coordinator.gateway.provider = null;
  assert.equal((await app.coordinator.coordinate({ text: 'farm wheat 4', selector: 'bot:worker' })).results[0].status, 'COMPLETED'); assert.ok(adapter.count('wooden_hoe'));
  assert.equal((await app.coordinator.coordinate({ text: 'tebang pohon', selector: 'bot:worker' })).results[0].status, 'COMPLETED'); assert.ok(adapter.count('wooden_axe'));
  assert.equal((await app.coordinator.coordinate({ text: 'guard 12', selector: 'bot:worker' })).results[0].status, 'COMPLETED'); assert.ok(adapter.count('wooden_sword')); assert.equal(adapter.combat.mode, 'guard');
  const memories = await app.worldMemory.forBot(app.bots.get('worker'), { type: 'tree_site' }); assert.equal(memories.length, 1); await app.stop();
});

test('deterministic companion translates natural commands and answers simple arithmetic', async () => {
  const gateway = new LlmGateway({ provider: 'auto' }, { warn() {} }); assert.equal((await gateway.interpret('tebang pohon')).intent, 'deforest'); assert.equal((await gateway.interpret('berapa 1+1')).reply, '1 + 1 = 2'); assert.equal((await gateway.interpret('follow Steve')).intent, 'follow'); assert.equal((await gateway.interpret('come Steve')).intent, 'come'); assert.equal((await gateway.interpret('craft wooden sword')).item, 'wooden_sword'); const survey = await gateway.interpret('jelajah 32'); assert.equal(survey.intent, 'survey'); assert.equal(survey.radius, 32); const storage = await gateway.interpret('simpan cobbled_deepslate 32 gudang'); assert.equal(storage.intent, 'store'); assert.equal(storage.item, 'cobbled_deepslate'); assert.equal(storage.name, 'gudang');
});

test('survey persists discoveries to world and semantic shared memory', async () => {
  let adapter; const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => (adapter = new FleetAdapter()) } });
  app.bots.create({ id: 'scout', name: 'Scout', metadata: { commandAlias: 'scout', className: 'scout' } }); await app.bots.start('scout'); await app.bots.get('scout').transitionQueue; app.coordinator.gateway.provider = null;
  const result = await app.coordinator.coordinate({ text: 'survey 48', selector: 'bot:scout', actor: 'test' }); assert.equal(result.results[0].status, 'COMPLETED'); assert.equal(adapter.surveyed, 48); assert.equal(result.results[0].result.memories[0].type, 'village');
  const world = await app.worldMemory.forBot(app.bots.get('scout'), { type: 'village' }); assert.equal(world[0].name, 'village-bell-24--12'); assert.deepEqual(world[0].position, { x: 24, y: 70, z: -12 });
  const semantic = await app.semanticMemory.search({ text: 'village bell', worldKey: 'localhost:25565', dimension: 'overworld', limit: 5 }); assert.ok(semantic.some(memory => memory.source === 'survey' && memory.tags.includes('bell'))); await app.stop();
});

test('coordinator registers storage and completes verified logistics transfers', async () => {
  let adapter; const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => (adapter = new FleetAdapter([{ name: 'stone', count: 12 }])) } }); app.bots.create({ id: 'courier', metadata: { commandAlias: 'courier', className: 'logistics' } }); await app.bots.start('courier'); await app.bots.get('courier').transitionQueue; app.coordinator.gateway.provider = null;
  assert.equal((await app.coordinator.coordinate({ text: 'register_chest gudang 16', selector: 'bot:courier' })).results[0].status, 'COMPLETED'); assert.equal((await app.coordinator.coordinate({ text: 'store stone 8 gudang', selector: 'bot:courier' })).results[0].status, 'COMPLETED'); assert.equal(adapter.storageCount('stone'), 8); assert.equal((await app.coordinator.coordinate({ text: 'retrieve stone 3 gudang', selector: 'bot:courier' })).results[0].status, 'COMPLETED'); assert.equal(adapter.storageCount('stone'), 5); assert.equal((await app.logistics.status()).transfers, 2); await app.stop();
});
