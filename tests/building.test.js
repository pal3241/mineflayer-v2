import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { EventBus } from '../src/core/event-bus.js';
import { createBuildingService } from '../src/building/index.js';

const blueprint = { name: 'test house', origin: { x: 0, y: 0, z: 0 }, blocks: [{ x: 0, y: 0, z: 0, name: 'stone' }, { x: 0, y: 1, z: 0, name: 'torch' }] };
function service() { return createBuildingService({ repository: new MemoryRepository(), settingsRepository: new MemoryRepository(), events: new EventBus(), bots: { list: () => [{ id: 'builder', status: 'READY', capabilities: ['minecraft.blueprint-place'] }] }, capabilities: { execute: async (_name, input) => ({ verified: input.block.name !== 'bad_block' }) }, settings: { placementDelayMs: 0 } }); }

test('building imports a validated blueprint with material manifest and dependencies', async () => {
  const building = service(); await building.initialize(); const project = await building.import({ blueprint, target: { x: 10, y: 64, z: 10 } });
  assert.equal(project.status, 'PENDING_APPROVAL'); assert.deepEqual(project.materials, [{ name: 'stone', count: 1 }, { name: 'torch', count: 1 }]); assert.deepEqual(project.blocks[1].dependencies, ['0,0,0']);
  const preview = await building.preview(project.id, 1); assert.equal(preview.blocks[0].name, 'torch'); assert.equal((await building.deltas(project.id, 0)).deltas[0].type, 'IMPORTED');
});

test('building moves a preview placement and recalculates world protection bounds', async () => {
  const building = service(); await building.initialize(); const project = await building.import({ blueprint });
  const moved = await building.place(project.id, { target: { x: 25, y: 70, z: -12 }, source: 'test-client' });
  assert.deepEqual(moved.target, { x: 25, y: 70, z: -12 });
  assert.deepEqual(moved.protection.bounds, { min: { x: 25, y: 70, z: -12 }, max: { x: 25, y: 71, z: -12 } });
  assert.equal(moved.deltas.at(-1).type, 'PLACEMENT_MOVED');
});

test('Litematica placement transforms are idempotent and retain the original blueprint', async () => {
  const building = service(); await building.initialize();
  const project = await building.import({ blueprint: { name: 'asymmetric', origin: { x: 0, y: 0, z: 0 }, blocks: [{ x: 1, y: 0, z: 0, name: 'oak_stairs', properties: { facing: 'east' } }] } });
  const rotated = await building.transform(project.id, { rotation: 90, mirrorX: false, mirrorZ: false });
  assert.deepEqual(rotated.blocks[0], { key: '0,0,1', x: 0, y: 0, z: 1, name: 'oak_stairs', properties: { facing: 'south' }, blockEntity: null, dependencies: [] });
  const reset = await building.transform(project.id, { rotation: 0, mirrorX: false, mirrorZ: false });
  assert.equal(reset.blocks[0].x, 1); assert.equal(reset.blocks[0].z, 0); assert.equal(reset.blocks[0].properties.facing, 'east');
  const mirroredThenRotated = await building.transform(project.id, { rotation: 90, mirrorX: true, mirrorZ: false });
  assert.equal(mirroredThenRotated.blocks[0].properties.facing, 'north');
});

test('building requires approval then completes verified cooperative placement', async () => {
  const building = service(); await building.initialize(); const project = await building.import({ blueprint, target: { x: 10, y: 64, z: 10 } }); await building.approve(project.id, { actor: 'owner' }); await building.build(project.id);
  await new Promise(resolve => setTimeout(resolve, 80)); const result = await building.get(project.id); assert.equal(result.status, 'COMPLETED'); assert.equal(result.progress.completed, 2); assert.equal(result.placements['0,1,0'].ownerBotId, 'builder');
});

test('building preserves verified work when material acquisition cannot find stock', async () => {
  const building = createBuildingService({ repository: new MemoryRepository(), settingsRepository: new MemoryRepository(), events: new EventBus(), bots: { list: () => [{ id: 'builder', status: 'READY', capabilities: ['minecraft.blueprint-place'] }] }, capabilities: { execute: async () => ({ verified: true }) }, acquisition: { acquire: async () => { throw new Error('No cobblestone found within 2000 blocks'); } }, settings: { placementDelayMs: 0 } });
  await building.initialize(); const project = await building.import({ blueprint, target: { x: 10, y: 64, z: 10 } }); await building.approve(project.id); const result = await building.build(project.id);
  assert.equal(result.status, 'FAILED'); assert.equal(result.failure.code, 'MATERIAL_UNAVAILABLE'); assert.equal(result.progress.completed, 0); assert.match(result.failure.message, /cobblestone/);
});
