import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from '../core/errors.js';
import { containsPosition, normalizeTerritoryRegion, TERRITORY_TYPES } from './territory-region.js';

export function createTerritoryService({ repository, events }) {
  if (!repository) throw new ValidationError('Territory service requires a repository');
  const create = async input => { const now = new Date().toISOString(); const region = await repository.create({ id: randomUUID(), ...normalizeTerritoryRegion(input), createdAt: now, updatedAt: now, lastSeen: input.lastSeen ?? now, version: 1 }); await publish('territory.region.created', region); return region; };
  const get = async id => repository.find(String(id));
  const update = async (id, patch) => { const previous = await get(id); const region = await repository.update(previous.id, { ...normalizeTerritoryRegion(patch, previous), updatedAt: new Date().toISOString(), lastSeen: patch.lastSeen ?? previous.lastSeen, version: previous.version + 1 }); await publish('territory.region.updated', region); return region; };
  const remove = async id => { const previous = await get(id); await repository.delete(previous.id); await publish('territory.region.removed', previous); return { removed: true, id: previous.id }; };
  const list = async (query = {}) => { const type = query.type ? String(query.type).toUpperCase() : null; if (type && !TERRITORY_TYPES.includes(type)) throw new ValidationError('Territory query type is invalid'); return (await repository.list()).filter(region => (!query.worldKey || region.worldKey === String(query.worldKey).toLowerCase()) && (!query.dimension || region.dimension === query.dimension) && (!type || region.type === type)).sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name)); };
  const at = async query => { if (!query?.worldKey || !query?.dimension) throw new ValidationError('Territory position query requires worldKey and dimension'); return (await list(query)).filter(region => containsPosition(region, query.position)).sort((left, right) => left.radius - right.radius || right.dangerLevel - left.dangerLevel); };
  const map = async query => { const regions = await list(query); const counts = Object.fromEntries(TERRITORY_TYPES.map(type => [type, regions.filter(region => region.type === type).length])); return { worldKey: query.worldKey ?? null, dimension: query.dimension ?? null, regionCount: regions.length, exploredRegions: regions.filter(region => region.explored).length, averageDanger: regions.length ? regions.reduce((sum, region) => sum + region.dangerLevel, 0) / regions.length : 0, counts, regions }; };
  const status = async () => { const regions = await repository.list(); return { status: 'HEALTHY', regions: regions.length, dangerRegions: regions.filter(region => region.type === 'DANGER').length, frontierRegions: regions.filter(region => region.type === 'FRONTIER').length }; };
  const publish = (type, payload) => events?.publish(type, payload, { source: 'territory', correlationId: payload.id });
  return Object.freeze({ create, get, update, remove, list, at, map, status });
}
