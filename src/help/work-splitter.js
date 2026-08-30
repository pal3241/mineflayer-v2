import { ValidationError } from '../core/errors.js';

export function splitWork(remaining, workerBotIds) {
  if (!Number.isInteger(remaining) || remaining < 1) throw new ValidationError('Remaining work must be a positive integer');
  if (!Array.isArray(workerBotIds) || !workerBotIds.length) throw new ValidationError('At least one help worker is required');
  const ids = workerBotIds.map(value => String(value).trim());
  if (ids.some(value => !value) || new Set(ids).size !== ids.length) throw new ValidationError('Help workers must be unique non-empty bot ids');
  const count = Math.min(remaining, ids.length); const base = Math.floor(remaining / count); const remainder = remaining % count;
  return ids.slice(0, count).map((botId, index) => Object.freeze({ botId, assigned: base + (index < remainder ? 1 : 0) }));
}
