import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, MemoryRepository, createWorkingMemoryService } from '../src/index.js';

function fixture(options = {}) {
  const repository = new MemoryRepository(); const events = new EventBus(); const audit = [];
  const service = createWorkingMemoryService({ repository, events, governance: { record: async entry => audit.push(entry) }, maxRecords: options.maxRecords ?? 10, ttlMs: options.ttlMs ?? 60_000 });
  return { repository, events, audit, service };
}

test('working memory tracks bounded task context and structured progress', async () => {
  const { service } = fixture(); await service.initialize(); const opened = await service.activate({ id: 'task-1', assignedBot: 'bot-a', goalId: 'goal-1', type: 'collect', input: { target: { block: 'stone' } } }); assert.equal(opened.currentAction, 'collect'); assert.equal(opened.schemaVersion, 1);
  const updated = await service.update('task-1', { progress: { completed: 4, total: 10 }, inventory: [{ item: 'stone', count: 4 }], cargo: [{ item: 'stone', count: 4 }], route: [{ x: 1, y: 64, z: 2 }], controlLease: { id: 'lease-1' }, checkpoint: { step: 2 } });
  assert.equal(updated.progress.ratio, 0.4); assert.equal(updated.version, 2); assert.equal((await service.list({ botId: 'bot-a' })).length, 1); assert.equal((await service.find('task-1')).checkpoint.step, 2);
});

test('task lifecycle automatically opens, updates, and releases working memory', async () => {
  const { events, audit, service } = fixture(); await service.initialize(); await events.publish('task.started', { id: 'task-2', assignedBot: 'bot-b', goalId: 'goal-2', type: 'navigate', input: { target: { x: 8, y: 64, z: 8 } }, status: 'RUNNING' }, { source: 'test' }); assert.equal((await service.find('task-2')).currentAction, 'navigate');
  await events.publish('task.retrying', { taskId: 'task-2', error: 'path blocked' }, { source: 'test' }); assert.equal((await service.find('task-2')).metadata.lastError, 'path blocked'); await events.publish('task.completed', { id: 'task-2' }, { source: 'test' }); assert.equal((await service.list()).length, 0); assert.ok(audit.some(item => item.action === 'WORKING_RELEASED'));
});

test('restart purges stale workspace and capacity evicts the oldest active record', async () => {
  const value = fixture({ maxRecords: 2 }); await value.service.activate({ id: 'task-old', assignedBot: 'bot-a', type: 'collect' }); await value.service.activate({ id: 'task-mid', assignedBot: 'bot-b', type: 'survey' }); await value.service.activate({ id: 'task-new', assignedBot: 'bot-c', type: 'navigate' }); assert.deepEqual(new Set((await value.service.list()).map(item => item.taskId)), new Set(['task-mid', 'task-new']));
  const restarted = createWorkingMemoryService({ repository: value.repository, maxRecords: 2, ttlMs: 60_000, governance: { record: async entry => value.audit.push(entry) } }); const result = await restarted.initialize(); assert.equal(result.purged, 2); assert.equal((await restarted.list()).length, 0); assert.ok(value.audit.some(item => item.reason === 'restart-stale'));
});

test('working memory rejects unknown mutable fields and oversized records', async () => {
  const { service } = fixture(); await service.activate({ id: 'task-safe', assignedBot: 'bot-a', type: 'collect' }); await assert.rejects(service.update('task-safe', { executeCommand: 'mine now' }), /Unsupported working memory field/); await assert.rejects(service.update('task-safe', { metadata: { payload: 'x'.repeat(70_000) } }), /64 KiB/);
});

test('expired working memory is purged before reads', async () => {
  const { repository, audit, service } = fixture(); const record = await service.activate({ id: 'task-expired', assignedBot: 'bot-a', type: 'wait' }); await repository.update(record.id, { expiresAt: '2020-01-01T00:00:00.000Z' }); assert.equal((await service.list()).length, 0); assert.ok(audit.some(item => item.action === 'WORKING_PURGED' && item.reason === 'ttl-expired'));
});
