import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, MemoryRepository, createFleetTransferService, createHelpService } from '../src/index.js';

class BotAdapter {
  constructor(items, position) { this.items = items; this.position = position; }
  snapshot() { return { inventorySummary: structuredClone(this.items), position: this.position, dimension: 'overworld' }; }
  async smartMove() {}
  async dropItem({ item, count }) { change(this.items, item, -count); }
  async pickupItem({ item, count }) { change(this.items, item, count); }
}

function setup() {
  const owner = { id: 'owner', bot: { id: 'owner' }, options: { host: 'server', port: 25565 }, adapter: new BotAdapter([{ name: 'stone', count: 32 }], { x: 0, y: 64, z: 0 }) };
  const helper = { id: 'helper', bot: { id: 'helper' }, options: { host: 'server', port: 25565 }, adapter: new BotAdapter([], { x: 8, y: 64, z: 0 }) };
  const bots = { get: id => ({ owner, helper })[id], list: () => [owner, helper] }; const events = new EventBus(); const logistics = { store: async ({ runtime, item, count }) => { change(runtime.adapter.items, item, -count); return { transfer: { status: 'COMPLETED', transferredCount: count }, storage: { inventory: [{ name: item, count }] } }; } };
  return { owner, helper, service: createHelpService({ repository: new MemoryRepository(), bots, fleetTransfer: createFleetTransferService({ events }), logistics, events }) };
}

test('OWNER output is uncredited before verified fleet handoff and credits only delivery', async () => {
  const { owner, helper, service } = setup(); const session = await service.create({ ownerBotId: 'owner', goal: { item: 'stone', target: 64 }, initialProgress: 32, workers: [{ botId: 'owner', assigned: 16 }, { botId: 'helper', assigned: 16 }] }); change(helper.adapter.items, 'stone', 16);
  const collected = await service.recordCollected({ sessionId: session.id, botId: 'helper', item: 'stone', count: 16 }); assert.equal(collected.progress.current, 32); assert.equal(collected.workers[1].credited, 0);
  const completed = await service.handoff({ sessionId: session.id, botId: 'helper' }); assert.equal(completed.progress.current, 48); assert.equal(completed.workers[1].delivered, 16); assert.equal(completed.workers[1].credited, 16); assert.equal(count(owner.adapter.items, 'stone'), 48); assert.equal(count(helper.adapter.items, 'stone'), 0);
});

test('SHARED_STORAGE credits only after verified storage deposit and HELPER_KEEP requires fleet ownership', async () => {
  const { helper, service } = setup(); await assert.rejects(service.create({ ownerBotId: 'owner', goal: { item: 'stone', target: 16 }, workers: [{ botId: 'helper', assigned: 16 }], outputPolicy: { mode: 'HELPER_KEEP' } }), /fleetWide/);
  const session = await service.create({ ownerBotId: 'owner', goal: { item: 'stone', target: 16 }, initialProgress: 0, workers: [{ botId: 'helper', assigned: 16 }], outputPolicy: { mode: 'SHARED_STORAGE', storageName: 'warehouse' } }); change(helper.adapter.items, 'stone', 16); await service.recordCollected({ sessionId: session.id, botId: 'helper', item: 'stone', count: 16 }); const completed = await service.handoff({ sessionId: session.id, botId: 'helper' }); assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.progress.credited, 16);
});

test('over-credit tracks surplus and helper death never credits undelivered output', async () => {
  const { helper, service } = setup(); const session = await service.create({ ownerBotId: 'owner', goal: { item: 'stone', target: 36 }, initialProgress: 32, workers: [{ botId: 'helper', assigned: 8 }] }); change(helper.adapter.items, 'stone', 8); await service.recordCollected({ sessionId: session.id, botId: 'helper', item: 'stone', count: 8 }); const complete = await service.handoff({ sessionId: session.id, botId: 'helper' }); assert.equal(complete.progress.credited, 4); assert.equal(complete.outputs[0].status, 'SURPLUS');
  const other = await service.create({ ownerBotId: 'owner', goal: { item: 'stone', target: 48 }, initialProgress: 32, workers: [{ botId: 'helper', assigned: 16 }] }); change(helper.adapter.items, 'stone', 16); await service.recordCollected({ sessionId: other.id, botId: 'helper', item: 'stone', count: 16 }); const affected = await service.handleBotDeath('helper'); assert.equal(affected.some(entry => entry.id === other.id), true); const lost = await service.get(other.id); assert.equal(lost.workers[0].credited, 0); assert.equal(lost.status, 'RECOVERY_REQUIRED');
});

test('full owner waits for destination and recovery reconciles only physical output', async () => {
  const { owner, helper, service } = setup(); const session = await service.create({ ownerBotId: 'owner', goal: { item: 'stone', target: 48 }, initialProgress: 32, workers: [{ botId: 'helper', assigned: 16 }] }); change(helper.adapter.items, 'stone', 16); await service.recordCollected({ sessionId: session.id, botId: 'helper', item: 'stone', count: 16 }); const full = new Error('owner inventory is full'); full.code = 'INVENTORY_FULL'; owner.adapter.pickupItem = async () => { throw full; };
  await assert.rejects(service.handoff({ sessionId: session.id, botId: 'helper' }), /full/); assert.equal((await service.get(session.id)).status, 'WAITING_DESTINATION'); const lost = await service.handleBotDeath('helper'); assert.equal(lost.length, 1); const reconciled = await service.reconcileRecovery({ sessionId: session.id, botId: 'helper', recoveredItems: [{ name: 'stone', count: 13 }] }); assert.equal(reconciled.workers[0].collected, 13); assert.equal(reconciled.workers[0].lost, 3); assert.equal(reconciled.workers[0].credited, 0);
});

function count(items, name) { return items.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0); }
function change(items, name, amount) { const item = items.find(entry => entry.name === name); if (!item && amount > 0) items.push({ name, count: amount }); else if (item) { item.count += amount; if (item.count === 0) items.splice(items.indexOf(item), 1); } }
