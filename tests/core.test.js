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
  await app.start({ api: false }); assert.equal(app.state, 'RUNNING'); assert.equal((await app.health.check()).status, 'HEALTHY'); await app.stop(); assert.equal(app.state, 'STOPPED');
});

test('configuration loads three OpenRouter keys and provider deduplicates fallback aliases', () => {
  const config = loadConfig({ OPENROUTER_API_KEY_1: 'one', OPENROUTER_API_KEY_2: 'two', OPENROUTER_API_KEY_3: 'three', OPENROUTER_API_KEY: 'one' }); assert.deepEqual(config.llm.apiKeys, ['one', 'two', 'three', 'one']);
  const gateway = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent', OPENROUTER_API_KEY_1: 'one', OPENROUTER_API_KEY_2: 'two', OPENROUTER_API_KEY_3: 'three' } }).llm; assert.equal(gateway.status().keyCount, 3);
});
