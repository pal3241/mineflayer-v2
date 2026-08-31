import { randomUUID } from 'node:crypto';
import { NavigationError } from './navigation-error.js';
import { normalizeNavigationPolicy } from './navigation-policy.js';
import { normalizeNavigationTarget } from './navigation-target.js';

const SOURCES = new Set(['CHAT_COMMAND', 'TASK', 'HELPING', 'ACQUISITION', 'LOGISTICS', 'RECOVERY', 'AUTONOMY', 'SYSTEM']);

export function normalizeNavigationRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new NavigationError('INVALID_REQUEST', 'Navigation request must be an object', { input });
  const botId = String(input.botId ?? '').trim(); if (!botId) throw new NavigationError('INVALID_REQUEST', 'Navigation request botId is required', { botId: input.botId }); const source = String(input.source ?? 'SYSTEM').trim().toUpperCase(); if (!SOURCES.has(source)) throw new NavigationError('INVALID_REQUEST', `Unsupported navigation source '${source}'`, { source });
  const policy = normalizeNavigationPolicy({ ...(input.policy ?? {}), mode: input.mode ?? input.policy?.mode, tolerance: input.tolerance ?? input.policy?.tolerance, timeout: input.timeout ?? input.policy?.timeout });
  return Object.freeze({ requestId: `NAVREQ-${randomUUID()}`, botId, target: normalizeNavigationTarget(input.target), policy, source, createdAt: new Date().toISOString(), signal: input.signal ?? null });
}
