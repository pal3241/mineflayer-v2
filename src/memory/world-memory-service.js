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
    const worldKey = query.host ? worldIdentity(query) : query.worldKey; const name = String(query.name ?? '').toLowerCase(); const type = String(query.type ?? '').toLowerCase(); const near = validPosition(query.near) ? query.near : null;
    return (await this.repository.list()).filter(item => (!worldKey || item.worldKey === worldKey) && (!query.dimension || item.dimension === query.dimension) && (!name || item.name.toLowerCase().includes(name)) && (!type || item.type === type))
      .map(item => ({ ...item, distance: near ? distance(near, item.position) : null })).sort((left, right) => (right.confidence - left.confidence) || ((left.distance ?? 0) - (right.distance ?? 0)) || right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.max(1, Math.min(100, Number(query.limit ?? 20))));
  }
  async forget(id) { return this.repository.delete(id); }
  async forBot(runtime, query = {}) { const snapshot = runtime.adapter.snapshot(); return this.search({ ...query, ...server(runtime.options), dimension: snapshot.dimension, near: snapshot.position }); }
}

function normalize(input) {
  const name = String(input.name ?? '').trim(); const type = String(input.type ?? 'place').trim().toLowerCase(); if (!/^[A-Za-z0-9_. -]{1,80}$/.test(name)) throw new ValidationError('Memory name must be 1-80 safe characters'); if (!/^[a-z0-9_-]{1,32}$/.test(type)) throw new ValidationError('Invalid memory type'); if (!validPosition(input.position)) throw new ValidationError('World memory requires numeric position');
  const connection = server(input); return { worldKey: worldIdentity(connection), server: connection, dimension: String(input.dimension ?? 'overworld'), type, name, position: { x: Number(input.position.x), y: Number(input.position.y), z: Number(input.position.z) }, sourceBotId: input.sourceBotId ?? null, confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 1))), importance: Math.max(0, Math.min(1, Number(input.importance ?? 0.7))), tags: [...new Set((input.tags ?? []).map(String))].slice(0, 20), metadata: input.metadata ?? {} };
}
function server(input = {}) { return { host: String(input.host ?? input.server?.host ?? 'localhost').toLowerCase(), port: Number(input.port ?? input.server?.port ?? 25565) }; }
function worldIdentity(input = {}) { const value = server(input); return `${value.host}:${value.port}`; }
function validPosition(value) { return value && [value.x, value.y, value.z].every(number => Number.isFinite(Number(number))); }
function distance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z); }
