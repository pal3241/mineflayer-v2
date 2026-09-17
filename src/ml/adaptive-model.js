import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';
import { NativeTaskModel } from './native-task-model.js';
import { DenseClassifier } from './neural-network.js';

const WIDTH = 64;

// This is a trained success classifier, not a manually weighted score.
export function createAdaptiveModel({ outcomeRepository, modelRepository, events, minimumSamples, nativeModel = new NativeTaskModel() }) {
  if (!outcomeRepository || !modelRepository) throw new ValidationError('ML outcome and model repositories are required');
  let outcomeCache = null; let modelCache = null; let queue = Promise.resolve(); let active = null; let predictionCount = 0; let totalLatency = 0;
  const outcomes = async () => outcomeCache ??= await outcomeRepository.list();
  const storedModels = async () => modelCache ??= await modelRepository.list();
  const enqueue = operation => { const result = queue.then(operation); queue = result.then(() => undefined, () => undefined); return result; };
  const train = async () => {
    const records = await outcomes(); const samples = records.map(record => ({ input: vector(record), success: record.success })); const previous = (await storedModels()).find(item => item.id === 'native-task-success-v1'); let model;
    if (nativeModel.available()) {
      const result = await nativeModel.train(samples, { weights: previous?.weights, bias: previous?.bias });
      model = { id:'native-task-success-v1', version:1, status:'PRODUCTION', modelType:'rust-logistic-regression', featureVersion:3, weights:result.weights, bias:result.bias, metrics:{ samples:result.samples, loss:round(result.loss), accuracy:round(result.accuracy) }, trainedAt:new Date().toISOString() };
    } else {
      const network = new DenseClassifier({ inputSize:WIDTH, hiddenSize:24, labels:['FAILURE','SUCCESS'] });
      const fallback = samples.length ? samples : [{ input:Array(WIDTH).fill(0), success:true }, { input:Array(WIDTH).fill(0), success:false }];
      const metrics = network.train(fallback.map(item => ({ input:item.input, label:item.success ? 'SUCCESS' : 'FAILURE' })), { epochs:180, learningRate:0.035 });
      model = { id:'native-task-success-v1', version:1, status:'PRODUCTION', modelType:'dense-neural-fallback', featureVersion:3, network:network.serialize(), metrics, trainedAt:new Date().toISOString() };
    }
    if (previous) await modelRepository.update(previous.id, model); else await modelRepository.create(model);
    modelCache = [model, ...(await storedModels()).filter(item => item.id !== model.id)]; active = model;
    await events?.publish('ml.trained', { model:model.modelType, metrics:model.metrics }, { source:'adaptive-model' }); return model;
  };
  const ensure = async () => active ?? (await storedModels()).find(item => item.id === 'native-task-success-v1') ?? train();
  const recordOutcome = input => enqueue(async () => {
    const value = normalize(input); const record = await outcomeRepository.create({ id:randomUUID(), ...value, createdAt:new Date().toISOString(), schemaVersion:1 }); outcomeCache = [record, ...await outcomes()];
    if (outcomeCache.length >= minimumSamples) await train();
    await events?.publish('ml.outcome.recorded', record, { source:'adaptive-model' }); return record;
  });
  const predict = async input => {
    const started = performance.now(); if (!input?.botId) throw new ValidationError('ML prediction requires botId'); const model = await ensure(); const inputVector = vector({ botId:String(input.botId), intent:String(input.intent ?? 'unknown'), features:normalizeFeatures(input.features ?? {}) }); let probability;
    if (model.modelType === 'rust-logistic-regression' && nativeModel.available()) probability = (await nativeModel.predict(inputVector, model)).probability;
    else probability = DenseClassifier.restore(model.network).predict(inputVector).probabilities.SUCCESS;
    predictionCount++; totalLatency += performance.now() - started; const sampleCount = (await outcomes()).filter(item => item.intent === String(input.intent ?? 'unknown')).length;
    return { prediction:round(probability), confidence:round(Math.min(.99, 1 - Math.exp(-sampleCount / Math.max(2, minimumSamples)))), modelVersion:'native-task-success-v1', sampleCount, model:model.modelType, timestamp:new Date().toISOString() };
  };
  const status = async () => { const records=await outcomes(); return { status:'HEALTHY', outcomeCount:records.length, inferenceVersion:'native-task-success-v1', productionModel:await ensure(), monitoring:{ predictionCount, averagePredictionLatencyMs:predictionCount ? round(totalLatency / predictionCount) : 0, nativeAvailable:nativeModel.available(), byIntent:summarize(records,'intent'), byBot:summarize(records,'botId') } }; };
  return Object.freeze({ recordOutcome, predict, status, train, models:storedModels, outcomes });
}
function normalize(input) { if (typeof input.success !== 'boolean') throw new ValidationError('ML outcome success must be boolean'); if (!input.botId) throw new ValidationError('ML outcome requires botId'); return { botId:String(input.botId), intent:String(input.intent ?? 'unknown'), success:input.success, durationMs:Math.max(0, Number(input.durationMs) || 0), features:normalizeFeatures(input.features ?? {}), source:String(input.source ?? 'coordinator') }; }
function normalizeFeatures(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('ML features must be an object'); return Object.fromEntries(Object.entries(value).filter(([, item]) => ['string','number','boolean'].includes(typeof item) && (typeof item !== 'number' || Number.isFinite(item))).slice(0, 32)); }
function vector(value) { const result=Array(WIDTH).fill(0); add(result, `bot:${value.botId}`, 1); add(result, `intent:${value.intent}`, 1); for (const [key,item] of Object.entries(value.features ?? {})) add(result, typeof item === 'number' ? `num:${key}` : `${key}:${item}`, typeof item === 'number' ? Math.max(-1, Math.min(1, item)) : 1); const norm=Math.hypot(...result) || 1; return result.map(item => item / norm); }
function add(vector, key, value) { vector[hash(key) % WIDTH] += value; }
function hash(value) { let result=2166136261; for (const char of String(value)) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); } return result >>> 0; }
function round(value) { return Math.round(Number(value ?? 0) * 10000) / 10000; }
function summarize(records, field) { const result={}; for(const item of records) { const key=item[field]; const value=result[key]??={samples:0,successes:0,durationMs:0}; value.samples++; value.successes+=item.success?1:0; value.durationMs+=item.durationMs; } return Object.fromEntries(Object.entries(result).map(([key,value])=>[key,{samples:value.samples,successRate:round(value.successes/value.samples),averageDurationMs:Math.round(value.durationMs/value.samples)}])); }
