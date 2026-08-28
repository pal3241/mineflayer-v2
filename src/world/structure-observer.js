import { ValidationError } from '../core/errors.js';

export function createStructureObserver({ discovery, logger, intervalMs, minimumDistance, maxDistance }) {
  if (!discovery) throw new ValidationError('Structure observer requires discovery service');
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) throw new ValidationError('Structure observer interval must be at least 1000ms');
  if (!Number.isFinite(minimumDistance) || minimumDistance < 1) throw new ValidationError('Structure observer minimum distance must be positive');
  if (!Number.isFinite(maxDistance) || maxDistance < 8 || maxDistance > 128) throw new ValidationError('Structure observer range must be between 8 and 128');
  const observers = new Map(); let discoveries = 0; let scans = 0;
  const attach = runtime => {
    if (typeof runtime.adapter.survey !== 'function') return () => {};
    let lastPosition = null; let lastScanAt = 0; let timer = null; let running = null;
    const scan = async reason => {
      const snapshot = runtime.adapter.snapshot(); const position = snapshot.position; if (!position || !['READY', 'ACTIVE', 'PAUSED'].includes(runtime.bot.status)) return null;
      const recentlyScanned = Date.now() - lastScanAt < intervalMs; const moved = lastPosition ? distance(lastPosition, position) : Number.POSITIVE_INFINITY; if (recentlyScanned && moved < minimumDistance) return null;
      if (running) return running;
      running = (async () => { const survey = await runtime.adapter.survey({ maxDistance }); const result = await discovery.record({ runtime, survey, reason }); lastPosition = { x: position.x, y: position.y, z: position.z }; lastScanAt = Date.now(); scans++; discoveries += result.memories.length; return result; })();
      try { return await running; } finally { running = null; }
    };
    const schedule = reason => { clearTimeout(timer); timer = setTimeout(() => scan(reason).catch(error => logger.error('structure.observer.failed', { botId: runtime.bot.id, reason, error: error.message })), 250); timer.unref?.(); };
    const onSpawn = () => schedule('spawn'); const onMove = () => schedule('movement'); const onEnd = () => clearTimeout(timer);
    runtime.adapter.on('spawn', onSpawn); runtime.adapter.on('move', onMove); runtime.adapter.on('end', onEnd);
    const detach = () => { clearTimeout(timer); runtime.adapter.off('spawn', onSpawn); runtime.adapter.off('move', onMove); runtime.adapter.off('end', onEnd); observers.delete(runtime.bot.id); };
    observers.set(runtime.bot.id, detach); return detach;
  };
  const stop = () => { for (const detach of observers.values()) detach(); observers.clear(); };
  const status = () => ({ status: 'HEALTHY', observers: observers.size, scans, discoveries, intervalMs, minimumDistance, maxDistance });
  return Object.freeze({ attach, stop, status });
}

function distance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z); }
