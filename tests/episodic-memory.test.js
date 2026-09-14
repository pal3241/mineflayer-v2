import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, MemoryRepository, createEpisodicMemoryService, createHashEmbeddingProvider } from '../src/index.js';

function fixture(maxRecords = 10) {
  const repository = new MemoryRepository(); const events = new EventBus(); const audit = []; const archived = [];
  const governance = { record: async entry => audit.push(entry), archive: async (record, reason) => archived.push({ record, reason }) }; const service = createEpisodicMemoryService({ repository, events, governance, embeddingProvider: createHashEmbeddingProvider({ dimensions: 16, version: 'test' }), maxRecords });
  return { repository, events, audit, archived, service };
}

test('episodic memory records task outcomes once and preserves evidence', async () => {
  const { events, service } = fixture(); await service.initialize(); const task = { id: 'task-1', goalId: 'goal-1', assignedBot: 'miner', type: 'collect', input: { block: 'diamond_ore' }, result: { collected: 2 }, attempts: 1, createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:02.000Z' };
  await events.publish('task.completed', task, { source: 'test', correlationId: 'goal-1' }); await events.publish('task.completed', task, { source: 'test', correlationId: 'goal-1' }); const episodes = await service.search({ botId: 'miner' }); assert.equal(episodes.length, 1); assert.equal(episodes[0].outcome, 'SUCCESS'); assert.equal(episodes[0].durationMs, 2000); assert.equal(episodes[0].evidence.result.collected, 2); assert.equal(episodes[0].embedding.vector, undefined);
});

test('death episode produces a reusable location risk lesson', async () => {
  const { events, service } = fixture(); await service.initialize(); await events.publish('bot.death', { botId: 'miner', cause: 'lava', dimension: 'nether', position: { x: 12, y: 31, z: -8 }, inventory: [{ name: 'diamond_pickaxe', count: 1 }], keepInventory: false }, { source: 'test', id: 'death-1' }); const [episode] = await service.search({ text: 'lava danger', botId: 'miner', episodeType: 'BOT_DEATH' }); assert.equal(episode.position.x, 12); assert.match(episode.lesson, /lava/); assert.equal(episode.importance, 1);
});

test('retrieval filters outcomes and retention archives the weakest episode', async () => {
  const value = fixture(2); await value.service.initialize(); await value.service.remember({ episodeType: 'OBSERVATION', sourceId: 'weak', outcome: 'OBSERVED', action: 'survey', lesson: 'plain field', importance: 0.1 }); await value.service.remember({ episodeType: 'OBSERVATION', sourceId: 'strong', outcome: 'OBSERVED', action: 'survey', lesson: 'lava lake', importance: 1 }); await value.service.remember({ episodeType: 'TASK_OUTCOME', sourceId: 'failed', outcome: 'FAILURE', action: 'mine', lesson: 'mining failed near lava', importance: 0.9 });
  const failures = await value.service.search({ text: 'lava mining', outcome: 'FAILURE' }); assert.equal(failures.length, 1); assert.equal(failures[0].sourceId, 'failed'); assert.equal(value.archived.length, 1); assert.equal(value.archived[0].record.sourceId, 'weak'); assert.ok(value.audit.some(entry => entry.action === 'EPISODIC_EVICTED'));
});

test('manual episodes validate lesson and evidence bounds', async () => {
  const { service } = fixture(); await assert.rejects(service.remember({ episodeType: 'OBSERVATION', sourceId: 'empty', lesson: '' }), /lesson/); await assert.rejects(service.remember({ episodeType: 'OBSERVATION', sourceId: 'huge', lesson: 'large evidence', evidence: { value: 'x'.repeat(33_000) } }), /32 KiB/);
});
