export function createCoordinationMonitor({ help, events, intervalMs }) {
  let timer = null; let running = false;
  const evaluate = async input => help.rebalanceSession({ ...input, reason: input.reason ?? 'MONITOR' });
  const tick = async () => { if (running) return; running = true; try { const sessions = await help.list(); await Promise.all(sessions.filter(session => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(session.status)).map(session => evaluate({ sessionId: session.id, reason: 'MONITOR' }))); } finally { running = false; } };
  const start = () => { if (timer) return; timer = setInterval(() => { void tick(); }, intervalMs); };
  const stop = () => { if (!timer) return; clearInterval(timer); timer = null; };
  const unsubscribe = events?.subscribe('help.worker.progress', event => { void evaluate({ sessionId: event.payload.sessionId, reason: 'PROGRESS' }).then(() => undefined, error => events?.publish('help.rebalance.failed', { sessionId: event.payload.sessionId, error: { code: error.code ?? 'HELP_REBALANCE_FAILED', message: error.message } }, { source: 'coordination-monitor' })); });
  return Object.freeze({ start, stop, tick, status: () => ({ status: 'HEALTHY', running, intervalMs, active: Boolean(timer) }), dispose: () => { stop(); unsubscribe?.(); } });
}
