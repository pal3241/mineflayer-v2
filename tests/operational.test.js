import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApplication } from '../src/index.js';
import { MineflayerAdapter } from '../src/plugins/minecraft/mineflayer-adapter.js';

class OperationalAdapter extends EventEmitter {
  constructor() { super(); this.status = 'READY'; this.messages = []; this.collected = []; }
  async connect() { this.connectCalls = (this.connectCalls ?? 0) + 1; this.status = 'READY'; this.emit('login'); this.emit('spawn'); }
  async disconnect() { this.status = 'DISCONNECTED'; this.emit('end'); }
  async chat(message) { this.messages.push(message); return { sent: true }; }
  async collect(input) { this.collected.push(input); return { block: input.block, collectedTargets: input.count }; }
  async navigate(input) { return { position: input }; }
  async followPlayer(input) { return { player: input.username }; }
  async stopActions() {}
  async startViewer({ port }) { this.camera = { active: true, port }; return this.camera; }
  async stopViewer() { this.camera = { active: false, port: null }; return this.camera; }
  snapshot() { return { connection: this.status, position: { x: 1, y: 64, z: 2 }, health: 20, food: 20, inventorySummary: [], plugins: {}, camera: this.camera ?? { active: false, port: null }, timestamp: new Date().toISOString() }; }
}

async function waitFor(predicate, timeout = 1000) {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > timeout) throw new Error('Timed out waiting for condition'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test('authorized chat command creates and completes a real capability goal', async () => {
  let adapter;
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent', MINEHIVE_ADMINS: 'Alice' }, overrides: { adapterFactory: () => (adapter = new OperationalAdapter()) } });
  app.bots.create({ id: 'worker', username: 'Worker' });
  adapter.emit('chat', 'Mallory', '!worker collect oak_log 2');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(app.goals.list().length, 0);
  adapter.emit('chat', 'Alice', '!hive collect oak_log 2');
  await new Promise(resolve => setImmediate(resolve)); assert.equal(app.goals.list().length, 0);
  adapter.emit('chat', 'Alice', '!worker collect oak_log 2');
  await waitFor(() => app.goals.list()[0]?.status === 'COMPLETED');
  assert.deepEqual(adapter.collected, [{ block: 'oak_log', count: 2 }]); assert.ok(adapter.messages.some(message => message.includes('goal completed')));
});

test('class and global selectors route commands to the intended bots', async () => {
  const adapters = new Map();
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent', MINEHIVE_ADMINS: 'Alice' }, overrides: { adapterFactory: input => { const adapter = new OperationalAdapter(); adapters.set(input.id, adapter); return adapter; } } });
  app.bots.create({ id: 'miner-1', name: 'MinerOne', metadata: { commandAlias: 'one', className: 'miner' } });
  app.bots.create({ id: 'builder-1', name: 'BuilderOne', metadata: { commandAlias: 'two', className: 'builder' } });
  for (const adapter of adapters.values()) adapter.emit('chat', 'Alice', '!miner collect stone 1');
  await waitFor(() => adapters.get('miner-1').collected.length === 1); assert.equal(adapters.get('builder-1').collected.length, 0);
  for (const adapter of adapters.values()) adapter.emit('chat', 'Alice', '!global collect dirt 1');
  await waitFor(() => adapters.get('miner-1').collected.length === 2 && adapters.get('builder-1').collected.length === 1);
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
  assert.deepEqual(adapter.snapshot().position, { x: 1, y: 2, z: 3 }); assert.deepEqual(client.sent, ['hello']);
  await adapter.disconnect('done'); assert.equal(client.cleared, true); assert.equal(client.reason, 'done'); assert.equal(adapter.status, 'DISCONNECTED');
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
  const first = await app.startCamera('camera-a'); const second = await app.startCamera('camera-b');
  assert.notEqual(first.port, second.port); assert.equal(app.bots.get('camera-a').snapshot().runtime.camera.active, true);
  await app.stopCamera('camera-a'); assert.equal(app.bots.get('camera-a').snapshot().runtime.camera.active, false); await app.stop();
});
