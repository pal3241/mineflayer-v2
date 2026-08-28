import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApplication } from '../src/index.js';

class FakeAdapter extends EventEmitter {
  constructor() { super(); this.status = 'DISCONNECTED'; }
  async connect() { this.status = 'CONNECTING'; queueMicrotask(() => { this.emit('login'); this.status = 'READY'; this.emit('spawn'); }); }
  async disconnect() { this.status = 'DISCONNECTED'; this.emit('end'); }
  snapshot() { return { connection: this.status, position: null, health: 20, food: 20, inventorySummary: [], timestamp: new Date().toISOString() }; }
}

test('bot runtimes are isolated and use adapter boundaries', async () => {
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => new FakeAdapter() } });
  await app.start({ api: false }); const first = app.bots.create({ id: 'a', username: 'Alpha' }); app.bots.create({ id: 'b', username: 'Beta' });
  await app.bots.start(first.id); await app.bots.get('a').transitionQueue;
  assert.equal(app.bots.get('a').snapshot().status, 'READY'); assert.equal(app.bots.get('b').snapshot().status, 'REGISTERED');
  await app.stop(); assert.equal(app.state, 'STOPPED');
});

test('bot runtime enters failed state when adapter connection fails', async () => {
  class FailingAdapter extends EventEmitter { async connect() { throw new Error('connection refused'); } async disconnect() {} snapshot() { return { connection: 'DISCONNECTED', position: null, inventorySummary: [] }; } }
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => new FailingAdapter() } }); app.bots.create({ id: 'broken', username: 'Broken' }); await assert.rejects(app.bots.start('broken'), /connection refused/); assert.equal(app.bots.get('broken').snapshot().status, 'FAILED'); await app.stop();
});

test('bot runtime enters failed state when adapter disconnect fails', async () => {
  class FailingDisconnectAdapter extends EventEmitter { async connect() { this.emit('login'); this.emit('spawn'); } async disconnect() { throw new Error('disconnect refused'); } snapshot() { return { connection: 'READY', position: null, inventorySummary: [] }; } }
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' }, overrides: { adapterFactory: () => new FailingDisconnectAdapter() } }); app.bots.create({ id: 'broken-stop', username: 'BrokenStop' }); await app.bots.start('broken-stop'); await app.bots.get('broken-stop').transitionQueue; await assert.rejects(app.bots.stop('broken-stop'), /disconnect refused/); assert.equal(app.bots.get('broken-stop').snapshot().status, 'FAILED');
});
