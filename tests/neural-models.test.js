import assert from 'node:assert/strict';
import test from 'node:test';
import { DenseClassifier } from '../src/ml/neural-network.js';
import { loadTrainingSources } from '../src/ml/training-source-loader.js';
import { createLocalCommandBrain } from '../src/ml/local-command-brain.js';
import { PythonLocalAiBridge } from '../src/ml/python-local-ai-bridge.js';
import { createEnvironmentSafetyModel } from '../src/ml/environment-safety-model.js';
import { createAdaptiveModel } from '../src/ml/adaptive-model.js';
import { createHashEmbeddingProvider, createSemanticMemory } from '../src/memory/semantic-memory.js';
import { LlmGateway } from '../src/ai/llm-gateway.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';

class FakePyTorchBridge {
  constructor(){this.value={status:'READY',parameterCount:8_034_243,architecture:'byte-gru-lm-2x896',metrics:{loss:1.2}};}
  status(){return this.value;} async initialize(){return this.value;} async train(_texts,{epochs}={}){this.value={...this.value,metrics:{epochs,loss:0.8}};return this.value;} async generate(text){return {text:/siapa|kemampuan/i.test(text)?'Aku pusat komando MineHive berbasis PyTorch.':'Minecraft adalah permainan sandbox berbasis blok.',tokens:12};} async save(path){return {saved:path,bytes:123};} async dispose(){}
}
const options = extra => ({ modelRepository:new MemoryRepository(), sampleRepository:new MemoryRepository(), dialogueRepository:new MemoryRepository(), documentRepository:new MemoryRepository(), dialogueBridge:new FakePyTorchBridge(), ...extra });

test('dense neural classifier trains, predicts, and restores persisted weights', () => {
  const samples = [{ input:[0,0], label:'SAFE' }, { input:[0.1,0], label:'SAFE' }, { input:[1,1], label:'DANGER' }, { input:[0.9,1], label:'DANGER' }];
  const network = new DenseClassifier({ inputSize:2, hiddenSize:6, labels:['SAFE','DANGER'] }); const metrics = network.train(samples, { epochs:250, learningRate:0.08 });
  assert.ok(metrics.accuracy >= 0.75); const restored = DenseClassifier.restore(network.serialize()); assert.equal(restored.predict([1,1]).label, network.predict([1,1]).label);
});

test('local command brain trains only after an explicit training request', async () => {
  const models = new MemoryRepository(); const brain = createLocalCommandBrain(options({ modelRepository:models })); await brain.initialize();
  assert.equal(brain.status().intentModel, 'not-trained'); assert.equal((await models.list()).length, 0);
  await brain.train({epochs:1}); const prediction = brain.predict('buat chest 2'); assert.equal(prediction.label, 'craft'); assert.ok(brain.status().metrics.trainSamples >= 200); assert.ok(brain.status().metrics.validation.samples > 0); assert.equal(brain.status().metrics.holdout,true); assert.equal((await models.list())[0].network.architecture, 'dense-relu-softmax-v1'); assert.ok(brain.status().parameterCount >= 8_000_000); assert.equal(brain.status().trainingPolicy,'explicit-only');
});

test('8M PyTorch bridge reports the autoregressive GRU architecture', async () => {
  const bridge=new FakePyTorchBridge(); const trained=await bridge.train(['text'],{epochs:25}); assert.equal(trained.parameterCount,8_034_243); assert.equal(trained.architecture,'byte-gru-lm-2x896'); assert.equal(trained.metrics.epochs,25);
});

test('PyTorch bridge reports a stopped worker without an unhandled EPIPE', async () => {
  const bridge=new PythonLocalAiBridge({checkpoint:'/tmp/minehive-missing.pt',python:'/bin/false'});
  await assert.rejects(bridge.train(['hello'],{epochs:1}),/worker stopped|Unable to contact/);
  await bridge.dispose();
});

test('local knowledge retrieval ignores short polluted titles', async () => {
  const documents=new MemoryRepository();
  await documents.create({id:'bad',text:'Minecraft Review',source:'old-import'});
  await documents.create({id:'good',text:'Minecraft adalah permainan sandbox berbasis blok yang memungkinkan pemain menjelajah, membangun, mengumpulkan sumber daya, dan bertahan hidup.',source:'dictionary'});
  const brain=createLocalCommandBrain(options({documentRepository:documents})); await brain.initialize();
  const answer=await brain.respond('apa itu minecraft? jelaskan secara singkat');
  assert.match(answer.reply,/permainan sandbox berbasis blok/i); assert.equal(answer.knowledge.source,'dictionary');
});

test('environment neural model learns universal area safety memory', async () => {
  const areas = new MemoryRepository(); const remembered = []; const model = createEnvironmentSafetyModel({ observationRepository:new MemoryRepository(), modelRepository:new MemoryRepository(), areaRepository:areas, memory:{ recordAreaSafety: async area => remembered.push(area) } }); await model.initialize();
  const result = await model.observe({ worldKey:'localhost:25565', dimension:'overworld', position:{x:64,y:64,z:64}, label:'DANGEROUS', features:{ hostileDensity:1, deathRate:1, darkness:1, healthLoss:1, trapped:1 } });
  assert.equal(result.area.classification, 'DANGEROUS'); assert.equal(remembered.length, 1); assert.equal((await model.areas()).length, 1); assert.equal((await model.areaAt({ worldKey:'localhost:25565', dimension:'overworld', position:{x:70,y:70,z:70} })).id, result.area.id); assert.equal(await model.areaAt({ worldKey:'localhost:25565', dimension:'overworld', position:{x:256,y:70,z:256} }), null);
});

test('task success logistic model uses explicit schema and holdout evaluation', async () => {
  const ml=createAdaptiveModel({outcomeRepository:new MemoryRepository(),modelRepository:new MemoryRepository(),minimumSamples:4});await ml.initialize();for(let index=0;index<10;index++)await ml.recordOutcome({botId:`bot-${index%2}`,intent:'collect',success:index%2===0,durationMs:100+index,features:{health:index%2===0?20:5,food:18,className:'miner',dimension:'overworld',hasTool:index%2===0}});assert.equal((await ml.status()).productionModel.status,'UNTRAINED');const model=await ml.train({epochs:80});assert.equal(model.modelType,'node-logistic-regression');assert.equal(model.metrics.holdout,true);assert.ok(model.metrics.validation.samples>0);assert.equal(model.featureSchema.version,4);
});

test('memory retrieval identifies itself as BM25 and ranks keyword evidence', async () => {
  const memory=createSemanticMemory({repository:new MemoryRepository(),embeddingProvider:createHashEmbeddingProvider({dimensions:64,version:'test'}),maxRecords:100});await memory.remember({content:'desa oak berada dekat sungai',importance:.5});await memory.remember({content:'tambang deepslate berada di bawah basis',importance:.5});const result=await memory.search({text:'desa oak sungai'});assert.match(result[0].content,/desa oak/);assert.equal(result[0].embedding.model,'minehive-keyword-bm25');
});

test('LLM gateway can manually use the local neural command center', async () => {
  const brain = createLocalCommandBrain(options({ mode:'manual' })); await brain.initialize(); const gateway = new LlmGateway({ provider:'none' }, { warn(){} }, brain);
  const result = await gateway.interpret('buat chest 2', { selector:'bot:worker' }); assert.equal(result.intent, 'craft'); assert.equal(result.item, 'chest'); assert.equal(result.count, 2); assert.equal(gateway.status().provider, 'local-neural');
});

test('LLM gateway speaks through the local neural model when cloud is unavailable', async () => {
  const brain = createLocalCommandBrain(options({ mode:'fallback' })); await brain.initialize(); const gateway = new LlmGateway({ provider:'none' }, { warn(){} }, brain);
  const result = await gateway.interpret('siapa kamu dan apa kemampuanmu', { selector:'auto', fleet:[{id:'one'}] }); assert.equal(result.intent, 'converse'); assert.match(result.reply, /MineHive|pusat komando|memahami perintah|membantu/i);
});

test('training source loader reads the base command-center text', async () => {
  const progress=[]; const loaded = await loadTrainingSources(['training/local-ai/command-center.jsonl'],{onProgress:value=>progress.push(value)}); assert.ok(loaded.samples.length >= 20); assert.ok(loaded.documents.length >= 20); assert.equal(loaded.samples[0].label, 'identity'); assert.deepEqual(progress.map(value=>value.phase),['reading','read']);
});
