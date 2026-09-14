import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createResilienceService } from '../src/resilience/index.js';

function setup(options = {}) { const repositories = { incidents: new MemoryRepository(), deadLetters: new MemoryRepository(), recovery: new MemoryRepository(), commands: new MemoryRepository() }; return { repositories, resilience: createResilienceService({ repositories, events: new EventBus(), delay: async () => {}, ...options }) }; }

test('emergency lifecycle is idempotent and returns to normal after stabilization', async () => {
  const { resilience } = setup(); const input = { type: 'BASE_ATTACK', severity: 'CRITICAL', idempotencyKey: 'base-attack:1', details: { enemies: 8 } }; const first = await resilience.raise(input); const replay = await resilience.raise(input); assert.equal(replay.id, first.id); assert.equal((await resilience.status()).mode, 'EMERGENCY'); assert.equal(first.response, 'EVACUATE_AND_INTERCEPT'); await resilience.resolve(first.id, { resolution: 'Base perimeter secured' }); assert.equal((await resilience.status()).mode, 'NORMAL');
});

test('bounded retry uses exponential attempt budget and persists idempotent result', async () => {
  const waits = []; const { resilience } = setup({ delay: async ms => waits.push(ms) }); let calls = 0; const operation = async () => { calls += 1; if (calls < 3) throw new Error('temporary'); return 'ok'; }; const first = await resilience.execute({ idempotencyKey: 'route:42', dependency: 'pathfinder', operation, maxAttempts: 4, baseDelayMs: 10 }); assert.deepEqual(first, { value: 'ok', attempts: 3, replayed: false }); assert.deepEqual(waits, [10, 20]); const replay = await resilience.execute({ idempotencyKey: 'route:42', dependency: 'pathfinder', operation }); assert.equal(replay.replayed, true); assert.equal(calls, 3);
});

test('exhausted retry budget enters dead-letter and recovery queues', async () => {
  const { resilience, repositories } = setup(); await assert.rejects(resilience.execute({ idempotencyKey: 'broken:1', dependency: 'plugin', operation: async () => { throw Object.assign(new Error('broken'), { code: 'PLUGIN_FAILURE' }); }, maxAttempts: 2, baseDelayMs: 0 }), /broken/); assert.equal((await repositories.deadLetters.list()).length, 1); assert.equal((await repositories.recovery.list())[0].status, 'PENDING'); assert.equal((await resilience.status()).mode, 'DEGRADED');
});

test('circuit breaker opens after bounded repeated failures', async () => {
  const { resilience } = setup({ circuitFailureThreshold: 2 }); await assert.rejects(resilience.execute({ idempotencyKey: 'failure:1', dependency: 'llm', operation: async () => { throw new Error('down'); }, maxAttempts: 2, baseDelayMs: 0 })); await assert.rejects(resilience.execute({ idempotencyKey: 'failure:2', dependency: 'llm', operation: async () => 'never' }), error => error.code === 'CONFLICT'); assert.equal((await resilience.status()).circuits[0].state, 'OPEN');
});

test('dependency failure selects degraded deterministic operation', async () => {
  const { resilience } = setup(); await resilience.reportDependency({ name: 'openrouter', status: 'FAILED', error: 'provider unavailable' }); const status = await resilience.status(); assert.equal(status.mode, 'DEGRADED'); assert.equal(status.dependencies[0].status, 'FAILED');
});

test('safe cancellation stops without retrying or entering recovery queue', async () => {
  const { resilience, repositories } = setup(); const controller = new AbortController(); controller.abort('owner stopped operation'); let calls = 0; await assert.rejects(resilience.execute({ idempotencyKey: 'cancelled:1', operation: async () => { calls += 1; }, signal: controller.signal }), error => error.code === 'CANCELLED'); assert.equal(calls, 0); assert.equal((await repositories.recovery.list()).length, 0);
});
