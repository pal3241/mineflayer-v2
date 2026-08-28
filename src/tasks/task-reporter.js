import { ValidationError } from '../core/errors.js';

export function createTaskReporter({ events, bots, logger }) {
  if (!events || !bots || !logger) throw new ValidationError('Task reporter dependencies are required'); const unsubscribers = [];
  const report = async (botId, message, context) => { const bot = bots.list().find(candidate => candidate.id === botId); if (!bot || !['READY', 'ACTIVE', 'PAUSED'].includes(bot.status)) { logger.warn('task.report.skipped', { botId, message, reason: bot ? `bot is ${bot.status}` : 'bot no longer exists', ...context }); return; } try { await bots.get(botId).adapter.chat(`[MineHive] ${message}`); } catch (error) { logger.warn('task.report.failed', { botId, message, error: error.message, ...context }); } };
  const taskMessage = (event, state) => { const task = event.payload; if (task.reportLifecycle === false) return; return report(task.assignedBot, `${state}: ${task.type} [${task.id.slice(0, 8)}]`, { taskId: task.id, goalId: task.goalId, state }); };
  unsubscribers.push(events.subscribe('task.started', event => taskMessage(event, 'task baru'))); unsubscribers.push(events.subscribe('task.completed', event => taskMessage(event, 'task selesai'))); unsubscribers.push(events.subscribe('task.failed', event => taskMessage(event, 'task gagal'))); unsubscribers.push(events.subscribe('task.cancelled', event => taskMessage(event, 'task dibatalkan')));
  unsubscribers.push(events.subscribe('coordinator.bot.started', event => report(event.payload.botId, `task baru: ${event.payload.intent}`, { intent: event.payload.intent, state: 'started' }))); unsubscribers.push(events.subscribe('coordinator.bot.completed', event => report(event.payload.botId, `task selesai: ${event.payload.intent}`, { intent: event.payload.intent, state: 'completed' }))); unsubscribers.push(events.subscribe('coordinator.bot.failed', event => report(event.payload.botId, `task gagal: ${event.payload.intent} - ${event.payload.error}`, { intent: event.payload.intent, state: 'failed' })));
  const stop = () => { for (const unsubscribe of unsubscribers) unsubscribe(); unsubscribers.length = 0; };
  return Object.freeze({ stop });
}
