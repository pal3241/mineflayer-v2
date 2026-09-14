import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, inflateSync } from 'node:zlib';
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

function decode(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Blueprint import must be an object');
  if (input.blueprint && typeof input.blueprint === 'object') return input.blueprint;
  if (!input.content) return input;
  const content = input.encoding === 'base64' ? Buffer.from(input.content, 'base64') : Buffer.from(input.content);
  try { return JSON.parse(content.toString('utf8')); }
  catch {
    const requested = String(input.format ?? '').toLowerCase();
    const extension = String(input.fileName ?? '').toLowerCase();
    if (requested === 'schem' || extension.endsWith('.schem') || extension.endsWith('.schematic')) return decodeSpongeSchematic(content);
    if (requested === 'litematic' || extension.endsWith('.litematic')) return decodeLitematic(content);
    throw new ValidationError('Unknown blueprint data. Upload MineHive JSON, .schem, or .litematic.');
  }
}

function decodedNbt(content) {
  let bytes = content;
  try { bytes = gunzipSync(content); } catch { try { bytes = inflateSync(content); } catch {} }
  const reader = new NbtReader(bytes); const type = reader.byte();
  if (type !== 10) throw new ValidationError('Schematic root must be an NBT compound');
  reader.string(); return reader.value(type);
}

function decodeSpongeSchematic(content) {
  const document = decodedNbt(content); const root = document.Schematic ?? document; const width = Number(root.Width); const height = Number(root.Height); const length = Number(root.Length);
  if (![width, height, length].every(value => Number.isInteger(value) && value > 0)) throw new ValidationError('Invalid .schem dimensions');
  // Sponge Schematic v2 stored Palette/BlockData at the root. v3 wraps them in
  // Blocks as Palette/Data (the format emitted by current WorldEdit/FAWE).
  const palette = root.Palette ?? root.Blocks?.Palette; const data = root.BlockData ?? root.Blocks?.Data;
  if (!palette || !Buffer.isBuffer(data)) throw new ValidationError('Unsupported .schem: Palette and block data are required');
  const names = []; for (const [name, index] of Object.entries(palette)) names[Number(index)] = name;
  const ids = readVarInts(data, width * height * length); const blocks = [];
  for (let index = 0; index < ids.length; index++) { const state = blockStateFromName(names[ids[index]]); if (!state || AIR.has(state.name)) continue; const x = index % width; const z = Math.floor(index / width) % length; const y = Math.floor(index / (width * length)); blocks.push({ x, y, z, ...state }); }
  return { name: root.Metadata?.Name ?? 'Imported schematic', format: 'schem', origin: { x: 0, y: 0, z: 0 }, blocks, metadata: { sourceFormat: 'sponge-schem', version: root.Version ?? null } };
}

function decodeLitematic(content) {
  const root = decodedNbt(content); const regions = root.Regions;
  if (!regions || typeof regions !== 'object') throw new ValidationError('Unsupported .litematic: Regions are required');
  const blocks = [];
  for (const region of Object.values(regions)) {
    const size = region.Size ?? {}; const width = Math.abs(Number(size.x)); const height = Math.abs(Number(size.y)); const length = Math.abs(Number(size.z));
    const palette = region.BlockStatePalette; const packed = region.BlockStates;
    if (![width, height, length].every(value => Number.isInteger(value) && value > 0) || !Array.isArray(palette) || !Array.isArray(packed)) continue;
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, palette.length)))); const origin = region.Position ?? { x: 0, y: 0, z: 0 }; const total = width * height * length;
    for (let index = 0; index < total; index++) { const paletteIndex = packedIndex(packed, index, bits); const state = palette[paletteIndex]; const name = state?.Name; if (!name || AIR.has(String(name).replace(/^minecraft:/, ''))) continue; const x = index % width; const y = Math.floor(index / width) % height; const z = Math.floor(index / (width * height)); blocks.push({ x: Number(origin.x) + x, y: Number(origin.y) + y, z: Number(origin.z) + z, name, properties: state.Properties ?? {} }); }
  }
  if (!blocks.length) throw new ValidationError('The .litematic contained no supported non-air blocks');
  return { name: root.Metadata?.Name ?? 'Imported litematic', format: 'litematic', origin: { x: 0, y: 0, z: 0 }, blocks, metadata: { sourceFormat: 'litematic', regions: Object.keys(regions).length } };
}

function readVarInts(data, count) { const values = []; let index = 0; while (index < data.length && values.length < count) { let value = 0; let shift = 0; let current; do { if (index >= data.length || shift > 35) throw new ValidationError('Invalid .schem BlockData varint'); current = data[index++]; value |= (current & 127) << shift; shift += 7; } while (current & 128); values.push(value >>> 0); } if (values.length !== count) throw new ValidationError('Incomplete .schem BlockData'); return values; }
function blockStateFromName(value) { const text = String(value ?? '').trim().replace(/^minecraft:/, ''); if (!text) return null; const match = /^([^\[]+)(?:\[([^\]]*)\])?$/.exec(text); if (!match) return { name: text, properties: {} }; const properties = Object.fromEntries((match[2] ?? '').split(',').filter(Boolean).map(item => { const [key, ...rest] = item.split('='); return [key, rest.join('=')]; })); return { name: match[1], properties }; }
function packedIndex(values, index, bits) { const start = BigInt(index * bits); const word = Number(start >> 6n); const offset = Number(start & 63n); const first = BigInt.asUintN(64, BigInt(values[word] ?? 0)); const second = BigInt.asUintN(64, BigInt(values[word + 1] ?? 0)); return Number(((first >> BigInt(offset)) | (second << BigInt(64 - offset))) & ((1n << BigInt(bits)) - 1n)); }

class NbtReader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0; }
  byte() { if (this.offset >= this.bytes.length) throw new ValidationError('Truncated NBT data'); return this.bytes.readInt8(this.offset++); }
  unsignedByte() { return this.byte() & 255; }
  short() { const value = this.bytes.readInt16BE(this.offset); this.offset += 2; return value; }
  int() { const value = this.bytes.readInt32BE(this.offset); this.offset += 4; return value; }
  long() { const value = this.bytes.readBigInt64BE(this.offset); this.offset += 8; return value; }
  string() { const length = this.bytes.readUInt16BE(this.offset); this.offset += 2; const value = this.bytes.subarray(this.offset, this.offset + length).toString('utf8'); this.offset += length; return value; }
  value(type) { if (type === 1) return this.byte(); if (type === 2) return this.short(); if (type === 3) return this.int(); if (type === 4) return this.long(); if (type === 5) { const value = this.bytes.readFloatBE(this.offset); this.offset += 4; return value; } if (type === 6) { const value = this.bytes.readDoubleBE(this.offset); this.offset += 8; return value; } if (type === 7) { const length = this.int(); const value = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return value; } if (type === 8) return this.string(); if (type === 9) { const itemType = this.unsignedByte(); const length = this.int(); return Array.from({ length }, () => this.value(itemType)); } if (type === 10) { const value = {}; for (;;) { const child = this.unsignedByte(); if (!child) return value; value[this.string()] = this.value(child); } } if (type === 11) { const length = this.int(); return Array.from({ length }, () => this.int()); } if (type === 12) { const length = this.int(); return Array.from({ length }, () => this.long()); } throw new ValidationError(`Unsupported NBT tag ${type}`); }
}
function normalizeBlocks(value, max) { if (!Array.isArray(value)) throw new ValidationError('Blueprint blocks must be an array'); if (value.length > max) throw new ValidationError(`Blueprint exceeds maximum block count of ${max}`); const seen = new Set(); return value.flatMap((raw, index) => { const point = position(raw, `block ${index}`); const name = text(raw?.name ?? raw?.block, `block ${index} name`, 128).toLowerCase().replace(/^minecraft:/, ''); if (AIR.has(name)) return []; const key = `${point.x},${point.y},${point.z}`; if (seen.has(key)) throw new ValidationError(`Duplicate blueprint block at ${key}`); seen.add(key); return [{ key, ...point, name, properties: object(raw.properties ?? raw.state ?? {}, 'block properties'), blockEntity: raw.blockEntity ? object(raw.blockEntity, 'block entity') : null }]; }).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x); }
function dependencies(block, byKey) { const below = `${block.x},${block.y - 1},${block.z}`; if (FALLING.test(block.name) || !ATTACHED.test(block.name)) return byKey.has(below) ? [below] : []; for (const key of [`${block.x - 1},${block.y},${block.z}`, `${block.x + 1},${block.y},${block.z}`, `${block.x},${block.y},${block.z - 1}`, `${block.x},${block.y},${block.z + 1}`, below]) if (byKey.has(key)) return [key]; return []; }
function boundsFor(blocks) { const axis = axisName => blocks.map(item => item[axisName]); const min = { x: Math.min(...axis('x')), y: Math.min(...axis('y')), z: Math.min(...axis('z')) }; const max = { x: Math.max(...axis('x')), y: Math.max(...axis('y')), z: Math.max(...axis('z')) }; return { min, max, size: { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 } }; }
function position(value, label) { return Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, integer(value?.[axis], `${label}.${axis}`, -30000000, 30000000)])); }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${label} must be an object`); return structuredClone(value); }
function format(value = 'minehive-json') { const result = String(value).toLowerCase(); if (!['minehive-json', 'schem', 'litematic'].includes(result)) throw new ValidationError(`Unsupported blueprint format '${result}'`); return result; }
function text(value, label, max) { const result = String(value ?? '').trim(); if (!result || result.length > max) throw new ValidationError(`${label} is required and must be at most ${max} characters`); return result; }
function integer(value, label, min, max) { const result = Number(value); if (!Number.isInteger(result) || result < min || result > max) throw new ValidationError(`${label} must be an integer from ${min} to ${max}`); return result; }
