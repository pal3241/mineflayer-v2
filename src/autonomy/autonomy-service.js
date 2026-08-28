import { randomUUID } from 'node:crypto';
import { ConflictError, ValidationError } from '../core/errors.js';

const SAFE_ACTIONS = new Set(['collect', 'survey', 'store', 'farm', 'reforest', 'deforest', 'guard', 'status']);

export function createAutonomyService({ repository, coordinator, hive, bots, health, events, logger, enabled, intervalMs, maxActionsPerHour }) {
  if (!repository || !coordinator || !hive || !bots || !health) throw new ValidationError('Autonomy dependencies are required');
  if (!Number.isInteger(intervalMs) || intervalMs < 5000) throw new ValidationError('Autonomy interval must be at least 5000ms');
  if (!Number.isInteger(maxActionsPerHour) || maxActionsPerHour < 1) throw new ValidationError('Autonomy action budget must be positive');
  let active = Boolean(enabled); let timer = null; let currentIntervalMs = intervalMs; let currentMaxActionsPerHour = maxActionsPerHour; const executions = [];
  const createObjective = async input => { const text = String(input.text ?? '').trim(); const action = text.toLowerCase().split(/\s+/)[0]; if (!SAFE_ACTIONS.has(action)) throw new ValidationError(`Autonomy only permits: ${[...SAFE_ACTIONS].join(', ')}`); const now = new Date().toISOString(); return repository.create({ id: randomUUID(), text, selector: input.selector ?? 'auto', priority: Math.max(1, Math.min(100, Number(input.priority ?? 50))), status: 'ACTIVE', runs: 0, successes: 0, failures: 0, cooldownMs: Math.max(currentIntervalMs, Number(input.cooldownMs ?? currentIntervalMs)), nextRunAt: now, createdAt: now, updatedAt: now, lastResult: null }); };
  const tick = async () => {
    if (!active) return { status: 'DISABLED' }; hive.syncMembers(bots.list()); const healthState = await health.check(); if (healthState.status === 'UNHEALTHY') return { status: 'PAUSED', reason: 'critical health check failed' };
    const cutoff = Date.now() - 3_600_000; while (executions.length && executions[0] < cutoff) executions.shift(); if (executions.length >= currentMaxActionsPerHour) return { status: 'PAUSED', reason: 'hourly action budget exhausted' };
    const objectives = (await repository.list()).filter(item => item.status === 'ACTIVE' && Date.parse(item.nextRunAt) <= Date.now()).sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt)); if (!objectives.length) return { status: 'IDLE' };
    const objective = objectives[0]; const owner = `autonomy:${process.pid}`; const lock = await hive.acquireLock({ key: `objective:${objective.id}`, owner, ttlMs: Math.max(30_000, currentIntervalMs) }); if (!lock) return { status: 'LOCKED', objectiveId: objective.id };
    const started = performance.now(); try { const decision = await hive.propose({ type: 'autonomy', intent: objective.text.split(/\s+/)[0], objectiveId: objective.id, threshold: 0.35 }); if (!decision.approved) throw new ConflictError(`HiveMind rejected autonomous objective '${objective.id}'`); executions.push(Date.now()); const result = await coordinator.coordinate({ text: objective.text, selector: objective.selector, actor: 'autonomy' }); const failures = result.results.filter(item => item.status !== 'COMPLETED').length; const updated = await repository.update(objective.id, { runs: objective.runs + 1, successes: objective.successes + (failures ? 0 : 1), failures: objective.failures + (failures ? 1 : 0), nextRunAt: new Date(Date.now() + objective.cooldownMs).toISOString(), updatedAt: new Date().toISOString(), lastResult: result }); await events?.publish('autonomy.objective.executed', { objectiveId: objective.id, failures, durationMs: performance.now() - started }, { source: 'autonomy' }); return { status: failures ? 'FAILED' : 'COMPLETED', objective: updated }; }
    finally { await hive.releaseLock(`objective:${objective.id}`, owner); }
  };
  const start = () => { if (timer) return; timer = setInterval(() => tick().catch(error => logger.error('autonomy.tick.failed', { error: error.message })), currentIntervalMs); timer.unref?.(); };
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const setEnabled = value => { active = Boolean(value); return status(); };
  const configure = input => { const nextInterval = Number(input.intervalMs); const nextBudget = Number(input.maxActionsPerHour); if (!Number.isInteger(nextInterval) || nextInterval < 5000) throw new ValidationError('Autonomy interval must be at least 5000ms'); if (!Number.isInteger(nextBudget) || nextBudget < 1 || nextBudget > 1000) throw new ValidationError('Autonomy hourly budget must be between 1 and 1000'); active = Boolean(input.enabled); const restart = Boolean(timer) && nextInterval !== currentIntervalMs; currentIntervalMs = nextInterval; currentMaxActionsPerHour = nextBudget; if (restart) { stop(); start(); } return status(); };
  const status = () => ({ status: active ? 'ACTIVE' : 'DISABLED', intervalMs: currentIntervalMs, maxActionsPerHour: currentMaxActionsPerHour, actionsLastHour: executions.length, safeActions: [...SAFE_ACTIONS] });
  return Object.freeze({ createObjective, objectives: () => repository.list(), removeObjective: id => repository.delete(id), tick, start, stop, setEnabled, configure, status });
}
