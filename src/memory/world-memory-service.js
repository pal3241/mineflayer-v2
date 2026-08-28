import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

export class WorldMemoryService {
  constructor({ repository, events, logger }) { this.repository = repository; this.events = events; this.logger = logger; }
  async remember(input) {
    const value = normalize(input); const existing = (await this.repository.list()).find(item => item.worldKey === value.worldKey && item.dimension === value.dimension && item.type === value.type && item.name.toLowerCase() === value.name.toLowerCase());
    const record = existing ? await this.repository.update(existing.id, { ...value, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString(), version: (existing.version ?? 1) + 1 }) : await this.repository.create({ ...value, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 });
    await this.events?.publish('memory.world.remembered', record, { source: 'world-memory' }); return record;
  }
  async search(query = {}) {
    if (query.near !== undefined && !validPosition(query.near)) throw new ValidationError('World memory near position must contain finite x, y, z'); const limit = boundedInteger(query.limit, 1, 100, 20); const worldKey = query.host ? worldIdentity(query) : query.worldKey; const name = String(query.name ?? '').toLowerCase(); const type = String(query.type ?? '').toLowerCase(); const near = query.near ?? null;
    return (await this.repository.list()).filter(item => (!worldKey || item.worldKey === worldKey) && (!query.dimension || item.dimension === query.dimension) && (!name || item.name.toLowerCase().includes(name)) && (!type || item.type === type))
      .map(item => ({ ...item, distance: near ? distance(near, item.position) : null })).sort((left, right) => (right.confidence - left.confidence) || ((left.distance ?? 0) - (right.distance ?? 0)) || right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit);
  }
  async forget(id) { return this.repository.delete(id); }
  async forBot(runtime, query = {}) { const snapshot = runtime.adapter.snapshot(); return this.search({ ...query, ...server(runtime.options), dimension: snapshot.dimension, near: snapshot.position }); }
}

function normalize(input) {
  const name = String(input.name ?? '').trim(); const type = String(input.type ?? 'place').trim().toLowerCase(); if (!/^[A-Za-z0-9_. -]{1,80}$/.test(name)) throw new ValidationError('Memory name must be 1-80 safe characters'); if (!/^[a-z0-9_-]{1,32}$/.test(type)) throw new ValidationError('Invalid memory type'); if (!validPosition(input.position)) throw new ValidationError('World memory requires numeric position');
  const connection = server(input); const dimension = String(input.dimension ?? 'overworld'); if (!/^[A-Za-z0-9_:.-]{1,100}$/.test(dimension)) throw new ValidationError('Invalid world memory dimension'); return { worldKey: worldIdentity(connection), server: connection, dimension, type, name, position: { x: Number(input.position.x), y: Number(input.position.y), z: Number(input.position.z) }, sourceBotId: input.sourceBotId ?? null, confidence: boundedNumber(input.confidence, 0, 1, 1, 'confidence'), importance: boundedNumber(input.importance, 0, 1, 0.7, 'importance'), tags: [...new Set((input.tags ?? []).map(String))].slice(0, 20), metadata: structuredClone(input.metadata ?? {}) };
}
function server(input = {}) { const host = String(input.host ?? input.server?.host ?? 'localhost').trim().toLowerCase(); const port = Number(input.port ?? input.server?.port ?? 25565); if (!host || host.length > 253 || /[\s/\\]/.test(host)) throw new ValidationError('Invalid world memory server host'); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValidationError('Invalid world memory server port'); return { host, port }; }
function worldIdentity(input = {}) { const value = server(input); return `${value.host}:${value.port}`; }
function validPosition(value) { return value && [value.x, value.y, value.z].every(number => Number.isFinite(Number(number))); }
function distance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z); }
function boundedNumber(value, minimum, maximum, fallback, field) { const number = Number(value ?? fallback); if (!Number.isFinite(number)) throw new ValidationError(`World memory ${field} must be finite`); return Math.max(minimum, Math.min(maximum, number)); }
function boundedInteger(value, minimum, maximum, fallback) { const number = Number(value ?? fallback); if (!Number.isInteger(number) || number < minimum || number > maximum) throw new ValidationError(`World memory limit must be an integer between ${minimum} and ${maximum}`); return number; }
