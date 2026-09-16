import assert from 'node:assert/strict';
import test from 'node:test';
import { DenseClassifier } from '../src/ml/neural-network.js';
import { NeuralDialogueModel, dialogueSamples } from '../src/ml/local-dialogue-model.js';
import { loadTrainingSources } from '../src/ml/training-source-loader.js';
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
  const prediction = brain.predict('buat chest 2'); assert.equal(prediction.label, 'craft'); assert.ok(brain.status().metrics.samples >= 60); assert.equal((await models.list())[0].commandNetwork.architecture, 'dense-relu-softmax-v1'); assert.ok(brain.status().parameterCount >= 7_900_000);
});

test('8M local dialogue model trains and produces conversational classifications', () => {
  const model = new NeuralDialogueModel(); const metrics = model.train(dialogueSamples()); assert.equal(model.parameterCount, 7_902_760); assert.ok(metrics.accuracy > 0.95); assert.equal(model.predict('cloud provider mati').label, 'cloud_failure');
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

test('LLM gateway speaks through the local neural model when cloud is unavailable', async () => {
  const brain = createLocalCommandBrain({ modelRepository:new MemoryRepository(), sampleRepository:new MemoryRepository(), mode:'fallback' }); await brain.initialize(); const gateway = new LlmGateway({ provider:'none' }, { warn(){} }, brain);
  const result = await gateway.interpret('siapa kamu dan apa kemampuanmu', { selector:'auto', fleet:[{id:'one'}] }); assert.equal(result.intent, 'converse'); assert.match(result.reply, /MineHive|pusat komando|memahami perintah|membantu/i);
});

test('training source loader reads the base command-center text', async () => {
  const loaded = await loadTrainingSources(['training/local-ai/command-center.jsonl']); assert.ok(loaded.samples.length >= 20); assert.ok(loaded.documents.length >= 20); assert.equal(loaded.samples[0].label, 'identity');
});
