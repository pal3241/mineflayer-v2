export function createCoordinationMonitor({ help, events, intervalMs }) {
  let timer = null; let running = false;
  const evaluate = async input => help.rebalanceSession({ ...input, reason: input.reason ?? 'MONITOR' });
  const reportFailure = async (error, session) => { await events?.publish('help.rebalance.failed', { sessionId: session?.id, parentTaskId: session?.parentTaskId, error: { code: error.code ?? 'HELP_REBALANCE_FAILED', message: error.message } }, { source: 'coordination-monitor' }); };
  const tick = async () => { if (running) return; running = true; try { const sessions = await help.list(); for (const session of sessions.filter(entry => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(entry.status))) { try { await help.observeRunningProgress(session.id); const stalled = await help.stalledWorkers(session.id); for (const worker of stalled) await help.recoverStalledWorker({ sessionId: session.id, shareId: worker.shareId, botId: worker.botId }); if (!stalled.length) await evaluate({ sessionId: session.id, reason: 'MONITOR' }); } catch (error) { await reportFailure(error, session); } } } finally { running = false; } };
  const start = () => { if (timer) return; timer = setInterval(() => { void tick().catch(error => { void reportFailure(error); }); }, intervalMs); };
  const stop = () => { if (!timer) return; clearInterval(timer); timer = null; };
  const unsubscribe = events?.subscribe('help.worker.progress', event => { void evaluate({ sessionId: event.payload.sessionId, reason: 'PROGRESS' }).then(() => undefined, error => { void reportFailure(error, { id: event.payload.sessionId }); }); });
  return Object.freeze({ start, stop, tick, status: () => ({ status: 'HEALTHY', running, intervalMs, active: Boolean(timer) }), dispose: () => { stop(); unsubscribe?.(); } });
}
