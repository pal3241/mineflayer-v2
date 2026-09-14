import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, MemoryRepository, createEpisodicMemoryService, createHashEmbeddingProvider, createKnowledgeService } from '../src/index.js';

function fixture({ maxRecords = 10, minimumEvidence = 3 } = {}) {
  const events = new EventBus(); const embeddingProvider = createHashEmbeddingProvider({ dimensions: 16, version: 'test' }); const archives = []; const audit = []; const governance = { archive: async (record, reason) => archives.push({ record, reason }), record: async entry => audit.push(entry) }; const episodicMemory = createEpisodicMemoryService({ repository: new MemoryRepository(), events, embeddingProvider, governance, maxRecords: 100 }); const knowledge = createKnowledgeService({ repository: new MemoryRepository(), episodicMemory, embeddingProvider, events, governance, maxRecords, minimumEvidence }); return { events, episodicMemory, knowledge, archives, audit };
}

test('procedural knowledge stores declarative verified steps without an executor', async () => {
  const { knowledge } = fixture(); await knowledge.initialize(); const procedure = await knowledge.remember({ knowledgeType: 'PROCEDURE', key: 'procedure:mine-iron', name: 'Mine iron safely', intent: 'collect', status: 'ACTIVE', preconditions: [{ field: 'tool', operator: 'tier-at-least', value: 'stone' }], steps: [{ order: 1, action: 'navigate', expected: 'near ore' }, { order: 2, action: 'collect', verification: 'inventory delta' }] }); assert.equal(procedure.steps.length, 2); assert.equal(procedure.version, 1); assert.equal(procedure.embedding.vector, undefined); assert.equal(typeof knowledge.execute, 'undefined');
  const found = await knowledge.search({ text: 'mine iron collect', knowledgeType: 'PROCEDURE', status: 'ACTIVE' }); assert.equal(found[0].id, procedure.id);
});

test('knowledge revision uses optimistic versioning and feedback changes confidence', async () => {
  const { knowledge } = fixture(); const strategy = await knowledge.remember({ knowledgeType: 'STRATEGY', key: 'strategy:nether-route', name: 'Nether route', intent: 'navigate', status: 'ACTIVE', recommendations: ['prefer verified tunnel'] }); await assert.rejects(knowledge.revise(strategy.id, { expectedVersion: 0, recommendations: ['wrong'] }), /version conflict/); const revised = await knowledge.revise(strategy.id, { expectedVersion: 1, recommendations: ['prefer lit verified tunnel'] }); assert.equal(revised.version, 2); const feedback = await knowledge.feedback(strategy.id, { success: true, episodeId: 'episode-1' }); assert.equal(feedback.version, 3); assert.ok(feedback.confidence > 0.5); assert.equal(feedback.evidence.samples, 1);
});

test('concurrent knowledge revisions cannot overwrite the same version', async () => {
  const { knowledge } = fixture(); const strategy = await knowledge.remember({ knowledgeType: 'STRATEGY', key: 'strategy:concurrent', name: 'Concurrent route', intent: 'navigate', status: 'ACTIVE', recommendations: ['original'] }); const revisions = await Promise.allSettled([knowledge.revise(strategy.id, { expectedVersion: 1, recommendations: ['first'] }), knowledge.revise(strategy.id, { expectedVersion: 1, recommendations: ['second'] })]); assert.equal(revisions.filter(result => result.status === 'fulfilled').length, 1); assert.equal(revisions.filter(result => result.status === 'rejected').length, 1); assert.match(revisions.find(result => result.status === 'rejected').reason.message, /version conflict/); assert.equal((await knowledge.find(strategy.id)).version, 2);
});

test('repeated episodes synthesize active strategic knowledge deterministically', async () => {
  const { episodicMemory, knowledge } = fixture({ minimumEvidence: 3 }); await episodicMemory.initialize(); await knowledge.initialize(); for (let index = 0; index < 3; index++) await episodicMemory.remember({ episodeType: 'TASK_OUTCOME', sourceId: `task-${index}`, action: 'survey', outcome: index === 2 ? 'FAILURE' : 'SUCCESS', lesson: index === 2 ? 'survey failed path blocked' : 'survey succeeded' }); const [strategy] = await knowledge.search({ intent: 'survey', knowledgeType: 'STRATEGY', status: 'ACTIVE' }); assert.equal(strategy.evidence.samples, 3); assert.equal(strategy.evidence.successes, 2); assert.equal(strategy.source, 'episodic-synthesis'); assert.match(strategy.recommendations[0], /tervalidasi/);
});

test('knowledge retention archives deprecated and low-confidence records first', async () => {
  const value = fixture({ maxRecords: 2 }); await value.knowledge.remember({ knowledgeType: 'STRATEGY', key: 'old', name: 'Old', intent: 'move', status: 'DEPRECATED', recommendations: ['old route'], confidence: 0.1 }); await value.knowledge.remember({ knowledgeType: 'STRATEGY', key: 'good', name: 'Good', intent: 'move', status: 'ACTIVE', recommendations: ['good route'], confidence: 0.9 }); await value.knowledge.remember({ knowledgeType: 'PROCEDURE', key: 'safe', name: 'Safe', intent: 'collect', status: 'ACTIVE', steps: [{ action: 'collect' }], confidence: 0.8 }); assert.equal((await value.knowledge.search({})).length, 2); assert.equal(value.archives[0].record.key, 'old');
});
