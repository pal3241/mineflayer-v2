import { TaskStatus } from '../tasks/task.js';

export class FleetScheduler {
  constructor({ botManager, weights = {} }) { this.botManager = botManager; this.weights = { capability: 50, availability: 25, reliability: 15, workload: 10, ...weights }; this.assignments = new Map(); this.reliability = new Map(); }
  score(task, bot) {
    const capabilities = new Set(bot.capabilities); const matches = task.requiredCapabilities.filter(item => capabilities.has(item)).length;
    if (matches !== task.requiredCapabilities.length) return -Infinity;
    const runtimeReady = ['READY', 'ACTIVE', 'PAUSED', 'REGISTERED'].includes(bot.status) ? 1 : 0;
    if (!runtimeReady) return -Infinity;
    const reliability = this.reliability.get(bot.id)?.score ?? 1;
    const workload = [...this.assignments.values()].filter(id => id === bot.id).length;
    return this.weights.capability + this.weights.availability + reliability * this.weights.reliability - workload * this.weights.workload;
  }
  assign(task, preferredBot = null) {
    const candidates = this.botManager.list().filter(bot => !preferredBot || bot.id === preferredBot).map(bot => ({ bot, score: this.score(task, bot) })).filter(item => Number.isFinite(item.score)).sort((a, b) => b.score - a.score || a.bot.id.localeCompare(b.bot.id));
    if (!candidates.length) return null;
    task.update(TaskStatus.ASSIGNED, { assignedBot: candidates[0].bot.id }); this.assignments.set(task.id, candidates[0].bot.id); return candidates[0];
  }
  release(task) { this.assignments.delete(task.id); }
  record(botId, success, durationMs) {
    const current = this.reliability.get(botId) ?? { successes: 0, failures: 0, averageDurationMs: 0, score: 1 };
    success ? current.successes++ : current.failures++; const total = current.successes + current.failures;
    current.averageDurationMs = ((current.averageDurationMs * (total - 1)) + durationMs) / total; current.score = (current.successes + 1) / (total + 1);
    this.reliability.set(botId, current);
  }
}
