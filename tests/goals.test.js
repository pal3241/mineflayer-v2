import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication, Goal, DeterministicPlanner, TaskGraph, Task } from '../src/index.js';

test('planner builds and validates an ordered dependency graph', () => {
  const goal = new Goal({ id: 'goal', description: 'Gather logs', steps: [
    { name: 'move', type: 'move', requiredCapabilities: ['navigation'] },
    { name: 'collect', type: 'collect', requiredCapabilities: ['collection'] }
  ] });
  const graph = new DeterministicPlanner().plan(goal);
  assert.deepEqual(graph.ready().map(task => task.type), ['move']);
  graph.ready()[0].update('COMPLETED'); assert.deepEqual(graph.ready().map(task => task.type), ['collect']);
});

test('task graph rejects dependency cycles', () => {
  assert.throws(() => new TaskGraph([
    new Task({ id: 'a', goalId: 'g', type: 'a', dependencies: ['b'] }),
    new Task({ id: 'b', goalId: 'g', type: 'b', dependencies: ['a'] })
  ]), error => error.code === 'CONFLICT');
});

test('goal executes task chain through matched bot capabilities', async () => {
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' } }); const calls = [];
  app.bots.create({ id: 'worker', username: 'Worker', capabilities: ['navigation', 'collection'] });
  app.capabilities.register({ name: 'navigation', execute: async (input, context) => { calls.push(['move', context.botId]); return { position: input.target }; } });
  app.capabilities.register({ name: 'collection', execute: async input => { calls.push(['collect', input.count]); return { count: input.count }; } });
  const goal = app.goals.create({ description: 'Gather 64 oak logs', steps: [
    { name: 'move', type: 'move', input: { target: 'forest' }, requiredCapabilities: ['navigation'] },
    { name: 'collect', type: 'collect', input: { count: 64 }, requiredCapabilities: ['collection'], verify: result => result.count === 64 }
  ] });
  const result = await app.goals.run(goal.id);
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.progress, 100); assert.deepEqual(calls, [['move', 'worker'], ['collect', 64]]);
  assert.deepEqual(await app.checkpoints.list(), []);
});

test('failed verified task is retried, checkpointed and fails its goal', async () => {
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' } }); let attempts = 0;
  app.bots.create({ id: 'worker', capabilities: ['collection'] });
  app.capabilities.register({ name: 'collection', execute: async () => ({ count: ++attempts }) });
  const goal = app.goals.create({ description: 'Impossible collection', steps: [{ type: 'collect', requiredCapabilities: ['collection'], retries: 1, verify: result => result.count === 99 }] });
  const result = await app.goals.run(goal.id);
  assert.equal(result.status, 'FAILED'); assert.equal(attempts, 2); assert.equal((await app.checkpoints.list()).length, 1);
});

test('task executor queues work sequentially for the same bot', async () => {
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent' } }); let active = 0; let maximumActive = 0; let releaseFirst; const firstGate = new Promise(resolve => { releaseFirst = resolve; }); const order = [];
  app.bots.create({ id: 'worker', capabilities: ['work'] }); app.capabilities.register({ name: 'work', execute: async input => { active++; maximumActive = Math.max(maximumActive, active); order.push(`start:${input.name}`); if (input.name === 'first') await firstGate; order.push(`end:${input.name}`); active--; return input.name; } });
  const first = app.goals.create({ description: 'First queued task', constraints: { preferredBot: 'worker' }, steps: [{ type: 'work', input: { name: 'first' }, requiredCapabilities: ['work'] }] }); const second = app.goals.create({ description: 'Second queued task', constraints: { preferredBot: 'worker' }, steps: [{ type: 'work', input: { name: 'second' }, requiredCapabilities: ['work'] }] }); const firstRun = app.goals.run(first.id); const secondRun = app.goals.run(second.id); await new Promise(resolve => setImmediate(resolve)); assert.equal(app.executor.status().queuedTasks, 1);
  releaseFirst(); const results = await Promise.all([firstRun, secondRun]); assert.deepEqual(results.map(result => result.status), ['COMPLETED', 'COMPLETED']); assert.equal(maximumActive, 1); assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']); assert.equal(app.executor.status().queuedTasks, 0);
});

test('task executor rejects overload beyond the configured per-bot queue limit', async () => {
  const app = createApplication({ env: { MINEHIVE_PROFILE: 'test', MINEHIVE_LOG_LEVEL: 'silent', MINEHIVE_MAX_QUEUE_PER_BOT: '1' } }); let releaseFirst; const gate = new Promise(resolve => { releaseFirst = resolve; });
  app.bots.create({ id: 'worker', capabilities: ['work'] }); app.capabilities.register({ name: 'work', execute: async input => { if (input.name === 'first') await gate; return input.name; } });
  const create = name => app.goals.create({ description: name, constraints: { preferredBot: 'worker' }, steps: [{ type: 'work', input: { name }, requiredCapabilities: ['work'] }] }); const first = create('first'); const second = create('second'); const third = create('third'); const firstRun = app.goals.run(first.id); await new Promise(resolve => setImmediate(resolve)); const secondRun = app.goals.run(second.id); const thirdRun = app.goals.run(third.id); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.executor.status().queuedTasks, 1); releaseFirst(); const results = await Promise.all([firstRun, secondRun, thirdRun]); assert.deepEqual(results.map(result => result.status), ['COMPLETED', 'COMPLETED', 'FAILED']); assert.match(app.goals.tasks(third.id)[0].error.message, /reached its limit/);
});
