import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutoHelpCoordinator } from '../src/help/auto-help-coordinator.js';
import { EventBus } from '../src/core/event-bus.js';

test('automatic help assigns nearby idle members of the early-game group', async () => {
  const events = new EventBus(); const executed = []; const handed = []; const transitions = [];
  const descriptors = [{ id: 'leader', status: 'READY' }, { id: 'helper', status: 'READY' }, { id: 'far', status: 'READY' }];
  const runtimes = Object.fromEntries(descriptors.map((entry, index) => [entry.id, { id: entry.id, options: { host: 'localhost', port: 25565 }, adapter: { snapshot: () => ({ dimension: 'overworld', position: { x: index === 2 ? 30 : index * 5, y: 64, z: 0 } }) } }]));
  const session = { id: 'session', parentGoalId: 'goal', status: 'ACTIVE', progress: { current: 0, remaining: 16 }, workShares: [{ shareId: 'owner-share', botId: 'leader', status: 'ASSIGNED', completed: 0, delivered: 0 }, { shareId: 'helper-share', botId: 'helper', status: 'ASSIGNED', completed: 0, delivered: 0 }] };
  const help = {
    create: async input => { assert.deepEqual(input.workers, ['leader','helper']); return structuredClone(session); },
    get: async () => structuredClone(session),
    executeShare: async ({ shareId }) => { const share = session.workShares.find(value => value.shareId === shareId); share.status = 'OUTPUT_READY'; share.completed = 8; executed.push(share.botId); },
    handoff: async ({ shareId }) => { const share = session.workShares.find(value => value.shareId === shareId); share.status = 'COMPLETED'; share.delivered = 8; handed.push(share.botId); if (session.workShares.every(value => value.status === 'COMPLETED')) { session.status = 'COMPLETED'; session.progress = { current: 16, remaining: 0 }; } },
    cancel: async () => {}
  };
  const goals = { allTasks: () => [], transitionTaskToCollaborative: async (...args) => transitions.push(args) };
  const coordinator = createAutoHelpCoordinator({ help, goals, bots: { list: () => descriptors, get: id => runtimes[id] }, events, earlyGame: { group: () => ({ active: true, leaderBotId: 'leader', memberBotIds: descriptors.map(value => value.id), leashMaximum: 15 }) }, fleetTransfer: { reliability: async () => ({ score: 100 }) } });
  const result = await coordinator.handle({ id: 'task', goalId: 'goal', type: 'acquisition', assignedBot: 'leader', input: { item: 'iron_ore', count: 16 }, requiredCapabilities: ['minecraft.collection'] }); coordinator.dispose();
  assert.equal(result.status, 'COMPLETED'); assert.deepEqual(new Set(executed), new Set(['leader','helper'])); assert.deepEqual(new Set(handed), new Set(['leader','helper'])); assert.deepEqual(transitions, [['task','session']]);
});
