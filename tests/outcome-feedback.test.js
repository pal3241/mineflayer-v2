import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { createOutcomeFeedback } from '../src/ml/outcome-feedback.js';

function fixture() {
  const events = new EventBus();
  const recorded = [];
  const ml = { async recordOutcome(value) { recorded.push(value); return { id: `outcome-${recorded.length}` }; } };
  const feedback = createOutcomeFeedback({ events, ml });
  return { events, recorded, feedback };
}

test('completed and failed task events are sent to the adaptive model', async () => {
  const { events, recorded, feedback } = fixture();
  await events.publish('task.completed', {
    id: 'task-1', assignedBot: 'miner-1', type: 'collect',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:03.000Z',
    outcomeFeatures: { health: 18, food: 16, hasTool: true }
  }, { source: 'test' });
  await events.publish('task.failed', {
    id: 'task-2', botId: 'miner-2', type: 'craft',
    durationMs: 900, error: { code: 'MATERIALS_MISSING' }
  }, { source: 'test' });
  await feedback.flush();

  assert.equal(recorded.length, 2);
  assert.deepEqual(recorded.map(item => item.success), [true, false]);
  assert.equal(recorded[0].botId, 'miner-1');
  assert.equal(recorded[0].durationMs, 3000);
  assert.deepEqual(recorded[0].features, { health: 18, food: 16, hasTool: true });
  assert.equal(recorded[1].errorCode, 'MATERIALS_MISSING');
  feedback.dispose();
});

test('duplicate terminal events for the same task are ignored within one runtime', async () => {
  const { events, recorded, feedback } = fixture();
  const task = { id: 'task-1', assignedBot: 'miner', type: 'collect' };
  await events.publish('task.completed', task, { source: 'test' });
  await events.publish('task.completed', task, { source: 'test' });
  await feedback.flush();
  assert.equal(recorded.length, 1);
  feedback.dispose();
});

test('tasks without a bot identity are ignored rather than polluting training data', async () => {
  const { events, recorded, feedback } = fixture();
  await events.publish('task.failed', { id: 'task-no-bot', type: 'mine' }, { source: 'test' });
  await feedback.flush();
  assert.equal(recorded.length, 0);
  feedback.dispose();
});

test('disposing feedback detaches event listeners', async () => {
  const { events, recorded, feedback } = fixture();
  feedback.dispose();
  await events.publish('task.completed', { id: 'task-1', assignedBot: 'miner', type: 'collect' }, { source: 'test' });
  await feedback.flush();
  assert.equal(recorded.length, 0);
});
