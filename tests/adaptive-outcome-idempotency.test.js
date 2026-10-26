import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createAdaptiveModel } from '../src/ml/adaptive-model.js';

test('adaptive model stores task outcome idempotently across service instances', async () => {
  const outcomeRepository = new MemoryRepository();
  const modelRepository = new MemoryRepository();
  const first = createAdaptiveModel({ outcomeRepository, modelRepository, minimumSamples: 4 });
  await first.initialize();
  const input = {
    botId: 'miner-1', intent: 'collect', success: false, source: 'task-lifecycle',
    sourceId: 'task:durable-1', taskId: 'durable-1', errorCode: 'PATH_BLOCKED',
    features: { health: 5, food: 8, hasTool: true }
  };
  const one = await first.recordOutcome(input);
  const duplicateInSameService = await first.recordOutcome(input);
  assert.equal(one.id, duplicateInSameService.id);
  assert.equal((await first.status()).outcomeCount, 1);

  const restarted = createAdaptiveModel({ outcomeRepository, modelRepository, minimumSamples: 4 });
  await restarted.initialize();
  const duplicateAfterRestart = await restarted.recordOutcome(input);
  assert.equal(duplicateAfterRestart.id, one.id);
  assert.equal((await restarted.status()).outcomeCount, 1);
});
