import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, MemoryRepository, Task, TaskStatus, createFleetTransferService, createHelpService } from '../src/index.js';

class BotAdapter {
  constructor(items, position) { this.items = items; this.position = position; }
  snapshot() { return { inventorySummary: structuredClone(this.items), position: this.position, dimension: 'overworld' }; }
  async smartMove() {}
  async dropItem({ item, count }) { change(this.items, item, -count); }
  async pickupItem({ item, count }) { change(this.items, item, count); }
}

function setup(target = 64) {
  const owner = runtime('owner', 34, 0); const helper = runtime('helper', 0, 8); const helper2 = runtime('helper2', 0, 16); const helper3 = runtime('helper3', 0, 24); const runtimes = { owner, helper, helper2, helper3 }; const parent = new Task({ id: 'parent-collect', goalId: 'goal-1', type: 'collect', input: { block: 'stone', count: target }, requiredCapabilities: ['minecraft.collection'] });
  const events = new EventBus(); const goals = { task: id => { if (id !== parent.id) throw new Error(`Task '${id}' not found`); return parent; } }; const executor = { cancel: () => true, execute: async task => { change(runtimes[task.assignedBot].adapter.items, 'stone', task.input.count); task.update(TaskStatus.COMPLETED); return { collected: task.input.count }; } }; const logistics = { store: async ({ runtime: value, item, count }) => { change(value.adapter.items, item, -count); return { stored: count }; } };
  const service = createHelpService({ repository: new MemoryRepository(), workShareRepository: new MemoryRepository(), contributionRepository: new MemoryRepository(), bots: { get: id => runtimes[id], list: () => Object.values(runtimes) }, fleetTransfer: createFleetTransferService({ events }), logistics, goals, executor, events }); return { owner, helper, helper2, helper3, parent, service };
}

test('uses actual parent task and splits remaining 30 equally', async () => {
  const { service } = setup(); await assert.rejects(service.create({ ownerBotId: 'owner', workers: ['helper'] }), /parentTaskId/); await assert.rejects(service.create({ parentTaskId: 'fake', ownerBotId: 'owner', workers: ['helper'] }), /not found/);
  const session = await service.create({ parentTaskId: 'parent-collect', ownerBotId: 'owner', workers: ['helper', 'helper2'] }); assert.equal(session.progress.remaining, 30); assert.deepEqual(session.workShares.map(share => share.assigned), [15, 15]);
});

test('splits odd remaining work across three workers without over-assignment', async () => {
  const { service } = setup(65); const session = await service.create({ parentTaskId: 'parent-collect', ownerBotId: 'owner', workers: ['helper', 'helper2', 'helper3'] }); assert.deepEqual(session.workShares.map(share => share.assigned), [11, 10, 10]);
  await assert.rejects(service.create({ parentTaskId: 'parent-collect', ownerBotId: 'owner', workers: [{ botId: 'helper', assigned: 31 }] }), /active help session/);
  const { service: fresh } = setup(); await assert.rejects(fresh.create({ parentTaskId: 'parent-collect', ownerBotId: 'owner', workers: [{ botId: 'helper', assigned: 31 }] }), /exceed remaining work 30/);
});

test('executes a WorkShare through TaskExecutor and credits verified handoff', async () => {
  const { owner, parent, service } = setup(49); const session = await service.create({ parentTaskId: parent.id, ownerBotId: 'owner', workers: ['helper'] }); const active = await service.executeShare({ sessionId: session.id, shareId: session.workShares[0].shareId }); assert.equal(active.workShares[0].completed, 15);
  const complete = await service.handoff({ sessionId: session.id, shareId: session.workShares[0].shareId }); assert.equal(complete.status, 'COMPLETED'); assert.equal(complete.progress.credited, 15); assert.equal(count(owner.adapter.items, 'stone'), 49); assert.equal(parent.status, TaskStatus.COMPLETED);
});

test('records separate multi-batch contributions and rejects duplicate credit', async () => {
  const { helper, service } = setup(50); const session = await service.create({ parentTaskId: 'parent-collect', ownerBotId: 'owner', workers: [{ botId: 'helper', assigned: 16 }] }); const shareId = session.workShares[0].shareId;
  change(helper.adapter.items, 'stone', 8); await service.recordCollected({ sessionId: session.id, shareId, contributionId: 'CONTRIB-001', before: 0, after: 8 }); await service.handoff({ sessionId: session.id, shareId });
  change(helper.adapter.items, 'stone', 8); await service.recordCollected({ sessionId: session.id, shareId, contributionId: 'CONTRIB-002', before: 0, after: 8 }); const duplicate = await service.recordCollected({ sessionId: session.id, shareId, contributionId: 'CONTRIB-002', before: 0, after: 8 }); assert.equal(duplicate.workShares[0].completed, 16); const complete = await service.handoff({ sessionId: session.id, shareId }); assert.equal(complete.progress.credited, 16);
});

test('rejects unsupported parent tasks', async () => {
  const { service } = setup(); const invalid = { id: 'parent-collect', goalId: 'goal-1', input: { count: 1 }, requiredCapabilities: ['minecraft.crafting'] }; const invalidService = createHelpService({ repository: new MemoryRepository(), workShareRepository: new MemoryRepository(), contributionRepository: new MemoryRepository(), bots: { get: () => runtime('owner', 0, 0) }, fleetTransfer: createFleetTransferService({ events: new EventBus() }), logistics: {}, goals: { task: () => invalid }, executor: { execute: async () => {}, cancel: () => false } }); await assert.rejects(invalidService.create({ parentTaskId: 'parent-collect', ownerBotId: 'owner' }), /not a supported collection task/); assert.ok(service);
});

function runtime(id, stone, x) { return { id, bot: { id }, options: { host: 'server', port: 25565 }, adapter: new BotAdapter(stone ? [{ name: 'stone', count: stone }] : [], { x, y: 64, z: 0 }) }; }
function count(items, name) { return items.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0); }
function change(items, name, amount) { const item = items.find(entry => entry.name === name); if (!item && amount > 0) items.push({ name, count: amount }); else if (item) { item.count += amount; if (item.count === 0) items.splice(items.indexOf(item), 1); } }
