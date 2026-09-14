import { createHash, randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

const AIR = new Set(['air', 'cave_air', 'void_air']);
const ATTACHED = /(?:torch|button|lever|ladder|vine|sign|banner|rail|tripwire_hook|wall_)/;
const FALLING = /(?:^|_)(sand|gravel|anvil|concrete_powder)$/;

export function importBlueprint(input, limits = {}) {
  const source = decode(input); const name = text(input?.name ?? source.name, 'Blueprint name', 80);
  const blocks = normalizeBlocks(source.blocks, limits.maxBlocks ?? 100000);
  if (!blocks.length) throw new ValidationError('Blueprint must contain at least one non-air block');
  const bounds = boundsFor(blocks); const maxDimension = integer(limits.maxDimension ?? 256, 'maxDimension', 1, 2048);
  if (Math.max(...Object.values(bounds.size)) > maxDimension) throw new ValidationError(`Blueprint exceeds maximum dimension of ${maxDimension}`);
  const byKey = new Map(blocks.map(block => [block.key, block]));
  for (const block of blocks) block.dependencies = dependencies(block, byKey);
  const blueprint = { id: randomUUID(), schemaVersion: 1, name, format: format(input?.format ?? source.format), sourceFile: input?.fileName ?? null, origin: position(source.origin ?? { x: 0, y: 0, z: 0 }, 'origin'), bounds, blocks, materials: materialsFor(blocks), metadata: object(source.metadata ?? {}, 'metadata'), createdAt: new Date().toISOString() };
  blueprint.checksum = createHash('sha256').update(JSON.stringify({ origin: blueprint.origin, blocks })).digest('hex'); return blueprint;
}

export function blueprintPreview(blueprint, layer) {
  const y = integer(layer ?? blueprint.bounds.min.y, 'layer', blueprint.bounds.min.y, blueprint.bounds.max.y);
  return { blueprintId: blueprint.id, revision: blueprint.revision ?? 0, layer: y, layers: { min: blueprint.bounds.min.y, max: blueprint.bounds.max.y }, bounds: blueprint.bounds, blocks: blueprint.blocks.filter(block => block.y === y).map(({ key, x, y: blockY, z, name, properties }) => ({ key, x, y: blockY, z, name, properties })) };
}

export function materialsFor(blocks) { const counts = new Map(); for (const block of blocks) counts.set(block.name, (counts.get(block.name) ?? 0) + 1); return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count })); }

function decode(input) { if (!input || typeof input !== 'object') throw new ValidationError('Blueprint import must be an object'); if (input.blueprint && typeof input.blueprint === 'object') return input.blueprint; if (!input.content) return input; try { return JSON.parse(input.encoding === 'base64' ? Buffer.from(input.content, 'base64').toString('utf8') : input.content); } catch { throw new ValidationError('Blueprint content must be MineHive JSON. Binary .schem/.litematic needs a decoder adapter.'); } }
function normalizeBlocks(value, max) { if (!Array.isArray(value)) throw new ValidationError('Blueprint blocks must be an array'); if (value.length > max) throw new ValidationError(`Blueprint exceeds maximum block count of ${max}`); const seen = new Set(); return value.flatMap((raw, index) => { const point = position(raw, `block ${index}`); const name = text(raw?.name ?? raw?.block, `block ${index} name`, 128).toLowerCase().replace(/^minecraft:/, ''); if (AIR.has(name)) return []; const key = `${point.x},${point.y},${point.z}`; if (seen.has(key)) throw new ValidationError(`Duplicate blueprint block at ${key}`); seen.add(key); return [{ key, ...point, name, properties: object(raw.properties ?? raw.state ?? {}, 'block properties'), blockEntity: raw.blockEntity ? object(raw.blockEntity, 'block entity') : null }]; }).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x); }
function dependencies(block, byKey) { const below = `${block.x},${block.y - 1},${block.z}`; if (FALLING.test(block.name) || !ATTACHED.test(block.name)) return byKey.has(below) ? [below] : []; for (const key of [`${block.x - 1},${block.y},${block.z}`, `${block.x + 1},${block.y},${block.z}`, `${block.x},${block.y},${block.z - 1}`, `${block.x},${block.y},${block.z + 1}`, below]) if (byKey.has(key)) return [key]; return []; }
function boundsFor(blocks) { const axis = axisName => blocks.map(item => item[axisName]); const min = { x: Math.min(...axis('x')), y: Math.min(...axis('y')), z: Math.min(...axis('z')) }; const max = { x: Math.max(...axis('x')), y: Math.max(...axis('y')), z: Math.max(...axis('z')) }; return { min, max, size: { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 } }; }
function position(value, label) { return Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, integer(value?.[axis], `${label}.${axis}`, -30000000, 30000000)])); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${label} must be an object`); return structuredClone(value); }
function format(value = 'minehive-json') { const result = String(value).toLowerCase(); if (!['minehive-json', 'schem', 'litematic'].includes(result)) throw new ValidationError(`Unsupported blueprint format '${result}'`); return result; }
function text(value, label, max) { const result = String(value ?? '').trim(); if (!result || result.length > max) throw new ValidationError(`${label} is required and must be at most ${max} characters`); return result; }
function integer(value, label, min, max) { const result = Number(value); if (!Number.isInteger(result) || result < min || result > max) throw new ValidationError(`${label} must be an integer from ${min} to ${max}`); return result; }
