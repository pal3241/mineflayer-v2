import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/index.js';

test('API exposes health and versioned bot DTOs', async () => {
  const app = createApplication({ config: {
    profile: 'test', log: { level: 'silent' }, dataPath: './data', database: { driver: 'json', file: './data/test.sqlite' }, semanticMemory: { maxRecords: 1000, dimensions: 64 }, ml: { minimumSamples: 2 }, hive: { heartbeatTimeoutMs: 30000 }, autonomy: { enabled: false, intervalMs: 60000, maxActionsPerHour: 10 },
    api: { host: '127.0.0.1', port: 0, rateLimitPerMinute: 120 },
    bot: { host: 'localhost', port: 25565, username: 'test', auth: 'offline', autoConnect: false }
  }});
  try {
    await app.start();
    const { port } = app.api.address();
    const dashboard = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(dashboard.status, 200); assert.match(await dashboard.text(), /MineHive Control Center/);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/dashboard.css`)).text(), /camera-wall/);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/camera.css`)).text(), /camera-loading/);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/settings.css`)).text(), /settings-grid/);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/dashboard.js`)).text(), /executeCommand/);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /data-view="memory"/);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'HEALTHY');
    const dashboardSnapshot = await fetch(`http://127.0.0.1:${port}/api/v1/dashboard/snapshot`); const snapshotPayload = await dashboardSnapshot.json(); assert.equal(dashboardSnapshot.status, 200); assert.equal(snapshotPayload.data.health.status, 'HEALTHY'); assert.deepEqual(snapshotPayload.data.bots, []); assert.ok(Number(dashboardSnapshot.headers.get('x-ratelimit-remaining')) < 120); assert.ok(snapshotPayload.data.diagnostics.rssMb > 0); assert.ok(snapshotPayload.data.diagnostics.heapUsedMb > 0);

    const created = await fetch(`http://127.0.0.1:${port}/api/v1/bots`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'api-bot', username: 'ApiBot' })
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).data.id, 'api-bot');

    const list = await fetch(`http://127.0.0.1:${port}/api/v1/bots`);
    assert.equal((await list.json()).data.length, 1);
    const invalidSmelt = await fetch(`http://127.0.0.1:${port}/api/v1/bots/api-bot/actions/smelt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(invalidSmelt.status, 400); assert.match((await invalidSmelt.json()).error.message, /smelt action requires item/);
    const updatedBot = await fetch(`http://127.0.0.1:${port}/api/v1/bots/api-bot`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"className":"miner","commandAlias":"api"}' });
    assert.equal((await updatedBot.json()).data.metadata.className, 'miner');
    const connectionUpdate = await fetch(`http://127.0.0.1:${port}/api/v1/bots/api-bot`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"name":"Edited Bot","username":"EditedUser","host":"mc.example.test","port":25566,"auth":"offline","className":"logistics","commandAlias":"edited","autoConnect":true}' }); const connectionPayload = await connectionUpdate.json(); assert.equal(connectionUpdate.status, 200); assert.equal(connectionPayload.data.name, 'Edited Bot');
    const editedSnapshot = await (await fetch(`http://127.0.0.1:${port}/api/v1/dashboard/snapshot`)).json(); const editedProfile = editedSnapshot.data.bots.find(bot => bot.id === 'api-bot').profile; assert.equal(editedProfile.host, 'mc.example.test'); assert.equal(editedProfile.port, 25566); assert.equal(editedProfile.metadata.className, 'logistics');

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
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/ai/status`)).status, 200);
    const fleet = await fetch(`http://127.0.0.1:${port}/api/v1/ai/fleet`); assert.equal(fleet.status, 200); assert.equal((await fleet.json()).data[0].id, 'api-bot');
    const remembered = await fetch(`http://127.0.0.1:${port}/api/v1/memory`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"host":"localhost","port":25565,"dimension":"overworld","type":"village","name":"desa-test","position":{"x":10,"y":64,"z":20}}' }); const rememberedPayload = (await remembered.json()).data; assert.equal(remembered.status, 201);
    const memories = await fetch(`http://127.0.0.1:${port}/api/v1/memory?host=localhost&port=25565&dimension=overworld`); assert.equal((await memories.json()).data[0].name, 'desa-test');
    const semantic = await fetch(`http://127.0.0.1:${port}/api/v1/memory/semantic`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"SEMANTIC","content":"desa aman dekat sungai","visibility":"HIVE","worldKey":"localhost:25565","dimension":"overworld","source":"api-test"}' }); const semanticPayload = (await semantic.json()).data; assert.equal(semantic.status, 201);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/v1/memory/semantic?q=desa+sungai`)).json()).data[0].source, 'api-test');
    const shortMemory = await fetch(`http://127.0.0.1:${port}/api/v1/memory/short-term`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"content":"ingat gua sementara","importance":0.9}' }); assert.equal(shortMemory.status, 201); assert.equal((await shortMemory.json()).data.type, 'SHORT_TERM'); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/memory/long-term`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"content":"base utama selalu penting"}' })).status, 201); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/memory/consolidate`, { method: 'POST' })).status, 200);
    const memoryDashboard = await fetch(`http://127.0.0.1:${port}/api/v1/memory/dashboard?category=all&q=desa&limit=1`); const memoryDashboardPayload = (await memoryDashboard.json()).data; assert.equal(memoryDashboard.status, 200); assert.equal(memoryDashboardPayload.total, 2); assert.equal(memoryDashboardPayload.items.length, 1); assert.equal(memoryDashboardPayload.hasMore, true); assert.equal(memoryDashboardPayload.counts.world, 1); assert.equal(memoryDashboardPayload.counts.semantic, 3); assert.equal(memoryDashboardPayload.settings.maxRecords, 1000); assert.equal(memoryDashboardPayload.items[0].embedding?.vector, undefined);
    const invalidMemoryPage = await fetch(`http://127.0.0.1:${port}/api/v1/memory/dashboard?limit=101`); assert.equal(invalidMemoryPage.status, 400);
    const invalidMemorySettings = await fetch(`http://127.0.0.1:${port}/api/v1/settings/memory`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"maxRecords":100,"shortTermMaxRecords":101,"shortTermTtlMs":60000,"promotionAccesses":3,"promotionImportance":0.8,"consolidationIntervalMs":5000}' }); assert.equal(invalidMemorySettings.status, 400);
    const memorySettings = await fetch(`http://127.0.0.1:${port}/api/v1/settings/memory`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"maxRecords":500,"shortTermMaxRecords":200,"shortTermTtlMs":60000,"promotionAccesses":4,"promotionImportance":0.75,"consolidationIntervalMs":5000}' }); const memorySettingsPayload = (await memorySettings.json()).data; assert.equal(memorySettings.status, 200); assert.equal(memorySettingsPayload.settings.shortTermMaxRecords, 200); assert.equal(memorySettingsPayload.lifecycle.intervalMs, 5000);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/ml/status`)).status, 200); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/hivemind/status`)).status, 200); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/hivemind/locks`)).status, 200);
    const objective = await fetch(`http://127.0.0.1:${port}/api/v1/autonomy/objectives`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"collect stone 1","selector":"bot:api"}' }); assert.equal(objective.status, 201); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/autonomy/status`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/database/status`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/logistics/status`)).status, 200); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/logistics/storages`)).status, 200); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/logistics/timeline`)).status, 200); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/logistics/locks`)).status, 200);
    const registeredStorage = await app.logistics.registerNearest({ runtime: { bot: { id: 'api-courier' }, options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ dimension: 'overworld' }), findNearestStorage: async () => ({ kind: 'chest', position: { x: 4, y: 64, z: 8 }, inventory: [], capacitySlots: 27, occupiedSlots: 0 }) } }, name: 'api storage', maxDistance: 16 }); const renamedStorage = await fetch(`http://127.0.0.1:${port}/api/v1/logistics/storages/${registeredStorage.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"name":"api warehouse"}' }); assert.equal(renamedStorage.status, 200); assert.equal((await renamedStorage.json()).data.name, 'api warehouse');
    const llmSettings = await fetch(`http://127.0.0.1:${port}/api/v1/settings/llm`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"provider":"openrouter","openRouterEndpoint":"https://openrouter.ai/api/v1","openRouterModel":"openrouter/auto","openRouterApiKeys":["secret-runtime-key"]}' }); const llmPayload = await llmSettings.json(); assert.equal(llmSettings.status, 200); assert.equal(llmPayload.data.status.keyCount, 1); assert.doesNotMatch(JSON.stringify(llmPayload), /secret-runtime-key/);
    const nvidiaSettings = await fetch(`http://127.0.0.1:${port}/api/v1/settings/llm`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"provider":"nvidia","nvidiaEndpoint":"https://integrate.api.nvidia.com/v1","nvidiaModel":"meta/llama-3.1-8b-instruct","nvidiaApiKeys":["nvapi-secret-runtime-key"]}' }); const nvidiaPayload = await nvidiaSettings.json(); assert.equal(nvidiaSettings.status, 200); assert.equal(nvidiaPayload.data.status.provider, 'nvidia'); assert.equal(nvidiaPayload.data.status.keyCount, 1); assert.doesNotMatch(JSON.stringify(nvidiaPayload), /nvapi-secret-runtime-key/);
    const settings = await (await fetch(`http://127.0.0.1:${port}/api/v1/settings`)).json(); assert.equal(settings.data.llm.openrouter.configuredKeys[0], true); assert.equal(settings.data.llm.nvidia.configuredKeys[0], true); assert.equal(settings.data.llm.maxTokens, 5); assert.equal(settings.data.memory.maxRecords, 500); assert.doesNotMatch(JSON.stringify(settings), /secret-runtime-key|nvapi-secret-runtime-key/);
    const recoverySettings = await fetch(`http://127.0.0.1:${port}/api/v1/settings/recovery`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"enabled":true,"maxAttempts":4,"minScore":45,"optionalScore":25,"urgentScore":75,"despawnTicks":8000,"safetyMarginTicks":500,"maxDistance":1500,"dangerLimit":0.6}' }); assert.equal(recoverySettings.status, 200); assert.equal((await recoverySettings.json()).data.maxAttempts, 4);
    const recoveryDashboard = await fetch(`http://127.0.0.1:${port}/api/v1/recovery/dashboard`); assert.equal(recoveryDashboard.status, 200); assert.equal((await recoveryDashboard.json()).data.settings.maxAttempts, 4);
    const survivalSettings = await fetch(`http://127.0.0.1:${port}/api/v1/settings/survival`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"autoEquipArmor":false,"minimumDurabilityPercent":25,"interactionCooldownMs":750}' }); const survivalPayload = await survivalSettings.json(); assert.equal(survivalSettings.status, 200); assert.equal(survivalPayload.data.autoEquipArmor, false); assert.equal(survivalPayload.data.minimumDurabilityPercent, 25); const invalidSurvival = await fetch(`http://127.0.0.1:${port}/api/v1/settings/survival`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"minimumDurabilityPercent":101}' }); assert.equal(invalidSurvival.status, 400);
    const logSettings = await fetch(`http://127.0.0.1:${port}/api/v1/settings/log`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"level":"debug"}' }); assert.equal((await logSettings.json()).data.level, 'debug');
    const autonomySettings = await fetch(`http://127.0.0.1:${port}/api/v1/settings/autonomy`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"enabled":false,"intervalMs":5000,"maxActionsPerHour":5}' }); assert.equal((await autonomySettings.json()).data.intervalMs, 5000);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/settings/logs?limit=20`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/tasks/queue`)).status, 200); const reset = await fetch(`http://127.0.0.1:${port}/api/v1/settings/reset`, { method: 'POST' }); const resetPayload = await reset.json(); assert.equal(reset.status, 200); assert.equal(resetPayload.data.llm.provider, 'none'); assert.equal(resetPayload.data.log.level, 'silent'); assert.equal(resetPayload.data.autonomy.intervalMs, 60000); assert.equal(resetPayload.data.survival.autoEquipArmor, true); assert.equal(resetPayload.data.memory.settings.maxRecords, 1000); assert.ok(resetPayload.data.preserved.includes('memory records'));
    const semanticDelete = await fetch(`http://127.0.0.1:${port}/api/v1/memory/semantic/${semanticPayload.id}`, { method: 'DELETE' }); assert.equal(semanticDelete.status, 200); assert.equal((await semanticDelete.json()).data.category, 'semantic'); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/memory/semantic/${semanticPayload.id}`, { method: 'DELETE' })).status, 404);
    const worldDelete = await fetch(`http://127.0.0.1:${port}/api/v1/memory/${rememberedPayload.id}`, { method: 'DELETE' }); assert.equal(worldDelete.status, 200); assert.equal((await worldDelete.json()).data.category, 'world'); assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/memory/${rememberedPayload.id}`, { method: 'DELETE' })).status, 404);
  } finally { await app.stop(); }
});

test('API bearer token protects control routes but not health', async () => {
  const app = createApplication({ config: {
    profile: 'test', log: { level: 'silent' }, dataPath: './data', database: { driver: 'json', file: './data/test.sqlite' }, semanticMemory: { maxRecords: 1000, dimensions: 64 }, ml: { minimumSamples: 2 }, hive: { heartbeatTimeoutMs: 30000 }, autonomy: { enabled: false, intervalMs: 60000, maxActionsPerHour: 10 }, commands: { enabled: false, prefix: '!hive', admins: [] },
    api: { host: '127.0.0.1', port: 0, token: 'secret', rateLimitPerMinute: 120 },
    bot: { host: 'localhost', port: 25565, username: 'test', auth: 'offline', autoConnect: false }
  }});
  try {
    await app.start(); const { port } = app.api.address();
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/system/status`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/system/status`, { headers: { authorization: 'Bearer secret' } })).status, 200);
  } finally { await app.stop(); }
});

test('health and dashboard assets do not consume the API control rate limit', async () => {
  const app = createApplication({ config: {
    profile: 'test', log: { level: 'silent' }, dataPath: './data', database: { driver: 'json', file: './data/test.sqlite' }, semanticMemory: { maxRecords: 1000, dimensions: 64 }, ml: { minimumSamples: 2 }, hive: { heartbeatTimeoutMs: 30000 }, autonomy: { enabled: false, intervalMs: 60000, maxActionsPerHour: 10 }, tasks: { maxQueuePerBot: 10 },
    api: { host: '127.0.0.1', port: 0, rateLimitPerMinute: 10 }, bot: { host: 'localhost', port: 25565, username: 'test', auth: 'offline', autoConnect: false }
  }});
  try {
    await app.start(); const { port } = app.api.address(); for (let index = 0; index < 15; index++) assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200); assert.equal((await fetch(`http://127.0.0.1:${port}/dashboard.js`)).status, 200);
    for (let index = 0; index < 10; index++) assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/system/status`)).status, 200); const limited = await fetch(`http://127.0.0.1:${port}/api/v1/system/status`); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  } finally { await app.stop(); }
});
