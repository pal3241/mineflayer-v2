import { ValidationError } from '../../core/errors.js';
import { nonNegativeInteger, positiveInteger, requiredRecord, strictBoolean } from './recovery-schema.js';

export function createDespawnBudget(input) {
  const source = requiredRecord(input, 'Despawn budget input');
  const budgetTicks = positiveInteger(source.budgetTicks, 'Despawn budgetTicks');
  const safetyMarginTicks = nonNegativeInteger(source.safetyMarginTicks, 'Despawn safetyMarginTicks');
  if (safetyMarginTicks >= budgetTicks) throw new ValidationError('Despawn safetyMarginTicks must be lower than budgetTicks', { safetyMarginTicks, budgetTicks });
  const estimatedLoadedTicks = source.estimatedLoadedTicks === undefined
    ? 0
    : nonNegativeInteger(source.estimatedLoadedTicks, 'Despawn estimatedLoadedTicks');
  const chunkActive = strictBoolean(source.chunkActive, 'Despawn chunkActive');
  return buildBudget({ budgetTicks, safetyMarginTicks, estimatedLoadedTicks: Math.min(estimatedLoadedTicks, budgetTicks), chunkActive });
}

export function advanceDespawnBudget(input) {
  const source = requiredRecord(input, 'Despawn budget advance input');
  const budget = normalizeDespawnBudget(source.budget);
  const loadedTicksElapsed = nonNegativeInteger(source.loadedTicksElapsed, 'Despawn loadedTicksElapsed');
  const chunkActive = strictBoolean(source.chunkActive, 'Despawn chunkActive');
  const additionalLoadedTicks = chunkActive ? loadedTicksElapsed : 0;
  return buildBudget({
    budgetTicks: budget.budgetTicks,
    safetyMarginTicks: budget.safetyMarginTicks,
    estimatedLoadedTicks: Math.min(budget.budgetTicks, budget.estimatedLoadedTicks + additionalLoadedTicks),
    chunkActive
  });
}

export function normalizeDespawnBudget(input) {
  const source = requiredRecord(input, 'Despawn budget');
  return createDespawnBudget({
    budgetTicks: source.budgetTicks,
    safetyMarginTicks: source.safetyMarginTicks,
    estimatedLoadedTicks: source.estimatedLoadedTicks,
    chunkActive: source.chunkActive
  });
}

export function sortRecoveryJobsByUrgency(input) {
  if (!Array.isArray(input)) throw new ValidationError('Recovery jobs must be an array');
  const jobs = input.map((job, index) => {
    const source = requiredRecord(job, `Recovery jobs[${index}]`);
    const id = typeof source.id === 'string' && source.id.trim() ? source.id : (() => { throw new ValidationError(`Recovery jobs[${index}].id must be a non-empty string`); })();
    const despawn = normalizeDespawnBudget(source.despawn);
    const recoveryScore = typeof source.recoveryScore === 'number' && Number.isFinite(source.recoveryScore) ? source.recoveryScore : 0;
    return { source: structuredClone(source), id, despawn, recoveryScore };
  });
  return Object.freeze(jobs.sort(compareUrgency).map(entry => Object.freeze(entry.source)));
}

function buildBudget(input) {
  const remainingTicks = Math.max(0, input.budgetTicks - input.estimatedLoadedTicks);
  const urgencyPercent = Math.round((1 - (remainingTicks / input.budgetTicks)) * 10_000) / 100;
  const status = remainingTicks === 0
    ? 'EXPIRED'
    : !input.chunkActive ? 'TIMER_PAUSED_ESTIMATED'
      : remainingTicks <= input.safetyMarginTicks ? 'URGENT'
        : 'ACTIVE';
  return Object.freeze({
    budgetTicks: input.budgetTicks,
    safetyMarginTicks: input.safetyMarginTicks,
    estimatedLoadedTicks: input.estimatedLoadedTicks,
    remainingTicks,
    chunkActive: input.chunkActive,
    status,
    urgencyPercent
  });
}

function compareUrgency(left, right) {
  const statusRank = { URGENT: 0, ACTIVE: 1, TIMER_PAUSED_ESTIMATED: 2, EXPIRED: 3 };
  if (statusRank[left.despawn.status] !== statusRank[right.despawn.status]) return statusRank[left.despawn.status] - statusRank[right.despawn.status];
  if (left.despawn.remainingTicks !== right.despawn.remainingTicks) return left.despawn.remainingTicks - right.despawn.remainingTicks;
  if (left.recoveryScore !== right.recoveryScore) return right.recoveryScore - left.recoveryScore;
  return left.id.localeCompare(right.id);
}
