import { ValidationError } from '../core/errors.js';

/**
 * Connects real task lifecycle events to the adaptive task-success model.
 * This records observations only; model training remains explicit and is never
 * triggered by startup or by an individual task event.
 */
export function createOutcomeFeedback({ events, ml, logger = null }) {
  if (!events?.subscribe || typeof ml?.recordOutcome !== 'function') {
    throw new ValidationError('Outcome feedback requires an event bus and adaptive model');
  }

  let disposed = false;
  let queue = Promise.resolve();
  let pending = 0;
  const seen = new Set();
  const unsubscribe = [];

  const enqueue = operation => {
    pending++;
    const next = queue.then(operation);
    queue = next.then(() => { pending--; }, error => {
      pending--;
      logger?.warn?.('ml.outcome-feedback.failed', { error: error.message });
    });
    return next;
  };

  const record = (event, success) => enqueue(async () => {
    if (disposed) return null;
    const task = event.payload ?? {};
    if (!task.id) {
      logger?.warn?.('ml.outcome-feedback.missing-task-id', { success });
      return null;
    }
    const key = String(task.id);
    if (seen.has(key)) return null;
    seen.add(key);

    const botId = task.assignedBot ?? task.botId ?? task.input?.botId;
    if (!botId) {
      seen.delete(key);
      logger?.warn?.('ml.outcome-feedback.missing-bot-id', { taskId: key });
      return null;
    }

    const features = task.outcomeFeatures ?? task.features ?? task.input?.features ?? {};
    const createdAt = Date.parse(task.createdAt ?? '');
    const updatedAt = Date.parse(task.updatedAt ?? '');
    const durationMs = Number.isFinite(createdAt) && Number.isFinite(updatedAt)
      ? Math.max(0, updatedAt - createdAt)
      : Math.max(0, Number(task.durationMs) || 0);

    let outcome;
    try {
      outcome = await ml.recordOutcome({
      botId: String(botId),
      intent: normalizeIntent(task.type),
      success,
      durationMs,
      features,
      source: 'task-lifecycle',
      sourceId: key,
      taskId: key,
      goalId: task.goalId ?? null,
      errorCode: success ? null : task.error?.code ?? null
      });
    } catch (error) {
      seen.delete(key);
      throw error;
    }
    await events.publish('learning.task-outcome-recorded', {
      taskId: key,
      botId: String(botId),
      success,
      outcomeId: outcome?.id ?? null
    }, { source: 'outcome-feedback', correlationId: event.correlationId ?? key });
    return outcome;
  });

  unsubscribe.push(events.subscribe('task.completed', event => record(event, true)));
  unsubscribe.push(events.subscribe('task.failed', event => record(event, false)));

  return Object.freeze({
    flush: () => queue,
    status: () => ({ status: disposed ? 'STOPPED' : 'ACTIVE', pending: pending > 0, pendingCount: pending, seenInProcess: seen.size }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of unsubscribe.splice(0)) stop();
    }
  });
}

function normalizeIntent(value) {
  const intent = String(value ?? 'unknown').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 80);
  return intent || 'unknown';
}
