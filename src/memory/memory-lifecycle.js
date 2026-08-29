import { ValidationError } from '../core/errors.js';

export function createMemoryLifecycle({ memory, logger, intervalMs }) {
  if (!memory || typeof memory.consolidate !== 'function') throw new ValidationError('Memory lifecycle requires a consolidating memory service');
  if (!logger) throw new ValidationError('Memory lifecycle logger is required');
  if (!Number.isInteger(intervalMs) || intervalMs < 5000) throw new ValidationError('Memory consolidation interval must be at least 5000ms');
  let configuredIntervalMs = intervalMs; let timer = null; let running = false; let generation = 0; let runs = 0; let promoted = 0; let forgotten = 0; let lastRunAt = null; let lastError = null;
  const tick = async () => { if (running) return { status: 'BUSY' }; running = true; try { const result = await memory.consolidate(); runs++; promoted += result.promoted; forgotten += result.forgotten; lastRunAt = result.consolidatedAt; lastError = null; return { status: 'COMPLETED', ...result }; } catch (error) { lastError = error.message; throw error; } finally { running = false; } };
  const schedule = currentGeneration => { timer = setTimeout(async () => { try { await tick(); } catch (error) { logger.error('memory.consolidation.failed', { error: error.message }); } finally { if (generation === currentGeneration) schedule(currentGeneration); } }, configuredIntervalMs); timer.unref?.(); };
  const start = () => { if (timer) return; const currentGeneration = ++generation; schedule(currentGeneration); };
  const stop = () => { generation++; if (timer) clearTimeout(timer); timer = null; };
  const configure = input => { if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Memory lifecycle settings must be an object'); const nextInterval = Number(input.intervalMs); if (!Number.isInteger(nextInterval) || nextInterval < 5000) throw new ValidationError('Memory consolidation interval must be an integer of at least 5000ms'); const active = timer !== null; if (active) stop(); configuredIntervalMs = nextInterval; if (active) start(); return status(); };
  const status = () => ({ status: lastError ? 'DEGRADED' : 'HEALTHY', running, intervalMs: configuredIntervalMs, runs, promoted, forgotten, lastRunAt, lastError });
  return Object.freeze({ tick, start, stop, status, configure });
}
