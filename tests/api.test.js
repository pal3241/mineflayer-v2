import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/index.js';

test('API exposes health and versioned bot DTOs', async () => {
  const app = createApplication({ config: {
    profile: 'test', log: { level: 'silent' }, dataPath: './data',
    api: { host: '127.0.0.1', port: 0 },
    bot: { host: 'localhost', port: 25565, username: 'test', auth: 'offline', autoConnect: false }
  }});
  try {
    await app.start();
    const { port } = app.api.address();
    const dashboard = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(dashboard.status, 200); assert.match(await dashboard.text(), /MineHive Control Center/);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/dashboard.css`)).text(), /camera-wall/);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/camera.css`)).text(), /camera-loading/);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/dashboard.js`)).text(), /executeCommand/);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'HEALTHY');

    const created = await fetch(`http://127.0.0.1:${port}/api/v1/bots`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'api-bot', username: 'ApiBot' })
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).data.id, 'api-bot');

    const list = await fetch(`http://127.0.0.1:${port}/api/v1/bots`);
    assert.equal((await list.json()).data.length, 1);
    const updatedBot = await fetch(`http://127.0.0.1:${port}/api/v1/bots/api-bot`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"className":"miner","commandAlias":"api"}' });
    assert.equal((await updatedBot.json()).data.metadata.className, 'miner');

    app.bots.get('api-bot').bot.capabilities.add('observe');
    app.capabilities.register({ name: 'observe', execute: async () => ({ observed: true }) });
    const goalResponse = await fetch(`http://127.0.0.1:${port}/api/v1/goals`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: 'Observe safely', steps: [{ type: 'observe', requiredCapabilities: ['observe'] }] })
    });
    const goal = (await goalResponse.json()).data; assert.equal(goalResponse.status, 201);
    const run = await fetch(`http://127.0.0.1:${port}/api/v1/goals/${goal.id}/run`, { method: 'POST' });
    assert.equal((await run.json()).data.status, 'COMPLETED');

    const action = await fetch(`http://127.0.0.1:${port}/api/v1/bots/api-bot/actions/observe`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(action.status, 200); assert.equal((await action.json()).data.status, 'COMPLETED');

    const adminCreated = await fetch(`http://127.0.0.1:${port}/api/v1/admins`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username":"DashboardAdmin"}' });
    assert.equal(adminCreated.status, 201); assert.ok((await adminCreated.json()).data.some(admin => admin.username === 'DashboardAdmin'));
    const adminDeleted = await fetch(`http://127.0.0.1:${port}/api/v1/admins/DashboardAdmin`, { method: 'DELETE' });
    assert.equal(adminDeleted.status, 200);
  } finally { await app.stop(); }
});

test('API bearer token protects control routes but not health', async () => {
  const app = createApplication({ config: {
    profile: 'test', log: { level: 'silent' }, dataPath: './data', commands: { enabled: false, prefix: '!hive', admins: [] },
    api: { host: '127.0.0.1', port: 0, token: 'secret' },
    bot: { host: 'localhost', port: 25565, username: 'test', auth: 'offline', autoConnect: false }
  }});
  try {
    await app.start(); const { port } = app.api.address();
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/system/status`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/system/status`, { headers: { authorization: 'Bearer secret' } })).status, 200);
  } finally { await app.stop(); }
});
