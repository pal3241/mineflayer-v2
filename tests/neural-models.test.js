import assert from 'node:assert/strict';
import test from 'node:test';
import { DenseClassifier } from '../src/ml/neural-network.js';
import { createLocalCommandBrain } from '../src/ml/local-command-brain.js';
import { createEnvironmentSafetyModel } from '../src/ml/environment-safety-model.js';
import { LlmGateway } from '../src/ai/llm-gateway.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';

test('dense neural classifier trains, predicts, and restores persisted weights', () => {
  const samples = [{ input:[0,0], label:'SAFE' }, { input:[0.1,0], label:'SAFE' }, { input:[1,1], label:'DANGER' }, { input:[0.9,1], label:'DANGER' }];
  const network = new DenseClassifier({ inputSize:2, hiddenSize:6, labels:['SAFE','DANGER'] }); const metrics = network.train(samples, { epochs:250, learningRate:0.08 });
  assert.ok(metrics.accuracy >= 0.75); const restored = DenseClassifier.restore(network.serialize()); assert.equal(restored.predict([1,1]).label, network.predict([1,1]).label);
});

test('local command brain performs real training and persists its neural model', async () => {
  const models = new MemoryRepository(), samples = new MemoryRepository(); const brain = createLocalCommandBrain({ modelRepository:models, sampleRepository:samples }); await brain.initialize();
  const prediction = brain.predict('buat chest 2'); assert.equal(prediction.label, 'craft'); assert.ok(brain.status().metrics.samples >= 60); assert.equal((await models.list())[0].network.architecture, 'dense-relu-softmax-v1');
});

test('environment neural model learns universal area safety memory', async () => {
  const areas = new MemoryRepository(); const remembered = []; const model = createEnvironmentSafetyModel({ observationRepository:new MemoryRepository(), modelRepository:new MemoryRepository(), areaRepository:areas, memory:{ recordAreaSafety: async area => remembered.push(area) } }); await model.initialize();
  const result = await model.observe({ worldKey:'localhost:25565', dimension:'overworld', position:{x:64,y:64,z:64}, label:'DANGEROUS', features:{ hostileDensity:1, deathRate:1, darkness:1, healthLoss:1, trapped:1 } });
  assert.equal(result.area.classification, 'DANGEROUS'); assert.equal(remembered.length, 1); assert.equal((await model.areas()).length, 1); assert.equal((await model.areaAt({ worldKey:'localhost:25565', dimension:'overworld', position:{x:70,y:70,z:70} })).id, result.area.id); assert.equal(await model.areaAt({ worldKey:'localhost:25565', dimension:'overworld', position:{x:256,y:70,z:256} }), null);
});

test('LLM gateway can manually use the local neural command center', async () => {
  const brain = createLocalCommandBrain({ modelRepository:new MemoryRepository(), sampleRepository:new MemoryRepository(), mode:'manual' }); await brain.initialize(); const gateway = new LlmGateway({ provider:'none' }, { warn(){} }, brain);
  const result = await gateway.interpret('buat chest 2', { selector:'bot:worker' }); assert.equal(result.intent, 'craft'); assert.equal(result.item, 'chest'); assert.equal(result.count, 2); assert.equal(gateway.status().provider, 'local-neural');
});
