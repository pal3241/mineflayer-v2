import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, MemoryRepository, createMemoryEventStream } from '../src/index.js';

function fixture({ repository = new MemoryRepository(), checkpointRepository = new MemoryRepository(), events = new EventBus(), maxRecords = 100 } = {}) {
  const stream = createMemoryEventStream({ repository, checkpointRepository, events, maxRecords }); return { stream, repository, checkpointRepository, events };
}

test('unified stream persists only memory events in ordered hash chain', async () => {
  const { stream, events } = fixture(); await stream.initialize(); await events.publish('task.started', { id: 'ignored' }, { source: 'test' }); await events.publish('memory.world.remembered', { id: 'world-1', name: 'base' }, { source: 'world-memory', correlationId: 'world-1' }); await events.publish('memory.working.activated', { id: 'working-1', taskId: 'task-1' }, { source: 'working-memory', correlationId: 'task-1' }); const records = await stream.query(); assert.equal(records.length, 2); assert.deepEqual(records.map(item => item.sequence), [1, 2]); assert.equal(records[0].layer, 'world'); assert.equal(records[1].previousHash, records[0].hash); assert.equal((await stream.status()).integrity.valid, true); stream.dispose();
});

test('stream supports filtered replay and monotonic consumer checkpoints', async () => {
  const { stream, events } = fixture(); await stream.initialize(); await events.publish('memory.semantic.remembered', { id: 'semantic-1' }, { source: 'semantic-memory', correlationId: 'goal-1' }); await events.publish('memory.episodic.recorded', { id: 'episode-1' }, { source: 'episodic-memory', correlationId: 'goal-1' }); await events.publish('memory.knowledge.created', { id: 'knowledge-1' }, { source: 'knowledge-memory', correlationId: 'goal-2' }); const replay = await stream.replay({ afterSequence: 1, layers: ['episodic', 'knowledge'] }); assert.deepEqual(replay.map(item => item.sequence), [2, 3]); await stream.checkpoint('planner-a', 2); assert.deepEqual((await stream.readFromCheckpoint('planner-a')).map(item => item.sequence), [3]); await assert.rejects(stream.checkpoint('planner-a', 1), /cannot move backwards/); await assert.rejects(stream.checkpoint('planner-a', 4), /cannot exceed latest/); stream.dispose();
});

test('stream detects persisted payload tampering before replay', async () => {
  const repository = new MemoryRepository(); const checkpointRepository = new MemoryRepository(); const events = new EventBus(); const first = fixture({ repository, checkpointRepository, events }); await first.stream.initialize(); await events.publish('memory.world.remembered', { id: 'world-1', name: 'base' }, { source: 'world-memory' }); first.stream.dispose(); const [record] = await repository.list(); await repository.update(record.id, { payload: { id: 'world-1', name: 'tampered' } }); const second = fixture({ repository, checkpointRepository, events }); const initialized = await second.stream.initialize(); assert.equal(initialized.valid, false); assert.equal(initialized.errors[0].code, 'HASH_MISMATCH'); await assert.rejects(second.stream.replay({}), /integrity check failed/); assert.equal((await second.stream.status()).status, 'DEGRADED'); second.stream.dispose();
});

test('bounded stream retains latest events without resetting sequence', async () => {
  const { stream, events } = fixture({ maxRecords: 100 }); await stream.initialize(); for (let index = 1; index <= 105; index++) await events.publish('memory.semantic.remembered', { id: `memory-${index}` }, { source: 'semantic-memory' }); const status = await stream.status(); assert.equal(status.count, 100); assert.equal(status.earliestSequence, 6); assert.equal(status.latestSequence, 105); assert.deepEqual((await stream.query({ limit: 1 })).map(item => item.sequence), [6]); stream.dispose();
});
