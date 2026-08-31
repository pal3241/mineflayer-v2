import { ValidationError } from '../core/errors.js';
import { scoreHelper } from './helper-scorer.js';

export function splitWeightedWork({ remaining, workerStates }) {
  if (!Number.isInteger(remaining) || remaining < 1) throw new ValidationError('Remaining work must be a positive integer');
  const scored = workerStates.map(state => ({ state, score: scoreHelper(state) })).filter(entry => entry.score.eligible).sort((left, right) => right.score.score - left.score.score || left.state.botId.localeCompare(right.state.botId));
  if (!scored.length) throw new ValidationError('HELP_CAPACITY_INSUFFICIENT no eligible workers are available');
  const capacity = scored.reduce((total, entry) => total + capacityUnits(entry.state), 0); const allocatable = Math.min(remaining, capacity); const totalWeight = scored.reduce((total, entry) => total + Math.max(1, entry.score.score), 0);
  const allocations = scored.map(entry => ({ botId: entry.state.botId, assigned: Math.min(capacityUnits(entry.state), Math.floor((allocatable * Math.max(1, entry.score.score)) / totalWeight)), score: entry.score }));
  let assigned = allocations.reduce((total, entry) => total + entry.assigned, 0); let cursor = 0;
  while (assigned < allocatable) { const entry = allocations[cursor % allocations.length]; if (entry.assigned < workerCapacity(scored, entry.botId)) { entry.assigned++; assigned++; } cursor++; }
  return Object.freeze(allocations.filter(entry => entry.assigned > 0).map(entry => Object.freeze({ botId: entry.botId, assigned: entry.assigned, score: entry.score })));
}

function workerCapacity(scored, botId) { return capacityUnits(scored.find(entry => entry.state.botId === botId).state); }
function capacityUnits(state) { return Number.isInteger(state.capacityUnits) ? state.capacityUnits : state.inventoryFreeSlots; }
