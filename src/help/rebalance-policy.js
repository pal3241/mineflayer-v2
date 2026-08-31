export function normalizeRebalancePolicy(input) {
  const value = input ?? {}; return Object.freeze({ minRebalanceIntervalMs: positive(value.minRebalanceIntervalMs ?? 5000, 'minRebalanceIntervalMs'), minimumTransferUnits: positive(value.minimumTransferUnits ?? 4, 'minimumTransferUnits'), minimumBenefitRatio: ratio(value.minimumBenefitRatio ?? 0.15), maxRebalancesPerSession: positive(value.maxRebalancesPerSession ?? 20, 'maxRebalancesPerSession'), progressStallThresholdMs: positive(value.progressStallThresholdMs ?? 30000, 'progressStallThresholdMs') });
}

export function evaluateRebalance({ session, states, policy, now }) {
  const timestamp = Number(now); const last = Date.parse(session.lastRebalancedAt ?? session.createdAt); const active = states.filter(state => state.available); const unfinished = states.reduce((total, state) => total + state.remaining, 0);
  if (!active.length) return Object.freeze({ decision: 'NO_CHANGE', code: 'HELP_WORKER_UNAVAILABLE' });
  if ((session.rebalanceCount ?? 0) >= policy.maxRebalancesPerSession) return Object.freeze({ decision: 'NO_CHANGE', code: 'HELP_REBALANCE_LIMIT' });
  if (timestamp - last < policy.minRebalanceIntervalMs) return Object.freeze({ decision: 'NO_CHANGE', code: 'HELP_REBALANCE_COOLDOWN' });
  if (unfinished < policy.minimumTransferUnits) return Object.freeze({ decision: 'NO_CHANGE', code: 'HELP_NO_STEALABLE_WORK' });
  const remaining = active.map(state => state.remaining); const maximum = Math.max(...remaining); const minimum = Math.min(...remaining); if (maximum === 0 || (maximum - minimum) / maximum < policy.minimumBenefitRatio) return Object.freeze({ decision: 'NO_CHANGE', code: 'HELP_NO_REBALANCE_BENEFIT' });
  return Object.freeze({ decision: 'REBALANCE', code: 'REBALANCE_READY' });
}

function positive(value, label) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new TypeError(`${label} must be a positive integer`); return number; }
function ratio(value) { const number = Number(value); if (!Number.isFinite(number) || number <= 0 || number > 1) throw new TypeError('minimumBenefitRatio must be greater than 0 and at most 1'); return number; }
