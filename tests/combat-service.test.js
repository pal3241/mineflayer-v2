import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createCombatService } from '../src/combat/index.js';

function bots(items) { return { list: () => items }; }

test('combat profile keeps hierarchical state, points and ranks', async () => {
  const combat = createCombatService({ repositories: { profiles: new MemoryRepository(), events: new MemoryRepository(), policies: new MemoryRepository() }, events: new EventBus(), bots: bots([{ id: 'tank', status: 'READY', runtime: { position: { x: 0, y: 64, z: 0 } }]) });
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