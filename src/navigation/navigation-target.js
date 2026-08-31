import { NavigationError } from './navigation-error.js';

const TYPES = new Set(['POSITION', 'BOT', 'PLAYER', 'BLOCK', 'ENTITY']);

export function normalizeNavigationTarget(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new NavigationError('INVALID_TARGET', 'Navigation target must be an object', { input });
  const type = String(input.type ?? 'POSITION').trim().toUpperCase(); if (!TYPES.has(type)) throw new NavigationError('INVALID_TARGET', `Unsupported navigation target type '${type}'`, { type });
  if (type === 'POSITION') return positionTarget(input);
  if (type === 'BLOCK') return { type, position: positionTarget(input.position).position };
  if (type === 'BOT') return { type, botId: identifier(input.botId, 'botId') };
  if (type === 'PLAYER') return { type, username: identifier(input.username, 'username') };
  return { type, entityId: identifier(input.entityId, 'entityId') };
}

function positionTarget(input) { const position = { x: coordinate(input.x, 'x'), y: coordinate(input.y, 'y'), z: coordinate(input.z, 'z') }; return { type: 'POSITION', ...position, position }; }
function coordinate(value, name) { const number = Number(value); if (!Number.isFinite(number)) throw new NavigationError('INVALID_TARGET', `Navigation target '${name}' must be a finite number`, { name, value }); return number; }
function identifier(value, name) { const normalized = String(value ?? '').trim(); if (!normalized) throw new NavigationError('INVALID_TARGET', `Navigation target '${name}' is required`, { name }); return normalized; }
