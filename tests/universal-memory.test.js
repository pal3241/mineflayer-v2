import assert from 'node:assert/strict';
import test from 'node:test';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createUniversalTaskMemoryService } from '../src/memory/universal-task-memory-service.js';

test('universal memory shares verified task, storage, and placement facts', async () => {
  const events = new EventBus(); const memory = createUniversalTaskMemoryService({ repository: new MemoryRepository(), events }); await memory.initialize();
  await events.publish('task.completed', { id: 'task-1', status: 'COMPLETED', type: 'survey' }, { source: 'test' });
  await events.publish('logistics.storage.registered', { id: 'chest-1', worldKey: 'server:25565', dimension: 'overworld', name: 'Main Chest', kind: 'chest', position: { x: 5, y: 64, z: 5 }, inventory: [{ name: 'stone', count: 64 }], capacitySlots: 27, occupiedSlots: 1, status: 'ACTIVE' }, { source: 'test' });
  await memory.recordPlacement({ worldKey: 'server:25565', dimension: 'overworld', blueprintId: 'base-1', blockKey: '0,0,0', position: { x: 10, y: 64, z: 10 }, ownerBotId: 'builder' });
  const context = await memory.context({ worldKey: 'server:25565', dimension: 'overworld', position: { x: 0, y: 64, z: 0 } });
  assert.equal(context.storages[0].metadata.name, 'Main Chest'); assert.equal(context.placements.length, 1); assert.ok(await memory.placement({ worldKey: 'server:25565', dimension: 'overworld', blueprintId: 'base-1', blockKey: '0,0,0' }));
  memory.dispose();
});
