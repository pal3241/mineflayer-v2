import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

export function createAdaptiveModel({ outcomeRepository, modelRepository, events, minimumSamples }) {
  if (!outcomeRepository || !modelRepository) throw new ValidationError('ML outcome and model repositories are required');
  if (!Number.isInteger(minimumSamples) || minimumSamples < 2) throw new ValidationError('ML minimumSamples must be at least 2');

  let modelInitialization = null;
  const recordOutcome = async input => {
    const outcome = normalizeOutcome(input); const record = await outcomeRepository.create({ ...outcome, id: randomUUID(), createdAt: new Date().toISOString(), schemaVersion: 1 });
    modelInitialization ??= ensureModel(modelRepository, minimumSamples); await modelInitialization; await events?.publish('ml.outcome.recorded', record, { source: 'adaptive-model' }); return record;
  };
  const predict = async input => {
    const botId = String(input.botId ?? ''); const intent = String(input.intent ?? 'unknown'); if (!botId) throw new ValidationError('ML prediction requires botId');
    const outcomes = (await outcomeRepository.list()).filter(item => item.botId === botId && (item.intent === intent || item.intent === 'unknown')); const successes = outcomes.filter(item => item.success).length; const probability = (successes + 1) / (outcomes.length + 2);
    return { prediction: probability, confidence: Math.min(0.95, outcomes.length / Math.max(minimumSamples, outcomes.length + 2)), modelVersion: 'success-beta-v1', sampleCount: outcomes.length, evidence: { successes, failures: outcomes.length - successes }, timestamp: new Date().toISOString() };
  };
  const status = async () => { const outcomes = await outcomeRepository.list(); const models = await modelRepository.list(); const recent = outcomes.slice(0, 50); const older = outcomes.slice(50, 100); const drift = Math.abs(successRate(recent) - successRate(older)); return { status: 'HEALTHY', outcomeCount: outcomes.length, productionModel: models.find(model => model.status === 'PRODUCTION') ?? null, drift: { detected: older.length >= minimumSamples && drift > 0.25, magnitude: Math.round(drift * 1000) / 1000 } }; };
  return Object.freeze({ recordOutcome, predict, status, models: () => modelRepository.list(), outcomes: () => outcomeRepository.list() });
}

function normalizeOutcome(input) { if (typeof input.success !== 'boolean') throw new ValidationError('ML outcome success must be boolean'); const durationMs = Number(input.durationMs); if (!Number.isFinite(durationMs) || durationMs < 0) throw new ValidationError('ML outcome durationMs must be a non-negative number'); return { botId: String(input.botId ?? ''), intent: String(input.intent ?? 'unknown'), success: input.success, durationMs, features: structuredClone(input.features ?? {}), labelVersion: 1, featureVersion: 1, source: String(input.source ?? 'coordinator') }; }
async function ensureModel(repository, minimumSamples) { const existing = await repository.list(); if (existing.length) return existing[0]; const now = new Date().toISOString(); return repository.create({ id: 'success-beta-v1', version: 1, task: 'task-success', modelType: 'beta-binomial', featureVersion: 1, labelVersion: 1, minimumSamples, metrics: {}, status: 'PRODUCTION', createdAt: now, promotedAt: now }); }
function successRate(records) { return records.length ? records.filter(record => record.success).length / records.length : 0.5; }
