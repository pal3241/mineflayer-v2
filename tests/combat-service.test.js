import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createCombatService } from '../src/combat/index.js';
import { createCombatNeuralPolicy } from '../src/combat/combat-neural-policy.js';

function bots(items) { return { list: () => items }; }

test('combat profile keeps hierarchical state, points and ranks', async () => {
  const combat = createCombatService({ repositories: { profiles: new MemoryRepository(), events: new MemoryRepository(), policies: new MemoryRepository() }, events: new EventBus(), bots: bots([{ id: 'tank', status: 'READY', runtime: { position: { x: 0, y: 64, z: 0 } } }]) });
  await combat.setRole('tank', 'tank');
  await combat.transition('tank', 'MINING', 'COMBAT_GUARD', 'INTERCEPT', { owner: 'builder' });
  const result = await combat.record({ botId: 'tank', type: 'ALLY_SAVED', action: 'INTERCEPT', outcome: 'SUCCESS' });
  assert.equal(result.profile.combatRole, 'TANK');
  assert.equal(result.profile.mainState, 'MINING');
  assert.equal(result.profile.sideState, 'COMBAT_GUARD');
  assert.equal(result.profile.combatPoints, 10);
});

test('combat decisions keep deterministic survival above role actions', async () => {
  const combat = createCombatService({ repositories: { profiles: new MemoryRepository(), events: new MemoryRepository(), policies: new MemoryRepository() }, events: new EventBus(), bots: bots([]) });
  await combat.setRole('archer', 'ranged');
  const decision = await combat.decide({ botId: 'archer', self: { health: 6 }, target: { name: 'skeleton', distance: 12 }, inventory: ['bow', 'arrow', 'golden_apple'] });
  assert.equal(decision.action, 'SURVIVE_HEAL');
  assert.equal(decision.deterministic, true);
});

test('defense request chooses ready combat bots without moving every worker', async () => {
  const items = [{ id: 'tank', status: 'READY', runtime: { position: { x: 2, y: 64, z: 2 } } }, { id: 'archer', status: 'READY', runtime: { position: { x: 4, y: 64, z: 4 } } }, { id: 'offline', status: 'OFFLINE', runtime: { position: { x: 1, y: 64, z: 1 } } }];
  const combat = createCombatService({ repositories: { profiles: new MemoryRepository(), events: new MemoryRepository(), policies: new MemoryRepository() }, events: new EventBus(), bots: bots(items) });
  await combat.setRole('tank', 'tank'); await combat.setRole('archer', 'ranged');
  const result = await combat.requestDefense({ botId: 'builder', position: { x: 0, y: 64, z: 0 }, maxDefenders: 2 });
  assert.deepEqual(result.defenders.map(x => x.botId).sort(), ['archer', 'tank']);
});

test('combat doctrine extracts PvP techniques from owner text without overriding survival', async () => {
  const combat = createCombatService({ repositories: { profiles: new MemoryRepository(), events: new MemoryRepository(), policies: new MemoryRepository(), doctrines: new MemoryRepository() }, events: new EventBus(), bots: bots([]) });
  const doctrine = await combat.ingestDoctrine({ title: 'PvP notes', text: 'Saat skeleton menarik bow lakukan diagonal strafe. Jika musuh pakai shield gunakan axe. Saat HP rendah gunakan golden apple.' });
  assert.equal(doctrine.techniques.length, 4);
  await combat.setRole('archer', 'RANGED');
  const decision = await combat.decide({ botId: 'archer', self: { health: 20 }, target: { name: 'skeleton', distance: 6 }, inventory: ['bow', 'arrow'] });
  assert.ok(decision.doctrine.some(item => item.title === 'PvP notes'));
});


test('damage to a bound bot starts automatic guard combat once', async () => {
  const handlers = new Map(); const calls = [];
  const adapter = {
    combatState: { status: 'IDLE' },
    snapshot: () => ({ entityId: 42, position: { x: 3, y: 64, z: 5 }, health: 18 }),
    on: (name, callback) => handlers.set(name, callback),
    off: () => {},
    startCombat: async input => { calls.push(input); adapter.combatState.status = 'ACTIVE'; }
  };
  const combat = createCombatService({ repositories: { profiles: new MemoryRepository(), events: new MemoryRepository(), policies: new MemoryRepository() }, events: new EventBus(), bots: bots([{ id: 'guard', status: 'READY', runtime: { position: { x: 3, y: 64, z: 5 } } }]) });
  await combat.setRole('guard', 'TANK');
  await combat.bind({ bot: { id: 'guard' }, adapter });
  handlers.get('entityHurt')({ id: 42 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { mode: 'guard', position: { x: 3, y: 64, z: 5 }, radius: 16, role: 'TANK' });
});

test('shared neural combat policy learns from reward without overriding before sufficient samples', () => {
  const policy = createCombatNeuralPolicy();
  for (let index = 0; index < 24; index++) policy.observe({ state: { health: 18, distance: 3, mob: 'zombie' }, action: 'MELEE_PRESSURE', reward: 12 });
  const advice = policy.recommend({ health: 18, distance: 3, mob: 'zombie' }, 'RETREAT');
  assert.equal(advice.active, true);
  assert.ok(advice.samples >= 24);
  assert.ok(policy.status().architecture.endsWith('-7'));
});

test('protection starts guard combat at the protected bot position', async () => {
  const handlers = new Map(); const calls = [];
  const adapter = position => ({ combatState: { status: 'IDLE' }, snapshot: () => ({ entityId: position.x, position, health: 20 }), on: (name, callback) => handlers.set(name + position.x, callback), off: () => {}, startCombat: async input => calls.push(input), stopCombat: async () => ({ status: 'IDLE' }) });
  const tankAdapter = adapter({ x: 0, y: 64, z: 0 }); const builderAdapter = adapter({ x: 10, y: 64, z: 10 });
  const fleet = [{ id: 'tank', status: 'READY', runtime: { position: { x: 0, y: 64, z: 0 } } }, { id: 'builder', status: 'READY', runtime: { position: { x: 10, y: 64, z: 10 } } }];
  const combat = createCombatService({ repositories: { profiles: new MemoryRepository(), events: new MemoryRepository(), policies: new MemoryRepository() }, events: new EventBus(), bots: bots(fleet) });
  await combat.bind({ bot: { id: 'tank' }, adapter: tankAdapter }); await combat.bind({ bot: { id: 'builder' }, adapter: builderAdapter });
  const result = await combat.protect({ protectorId: 'tank', wardId: 'builder', radius: 12 });
  assert.equal(result.wardId, 'builder');
  assert.deepEqual(calls[0], { mode: 'guard', position: { x: 10, y: 64, z: 10 }, radius: 12, role: 'UNASSIGNED' });
});