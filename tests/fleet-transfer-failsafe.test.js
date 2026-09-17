import assert from 'node:assert/strict';
import test from 'node:test';
import { EventBus } from '../src/core/event-bus.js';
import { createFleetTransferService } from '../src/logistics/fleet-transfer-service.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';

function fleet({ stolen = false, lost = false } = {}) {
  const inventories = { donor: 8, receiver: 0, taker: 0 }; let receiverAttempts = 0;
  const runtime = (id, x) => ({ id, bot: { id, name: id }, options: { host: 'localhost', port: 25565 }, adapter: {
    snapshot: () => ({ inventorySummary: inventories[id] ? [{ name: 'stone', count: inventories[id] }] : [], position: { x, y: 64, z: 0 }, dimension: 'overworld' }),
    smartMove: async () => {},
    dropItem: async ({ count }) => { inventories[id] -= count; if (id === 'donor' && stolen) inventories.taker += count; },
    pickupItem: async ({ count }) => { receiverAttempts++; if (id === 'receiver' && receiverAttempts === 1 && (stolen || lost)) throw new Error('pickup verification timed out'); inventories[id] += count; }
  } });
  const runtimes = { donor: runtime('donor', 0), receiver: runtime('receiver', 4), taker: runtime('taker', 2) };
  const bots = { list: () => Object.values(runtimes).map(value => ({ id: value.id, status: 'READY' })), get: id => runtimes[id] };
  return { inventories, runtimes, bots };
}

test('wrong pickup is returned to the intended bot and transfer completes', async () => {
  const state = fleet({ stolen: true }); const events = new EventBus(); const recovered = [];
  events.subscribe('fleet.transfer.recovered', event => recovered.push(event.payload));
  const service = createFleetTransferService({ events, bots: state.bots, repository: new MemoryRepository() });
  const result = await service.transfer({ donor: state.runtimes.donor, receiver: state.runtimes.receiver, item: 'stone', count: 4 });
  assert.equal(result.verified, true); assert.equal(result.recoveredFrom, 'taker');
  assert.deepEqual(state.inventories, { donor: 4, receiver: 4, taker: 0 }); assert.equal(recovered.length, 1);
});

test('verified item loss reduces the custodian reliability score', async () => {
  const state = fleet({ lost: true }); const repository = new MemoryRepository();
  const service = createFleetTransferService({ events: new EventBus(), bots: state.bots, repository });
  await assert.rejects(service.transfer({ donor: state.runtimes.donor, receiver: state.runtimes.receiver, item: 'stone', count: 4 }), /timed out/);
  const reliability = await service.reliability('donor');
  assert.equal(reliability.score, 95); assert.equal(reliability.lostItems, 4); assert.equal(reliability.lastReason, 'TRANSFER_ITEM_LOST');
});
