import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, Container, StateMachine, BehaviorTree, ActionNode, Sequence, Selector, Status, createApplication } from '../src/index.js';
import { loadConfig } from '../src/core/config.js';

test('event bus emits a versioned envelope shape', async () => {
  const bus = new EventBus(); let received;
  bus.subscribe('test', event => { received = event; });
  const { event } = await bus.publish('test', { ok: true }, { source: 'test-suite', correlationId: 'c1' });
  assert.equal(received, event); assert.equal(event.type, 'test'); assert.equal(event.source, 'test-suite'); assert.equal(event.correlationId, 'c1'); assert.ok(event.id); assert.ok(event.timestamp);
});

test('container lazily resolves dependencies once', () => {
  const container = new Container(); let calls = 0; container.register('value', () => ({ calls: ++calls }));
  assert.equal(container.resolve('value'), container.resolve('value')); assert.equal(calls, 1);
});

test('state machine applies guards, actions and history', async () => {
  const context = { allowed: true, actions: 0 };
  const machine = new StateMachine({ initial: 'IDLE', context, states: { IDLE: { on: { GO: { target: 'ACTIVE', guard: ctx => ctx.allowed, action: ctx => ctx.actions++ } } }, ACTIVE: {} } });
  assert.equal(await machine.transition('GO'), 'ACTIVE'); assert.equal(context.actions, 1); assert.deepEqual(machine.history[0].from, 'IDLE');
});

test('child states inherit transitions from their parent', async () => {
  const machine = new StateMachine({ initial: 'NAVIGATING', states: {
    ACTIVE: { on: { STOP: 'OFFLINE' } }, NAVIGATING: { parent: 'ACTIVE' }, OFFLINE: {}
  }});
  assert.equal(machine.can('STOP'), true); assert.equal(await machine.transition('STOP'), 'OFFLINE');
});

test('behavior tree sequence and selector are deterministic', async () => {
  const order = [];
  const fail = new ActionNode('fail', async () => { order.push('fail'); return Status.FAILURE; });
  const sequence = new Sequence('sequence', [new ActionNode('one', async () => { order.push('one'); return Status.SUCCESS; }), new ActionNode('two', async () => { order.push('two'); return Status.SUCCESS; })]);
  const tree = new BehaviorTree(new Selector('selector', [fail, sequence]));
  assert.equal(await tree.tick(), Status.SUCCESS); assert.deepEqual(order, ['fail', 'one', 'two']);
});

test('application boots without Minecraft or API', async () => {
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' } });
  assert.equal(app.coordinator.acquisition, app.acquisition); await app.start({ api: false }); assert.equal(app.state, 'RUNNING'); assert.equal((await app.health.check()).status, 'HEALTHY'); await app.stop(); assert.equal(app.state, 'STOPPED');
});

test('configuration loads three keys for both supported LLM providers', () => {
  const config = loadConfig({ OPENROUTER_API_KEY_1: 'one', OPENROUTER_API_KEY_2: 'two', OPENROUTER_API_KEY_3: 'three', OPENROUTER_API_KEY: 'one', NVIDIA_API_KEY_1: 'nv-one', NVIDIA_API_KEY_2: 'nv-two', NVIDIA_API_KEY_3: 'nv-three' }); assert.deepEqual(config.llm.openRouterApiKeys, ['one', 'two', 'three']); assert.deepEqual(config.llm.nvidiaApiKeys, ['nv-one', 'nv-two', 'nv-three']); assert.equal(config.llm.provider, 'openrouter');
  const gateway = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent', OPENROUTER_API_KEY_1: 'one', OPENROUTER_API_KEY_2: 'two', OPENROUTER_API_KEY_3: 'three' } }).llm; assert.equal(gateway.status().keyCount, 3);
  const nvidia = loadConfig({ NVIDIA_API_KEY: 'nvapi-key' }); assert.equal(nvidia.llm.provider, 'nvidia'); assert.equal(nvidia.llm.nvidiaEndpoint, 'https://integrate.api.nvidia.com/v1');
  const legacyAuto = loadConfig({ MINEHIVE_LLM_PROVIDER: 'auto', OPENROUTER_API_KEY: 'legacy-key' }); assert.equal(legacyAuto.llm.provider, 'openrouter');
  const legacyLocal = loadConfig({ MINEHIVE_LLM_PROVIDER: 'local', MINEHIVE_LOCAL_LLM_ENDPOINT: 'http://127.0.0.1:8000/v1', MINEHIVE_LOCAL_LLM_MODEL: 'legacy-model' }); assert.equal(legacyLocal.llm.provider, 'nvidia'); assert.equal(legacyLocal.llm.nvidiaEndpoint, 'http://127.0.0.1:8000/v1'); assert.equal(legacyLocal.llm.nvidiaModel, 'legacy-model');
  assert.throws(() => loadConfig({ MINEHIVE_LLM_PROVIDER: 'unsupported' }), /must be none, openrouter, or nvidia/);
});

test('production configuration requires API authentication', () => {
  assert.throws(() => loadConfig({ MINEHIVE_PROFILE: 'production' }), /MINEHIVE_API_TOKEN is required/);
  assert.equal(loadConfig({ MINEHIVE_PROFILE: 'production', MINEHIVE_API_TOKEN: 'secure-token' }).database.driver, 'sqlite');
});

test('configuration validates bounded per-bot task queues', () => {
  assert.equal(loadConfig({ MINEHIVE_MAX_QUEUE_PER_BOT: '25' }).tasks.maxQueuePerBot, 25);
  assert.throws(() => loadConfig({ MINEHIVE_MAX_QUEUE_PER_BOT: '0' }), /Task queue limit/);
});

test('configuration validates short and long memory lifecycle policy', () => {
  const config = loadConfig({ MINEHIVE_SHORT_MEMORY_MAX_RECORDS: '250', MINEHIVE_SHORT_MEMORY_TTL_MS: '60000', MINEHIVE_MEMORY_PROMOTION_ACCESSES: '4', MINEHIVE_MEMORY_PROMOTION_IMPORTANCE: '0.75' }); assert.equal(config.semanticMemory.shortTermMaxRecords, 250); assert.equal(config.semanticMemory.promotionAccesses, 4); assert.equal(config.semanticMemory.promotionImportance, 0.75);
  assert.equal(loadConfig({ MINEHIVE_MEMORY_MAX_RECORDS: '100' }).semanticMemory.shortTermMaxRecords, 100);
  assert.throws(() => loadConfig({ MINEHIVE_SHORT_MEMORY_TTL_MS: '100' }), /short-term memory lifecycle/);
});
