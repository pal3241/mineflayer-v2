import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ActionNode, BehaviorTree, RetryNode, Status, TimeoutNode, CancellationToken, withTimeout, InterruptManager, InterruptPriority, ResumePolicy, CheckpointManager } from '../src/index.js';

test('retry decorator is bounded and eventually succeeds', async () => {
  let attempts = 0;
  const node = new RetryNode('retry', new ActionNode('unstable', async () => ++attempts < 3 ? Status.FAILURE : Status.SUCCESS), 3);
  assert.equal(await new BehaviorTree(node).tick(), Status.SUCCESS); assert.equal(attempts, 3);
});

test('timeout decorator returns structured failure status', async () => {
  const node = new TimeoutNode('slow', new ActionNode('wait', async ({ signal }) => { await delay(100, undefined, { signal }); return Status.SUCCESS; }), 5);
  assert.equal(await new BehaviorTree(node).tick(), Status.FAILURE);
});

test('linked cancellation reaches running operations', async () => {
  const token = new CancellationToken();
  const operation = withTimeout(signal => delay(500, 'done', { signal }), 1000, { signal: token.signal });
  token.cancel('test cancellation');
  await assert.rejects(operation, error => error.code === 'CANCELLED');
});

test('interrupt checkpoints work and resumes after safety verification', async () => {
  const checkpoints = new CheckpointManager(); const manager = new InterruptManager({ checkpointManager: checkpoints }); let resumed = false;
  manager.register('LOW_HEALTH', async () => ({ safe: true }));
  manager.request({ type: 'LOW_HEALTH', priority: InterruptPriority.SURVIVAL, resumePolicy: ResumePolicy.RESUME });
  const result = await manager.process({ taskId: 'task', botId: 'bot', verifySafety: output => output.safe, resume: async () => { resumed = true; } });
  assert.equal(result.resume, ResumePolicy.RESUME); assert.equal(resumed, true); assert.equal((await checkpoints.restore('task', checkpoint => checkpoint.botId === 'bot')).restored, true);
});
