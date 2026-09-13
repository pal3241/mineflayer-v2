import { ValidationError } from '../core/errors.js';

export const TERRITORY_TYPES = Object.freeze(['BASE', 'SAFE', 'RESOURCE', 'INDUSTRIAL', 'DANGER', 'FRONTIER', 'LOGISTICS_ROUTE', 'OUTPOST']);

export function normalizeTerritoryRegion(input, previous = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Territory region must be an object');
  const type = String(input.type ?? previous?.type ?? '').trim().toUpperCase(); const worldKey = normalizeWorldKey(input.worldKey ?? previous?.worldKey); const dimension = String(input.dimension ?? previous?.dimension ?? 'overworld').trim(); const center = normalizePosition(input.center ?? previous?.center); const radius = Number(input.radius ?? previous?.radius); const dangerLevel = Number(input.dangerLevel ?? previous?.dangerLevel ?? 0);
  if (!TERRITORY_TYPES.includes(type)) throw new ValidationError(`Territory type must be one of ${TERRITORY_TYPES.join(', ')}`);
  if (!/^[A-Za-z0-9_:.-]{1,100}$/.test(dimension)) throw new ValidationError('Territory dimension is invalid');
  if (!Number.isFinite(radius) || radius < 1 || radius > 2048) throw new ValidationError('Territory radius must be between 1 and 2048 blocks');
  if (!Number.isFinite(dangerLevel) || dangerLevel < 0 || dangerLevel > 1) throw new ValidationError('Territory dangerLevel must be between 0 and 1');
  const name = String(input.name ?? previous?.name ?? type.toLowerCase().replaceAll('_', ' ')).trim(); if (!/^[A-Za-z0-9_. -]{1,80}$/.test(name)) throw new ValidationError('Territory name must be 1-80 safe characters');
  return { worldKey, dimension, name, type, center, radius, biome: nullableSafe(input.biome ?? previous?.biome, 80, 'biome'), resources: uniqueSafe(input.resources ?? previous?.resources ?? [], 64), dangerLevel, explored: Boolean(input.explored ?? previous?.explored ?? false), metadata: structuredClone(input.metadata ?? previous?.metadata ?? {}) };
}

export function containsPosition(region, position) { const point = normalizePosition(position); return region.worldKey && Math.hypot(point.x - region.center.x, point.y - region.center.y, point.z - region.center.z) <= region.radius; }

function normalizePosition(value) { if (!value || ![value.x, value.y, value.z].every(item => Number.isFinite(Number(item)))) throw new ValidationError('Territory center requires finite x, y, z'); return { x: Number(value.x), y: Number(value.y), z: Number(value.z) }; }
function normalizeWorldKey(value) { const key = String(value ?? '').trim().toLowerCase(); if (!/^[a-z0-9.-]+:[1-9][0-9]{0,4}$/.test(key)) throw new ValidationError('Territory worldKey must use host:port'); const port = Number(key.slice(key.lastIndexOf(':') + 1)); if (port > 65535) throw new ValidationError('Territory worldKey port is invalid'); return key; }
function nullableSafe(value, maximum, field) { if (value === undefined || value === null || value === '') return null; const text = String(value).trim(); if (!text || text.length > maximum || !/^[A-Za-z0-9_: .-]+$/.test(text)) throw new ValidationError(`Territory ${field} is invalid`); return text; }
function uniqueSafe(values, maximum) { if (!Array.isArray(values)) throw new ValidationError('Territory resources must be an array'); const result = [...new Set(values.map(value => String(value).trim().toLowerCase()))]; if (result.length > maximum || result.some(value => !/^[a-z0-9_:.-]{1,80}$/.test(value))) throw new ValidationError('Territory resources contain invalid values'); return result; }
