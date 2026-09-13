import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createExplorationService, createTerritoryService } from '../src/territory/index.js';

function setup(options = {}) {
  const events = new EventBus(); const territory = createTerritoryService({ repository: new MemoryRepository(), events }); const states = options.states ?? [{ id: 'worker', status: 'READY', metadata: { className: 'worker' }, runtime: { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld', health: 20, food: 20 } }, { id: 'scout', status: 'READY', metadata: { className: 'scout' }, runtime: { position: { x: 30, y: 64, z: 0 }, dimension: 'overworld', health: 20, food: 20 } }]; const runtimes = Object.fromEntries(states.map(bot => [bot.id, { options: { host: 'localhost', port: 25565 }, adapter: { survey: async () => ({ scannedAt: new Date().toISOString(), discoveries: [] }) } }])); const bots = { list: () => structuredClone(states), get: id => runtimes[id] }; const calls = []; const navigation = options.navigation ?? { moveTo: async input => { calls.push(input); return { status: 'ARRIVED' }; }, cancel: async () => ({}) }; const discovery = options.discovery ?? { record: async () => ({ scannedAt: new Date().toISOString(), memories: [{ id: 'found' }] }) }; const exploration = createExplorationService({ repository: new MemoryRepository(), territory, bots, navigation, discovery, events }); return { territory, exploration, events, calls };
}

test('frontier seeding creates eight asymmetric exploration candidates without duplicates', async () => {
  const { exploration } = setup(); const input = { worldKey: 'localhost:25565', dimension: 'overworld', origin: { x: 0, y: 64, z: 0 }, distance: 128, radius: 24 }; assert.equal((await exploration.seedFrontiers(input)).length, 8); assert.equal((await exploration.seedFrontiers(input)).length, 0);
});

test('exploration planner avoids danger and prefers a specialist scout deterministically', async () => {
  const { territory, exploration } = setup(); await territory.create({ worldKey: 'localhost:25565', dimension: 'overworld', name: 'North', type: 'FRONTIER', center: { x: 0, y: 64, z: -100 }, radius: 24 }); const east = await territory.create({ worldKey: 'localhost:25565', dimension: 'overworld', name: 'East', type: 'FRONTIER', center: { x: 100, y: 64, z: 0 }, radius: 24 }); await territory.create({ worldKey: 'localhost:25565', dimension: 'overworld', name: 'North Risk', type: 'DANGER', center: { x: 0, y: 64, z: -100 }, radius: 32, dangerLevel: 0.9 }); const plan = await exploration.plan({ worldKey: 'localhost:25565', dimension: 'overworld', origin: { x: 0, y: 64, z: 0 }, maxDistance: 256 }); assert.equal(plan.target.id, east.id); assert.equal(plan.scout.botId, 'scout'); assert.ok(plan.candidates[0].score > plan.candidates[1].score);
});

test('exploration mission navigates, surveys, persists discoveries, and closes frontier', async () => {
  const { territory, exploration, calls } = setup(); const frontier = await territory.create({ worldKey: 'localhost:25565', dimension: 'overworld', name: 'East', type: 'FRONTIER', center: { x: 64, y: 64, z: 0 }, radius: 24 }); const mission = await exploration.createMission({ worldKey: 'localhost:25565', dimension: 'overworld', origin: { x: 0, y: 64, z: 0 } }); const completed = await exploration.execute(mission.id); assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.result.discoveries, 1); assert.equal(calls[0].botId, 'scout'); assert.equal((await territory.get(frontier.id)).explored, true); assert.equal((await exploration.status()).completed, 1);
});

test('exploration failure is persisted and releases active mission state', async () => {
  const blocked = Object.assign(new Error('route blocked'), { code: 'PATH_NOT_FOUND' }); const { territory, exploration } = setup({ navigation: { moveTo: async () => { throw blocked; }, cancel: async () => ({}) } }); await territory.create({ worldKey: 'localhost:25565', dimension: 'overworld', name: 'Blocked', type: 'FRONTIER', center: { x: 64, y: 64, z: 0 }, radius: 24 }); const mission = await exploration.createMission({ worldKey: 'localhost:25565', dimension: 'overworld', origin: { x: 0, y: 64, z: 0 } }); await assert.rejects(exploration.execute(mission.id), error => error.code === 'PATH_NOT_FOUND'); assert.equal((await exploration.get(mission.id)).failure.code, 'PATH_NOT_FOUND'); assert.equal((await exploration.status()).running, 0);
});

test('exploration startup reconciles interrupted running missions', async () => {
  const repository = new MemoryRepository(); await repository.create({ id: 'interrupted', status: 'RUNNING', scoutBotId: 'scout', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); const { territory, exploration: base } = setup(); const exploration = createExplorationService({ repository, territory, bots: { list: () => [], get: () => null }, navigation: { moveTo: async () => {}, cancel: async () => {} }, discovery: { record: async () => ({ memories: [] }) } }); assert.equal((await exploration.initialize())[0].failure.code, 'INTERRUPTED_BY_RESTART'); assert.equal((await exploration.get('interrupted')).status, 'FAILED'); assert.equal((await base.status()).missions, 0);
});
