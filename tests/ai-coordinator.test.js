import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApplication } from '../src/index.js';
import { LlmGateway } from '../src/ai/llm-gateway.js';
import { EventEmitter } from 'node:events';

class FleetAdapter extends EventEmitter {
  constructor(items = []) { super(); this.status = 'READY'; this.items = items.map(name => ({ name, count: 1 })); this.collected = []; }
  async connect() { this.emit('login'); this.emit('spawn'); }
  async disconnect() { this.emit('end'); }
  async smartMove(input) { this.movedTo = input; }
  async dropItem({ item }) { this.items.find(entry => entry.name === item).count--; this.dropped = item; }
  async pickupItem({ item }) { this.items.push({ name: item, count: 1 }); }
  async craftItem({ item }) { this.items.push({ name: item, count: 1 }); }
  async collect(input) { this.collected.push(input); return { collectedTargets: input.count }; }
  async stopActions() {}
  snapshot() { return { connection: 'READY', position: { x: 1, y: 64, z: 1 }, dimension: 'overworld', health: 20, food: 20, inventorySummary: this.items.filter(item => item.count > 0), camera: { active: false }, timestamp: new Date().toISOString() }; }
}

test('local OpenAI-compatible LLM returns a validated coordinator intent', async () => {
  const server = createServer(async (request, response) => { for await (const _ of request) {} response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: '{"intent":"collect","selector":"class:miner","block":"stone","item":null,"count":8,"player":null,"x":null,"y":null,"z":null,"home":null}' } }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const gateway = new LlmGateway({ provider: 'local', localEndpoint: `http://127.0.0.1:${server.address().port}`, localModel: 'test', localStructuredOutput: false, timeoutMs: 1000 }, { warn() {} });
    const result = await gateway.interpret('get stone'); assert.equal(result.intent, 'collect'); assert.equal(result.block, 'stone'); assert.equal(result.count, 8);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('auto provider stays deterministic until a local model or OpenRouter key is configured', async () => {
  const gateway = new LlmGateway({ provider: 'auto', localEndpoint: 'http://127.0.0.1:11434/v1', model: 'openrouter/auto' }, { warn() {} });
  assert.equal(gateway.status().enabled, false);
  const result = await gateway.interpret('ikuti Steve', { selector: 'bot:worker' });
  assert.deepEqual(result, { intent: 'follow', selector: 'bot:worker', block: undefined, item: undefined, count: 1, player: 'steve', x: undefined, y: undefined, z: undefined, home: 'home' });
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

test('coordinator crafts a pickaxe when no idle donor has one', async () => {
  let adapter;
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => (adapter = new FleetAdapter()) } });
  app.bots.create({ id: 'solo', name: 'Solo', metadata: { commandAlias: 'solo', className: 'miner' } }); await app.bots.start('solo'); await app.bots.get('solo').transitionQueue; app.coordinator.gateway.provider = null;
  const result = await app.coordinator.coordinate({ text: 'ambil stone 3', selector: 'bot:solo', actor: 'test' });
  assert.equal(result.results[0].status, 'COMPLETED'); assert.ok(adapter.items.some(item => item.name === 'wooden_pickaxe')); assert.deepEqual(adapter.collected, [{ block: 'stone', count: 3 }]); await app.stop();
});

test('group coordinator distributes collection count exactly across bots', async () => {
  const adapters = new Map(); const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: input => { const adapter = new FleetAdapter(); adapters.set(input.id, adapter); return adapter; } } });
  for (const id of ['one', 'two', 'three']) { app.bots.create({ id, metadata: { commandAlias: id, className: 'miner' } }); await app.bots.start(id); await app.bots.get(id).transitionQueue; }
  app.coordinator.gateway.provider = null; const result = await app.coordinator.coordinate({ text: 'collect dirt 5', selector: 'class:miner', actor: 'test' });
  assert.equal(result.results.length, 3); assert.deepEqual([...adapters.values()].map(adapter => adapter.collected[0].count), [2, 2, 1]); assert.equal([...adapters.values()].reduce((sum, adapter) => sum + adapter.collected[0].count, 0), 5); await app.stop();
});
