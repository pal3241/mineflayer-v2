import { NavigationError } from './navigation-error.js';

export function createMovementMonitor({ session, runtime, target, policy, onSnapshot, onStuck }) {
  const startedAt = Date.now(); let previous = position(runtime); let bestDistance = distance(previous, target); let lastMeaningfulProgressAt = startedAt; let confirmations = 0; let stopped = false;
  const interval = setInterval(() => {
    if (stopped) return; const current = position(runtime); const currentDistance = distance(current, target); const positionDelta = distance(previous, current); const distanceProgress = bestDistance - currentDistance; const meaningful = positionDelta >= policy.meaningfulPositionDelta || distanceProgress >= policy.meaningfulDistanceProgress;
    if (meaningful) { lastMeaningfulProgressAt = Date.now(); confirmations = 0; bestDistance = Math.min(bestDistance, currentDistance); }
    const snapshot = { sessionId: session.id, botId: session.botId, position: current, velocity: null, targetPosition: { ...target }, distanceToTarget: currentDistance, positionDelta, distanceProgress, currentAction: 'MOVING', pathState: 'ACTIVE', lastMeaningfulProgressAt: new Date(lastMeaningfulProgressAt).toISOString(), timestamp: new Date().toISOString() };
    void onSnapshot(snapshot);
    if (currentDistance > session.policy.tolerance && Date.now() - lastMeaningfulProgressAt >= policy.stuckTimeoutMs) { confirmations++; if (confirmations >= policy.confirmationSamples) { stopped = true; void onStuck(new NavigationError('NAVIGATION_STUCK', `Navigation '${session.id}' made no meaningful progress`, { sessionId: session.id, botId: session.botId, noProgressMs: Date.now() - lastMeaningfulProgressAt, confirmations })); } }
    previous = current;
  }, policy.sampleIntervalMs); interval.unref?.();
  return Object.freeze({ stop: () => { stopped = true; clearInterval(interval); }, diagnostics: () => ({ startedAt: new Date(startedAt).toISOString(), lastMeaningfulProgressAt: new Date(lastMeaningfulProgressAt).toISOString(), confirmations, bestDistance }) });
}

function position(runtime) { const value = runtime.adapter?.snapshot?.().position ?? runtime.snapshot?.().runtime?.position; if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) throw new NavigationError('TARGET_UNAVAILABLE', 'Navigation bot has no runtime position', {}); return { x: Number(value.x), y: Number(value.y), z: Number(value.z) }; }
function distance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z); }
