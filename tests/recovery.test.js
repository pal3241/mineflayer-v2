import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import {
  advanceDespawnBudget,
  createDeathManifest,
  createDespawnBudget,
  createRecoveryConfig,
  createRecoveryJobService,
  evaluateRecoveryItems,
  mergeDeathInventory,
  reconcileRecovery,
  selectRecoveryBot,
  sortRecoveryJobsByUrgency,
  verifyRecovery
} from '../src/logistics/recovery/index.js';

const DEFAULT_COST = Object.freeze({ distance: 0, danger: 0, workload: 0, risk: 0, remainingDespawnTicks: 6000 });
let manifestSequence = 0;

test('death manifest validates unknown keepInventory and inventory sources without double counting snapshots', () => {
  const inventory = mergeDeathInventory({
    lastKnownInventory: [{ name: 'diamond', count: 3 }, { name: 'diamond', count: 5 }],
    runtimeInventory: [{ name: 'diamond', count: 4 }],
    eventInventory: [],
    transferItems: [{ name: 'iron_ingot', count: 64 }]
  });
  assert.deepEqual(inventory.map(item => [item.name, item.count]), [['diamond', 8]]);
  const fallback = mergeDeathInventory({ lastKnownInventory: [], runtimeInventory: [], eventInventory: [], transferItems: [{ name: 'iron_ingot', count: 32 }, { name: 'iron_ingot', count: 32 }] });
  assert.deepEqual(fallback.map(item => [item.name, item.count]), [['iron_ingot', 64]]);
  const death = manifest(inventory, {});
  assert.equal(death.keepInventory, 'UNKNOWN');
  assert.throws(() => manifest([{ name: 'diamond', count: -1 }], {}), /positive safe integer/);
});

test('item evaluator classifies valuable, optional, and junk items deterministically', () => {
  const evaluation = evaluateRecoveryItems({
    manifest: manifest([{ name: 'diamond', count: 8 }, { name: 'oak_log', count: 32 }, { name: 'dirt', count: 64 }], {}),
    signals: [],
    cost: DEFAULT_COST,
    config: createRecoveryConfig({})
  });
  assert.deepEqual(evaluation.items.map(item => [item.name, item.decision]), [['diamond', 'REQUIRED'], ['oak_log', 'OPTIONAL'], ['dirt', 'IGNORE']]);
  assert.equal(evaluation.shouldRecover, true);
  assert.equal(evaluation.decision, 'URGENT_RECOVERY');
});

test('dynamic scarcity, demand, task, logistics, and unique value can promote ordinary items', () => {
  const evaluation = evaluateRecoveryItems({
    manifest: manifest([
      { name: 'bread', count: 64 },
      { name: 'oak_planks', count: 64 },
      { name: 'cobblestone', count: 64 },
      { name: 'wooden_sword', count: 1, customName: 'Pedang Kurir' }
    ], {}),
    signals: [
      { name: 'bread', currentStock: 8, targetStock: 128, demand: 1 },
      { name: 'oak_planks', taskImportance: 1 },
      { name: 'cobblestone', logisticsCount: 64 },
      { name: 'wooden_sword', uniqueValue: 1 }
    ],
    cost: DEFAULT_COST,
    config: createRecoveryConfig({})
  });
  assert.deepEqual(evaluation.items.map(item => item.decision), ['REQUIRED', 'REQUIRED', 'REQUIRED', 'REQUIRED']);
  assert.ok(evaluation.items.find(item => item.name === 'bread').scoreBreakdown.scarcity > 0);
  assert.equal(evaluation.items.find(item => item.name === 'cobblestone').scoreBreakdown.logistics, 35);
});

test('hard recovery constraints stop jobs without erasing item classification', () => {
  const evaluation = evaluateRecoveryItems({
    manifest: manifest([{ name: 'diamond', count: 4 }], {}),
    signals: [],
    cost: { ...DEFAULT_COST, danger: 0.9 },
    config: createRecoveryConfig({ dangerLimit: 0.75 })
  });
  assert.equal(evaluation.items[0].decision, 'REQUIRED');
  assert.equal(evaluation.shouldRecover, false);
  assert.ok(evaluation.blockedBy.includes('DANGER_TOO_HIGH'));
  const keepInventory = evaluateRecoveryItems({ manifest: manifest([{ name: 'diamond', count: 4 }], { keepInventory: 'ENABLED' }), signals: [], cost: DEFAULT_COST, config: createRecoveryConfig({}) });
  assert.ok(keepInventory.blockedBy.includes('KEEP_INVENTORY'));
});

test('despawn budget advances only during estimated loaded ticks and schedules active jobs first', () => {
  const initial = createDespawnBudget({ budgetTicks: 6000, safetyMarginTicks: 600, estimatedLoadedTicks: 1200, chunkActive: false });
  const paused = advanceDespawnBudget({ budget: initial, loadedTicksElapsed: 4000, chunkActive: false });
  assert.equal(paused.remainingTicks, 4800);
  assert.equal(paused.status, 'TIMER_PAUSED_ESTIMATED');
  const urgent = advanceDespawnBudget({ budget: paused, loadedTicksElapsed: 4300, chunkActive: true });
  assert.equal(urgent.remainingTicks, 500);
  assert.equal(urgent.status, 'URGENT');
  const expired = advanceDespawnBudget({ budget: urgent, loadedTicksElapsed: 500, chunkActive: true });
  const sorted = sortRecoveryJobsByUrgency([
    { id: 'paused', despawn: paused, recoveryScore: 90 },
    { id: 'expired', despawn: expired, recoveryScore: 100 },
    { id: 'urgent', despawn: urgent, recoveryScore: 70 }
  ]);
  assert.deepEqual(sorted.map(job => job.id), ['urgent', 'paused', 'expired']);
});

test('recovery selector rejects dead, full, unsafe, and malformed bots while ranking valid candidates', () => {
  const result = selectRecoveryBot({
    death: { deadBotId: 'courier', worldKey: 'server:25565', dimension: 'overworld', position: { x: 0, y: 64, z: 0 }, danger: 0.4 },
    requiredSlots: 2,
    config: createRecoveryConfig({}),
    candidates: [
      candidate('courier', 20, { x: 40, y: 64, z: 0 }, { alive: false }),
      candidate('near-full', 20, { x: 10, y: 64, z: 0 }, { freeSlots: 1 }),
      candidate('miner', 20, { x: 80, y: 64, z: 0 }, { freeSlots: 12, equipmentScore: 1 }),
      { botId: 'broken', worldKey: 'server:25565', dimension: 'overworld', position: null },
      candidate('unsafe', 20, { x: 5, y: 64, z: 0 }, { dangerTolerance: 0.2 })
    ]
  });
  assert.equal(result.selected.botId, 'miner');
  assert.deepEqual(result.rejected.map(bot => bot.botId), ['broken', 'courier', 'near-full', 'unsafe']);
  assert.ok(result.rejected.find(bot => bot.botId === 'broken').validationError);
});

test('verification uses exact inventory delta and optional loss does not block success', () => {
  const evaluation = evaluateRecoveryItems({ manifest: manifest([{ name: 'diamond', count: 8 }, { name: 'oak_log', count: 32 }], {}), signals: [], cost: DEFAULT_COST, config: createRecoveryConfig({}) });
  const verification = verifyRecovery({
    expectedItems: evaluation.items,
    beforeInventory: [{ name: 'diamond', count: 2 }],
    afterInventory: [{ name: 'diamond', count: 10 }]
  });
  assert.equal(verification.status, 'RECOVERED');
  assert.equal(verification.verified, true);
  assert.equal(verification.missingOptional[0].name, 'oak_log');
});

test('partial verification reconciles required and optional losses separately and protects transfer takeover', () => {
  const evaluation = evaluateRecoveryItems({
    manifest: manifest([{ name: 'iron_ingot', count: 64 }, { name: 'oak_log', count: 32 }], { relatedTransferId: 'transfer-1' }),
    signals: [{ name: 'iron_ingot', logisticsCount: 64 }],
    cost: DEFAULT_COST,
    config: createRecoveryConfig({})
  });
  const verification = verifyRecovery({ expectedItems: evaluation.items, beforeInventory: [], afterInventory: [{ name: 'iron_ingot', count: 59 }] });
  const result = reconcileRecovery({ verification, transfer: { id: 'transfer-1', originalBotId: 'courier', items: [{ name: 'iron_ingot', count: 64 }] }, recoveryBotId: 'scout' });
  assert.equal(result.outcome, 'PARTIAL_RECONCILED');
  assert.deepEqual(result.permanentLosses.map(item => [item.name, item.count]), [['iron_ingot', 5]]);
  assert.deepEqual(result.optionalLosses.map(item => [item.name, item.count]), [['oak_log', 32]]);
  assert.equal(result.transfer.action, 'TAKEOVER_REQUIRED');
  assert.equal(result.transfer.reservationStatus, 'RECOVERY_REQUIRED');
  assert.equal(result.transfer.reservationProtected, true);
});

test('recovery job service persists transitions and stops exactly at maximum attempts', async () => {
  const events = new EventBus();
  const service = createRecoveryJobService({ repository: new MemoryRepository(), events, config: createRecoveryConfig({ maxAttempts: 3 }) });
  const death = manifest([{ name: 'diamond', count: 4 }], {});
  const evaluation = evaluateRecoveryItems({ manifest: death, signals: [], cost: DEFAULT_COST, config: createRecoveryConfig({}) });
  let job = await service.create({ manifest: death, evaluation, chunkActive: true });
  assert.equal(job.status, 'EVALUATING');
  job = await service.assign({ jobId: job.id, botId: 'scout' });
  assert.equal(job.status, 'ASSIGNED');
  job = await service.recordFailure({ jobId: job.id, code: 'PATHFINDER_FAILED', message: 'Pathfinder gagal mencapai lokasi kematian' });
  assert.equal(job.status, 'REASSIGN_REQUIRED');
  job = await service.assign({ jobId: job.id, botId: 'miner' });
  job = await service.recordFailure({ jobId: job.id, code: 'RECOVERY_BOT_DIED', message: 'Bot recovery mati' });
  assert.equal(job.recoveryAttempts, 2);
  job = await service.assign({ jobId: job.id, botId: 'guard' });
  job = await service.recordFailure({ jobId: job.id, code: 'RECOVERY_TIMEOUT', message: 'Recovery melewati batas waktu' });
  assert.equal(job.status, 'FAILED');
  assert.equal(job.failure.code, 'MAX_RECOVERY_ATTEMPTS');
  await assert.rejects(service.assign({ jobId: job.id, botId: 'courier' }), /cannot transition/);
  assert.equal(await service.remove({ jobId: job.id }), true);
});

test('recovery job service verifies required items before recording completion', async () => {
  const service = createRecoveryJobService({ repository: new MemoryRepository(), events: null, config: createRecoveryConfig({}) });
  const death = manifest([{ name: 'diamond', count: 4 }, { name: 'oak_log', count: 8 }], {});
  const evaluation = evaluateRecoveryItems({ manifest: death, signals: [], cost: DEFAULT_COST, config: createRecoveryConfig({}) });
  let job = await service.create({ manifest: death, evaluation, chunkActive: true });
  job = await service.assign({ jobId: job.id, botId: 'courier' });
  for (const status of ['TRAVELLING', 'SEARCHING', 'COLLECTING', 'VERIFYING']) job = await service.transition({ jobId: job.id, status });
  const verification = verifyRecovery({ expectedItems: evaluation.items, beforeInventory: [], afterInventory: [{ name: 'diamond', count: 4 }] });
  job = await service.complete({ jobId: job.id, verification });
  assert.equal(job.status, 'RECOVERED');
  assert.equal(job.verification.verified, true);
  assert.deepEqual((await service.list({ statuses: ['RECOVERED'] })).map(record => record.id), [job.id]);
});

function manifest(items, overrides) {
  return createDeathManifest({
    botId: 'courier',
    worldKey: 'server:25565',
    dimension: 'overworld',
    position: { x: 10, y: 64, z: -5 },
    items,
    relatedTransferId: overrides.relatedTransferId ?? null,
    cause: overrides.cause ?? 'zombie',
    keepInventory: overrides.keepInventory
  }, { id: overrides.id ?? `death-${++manifestSequence}`, createdAt: '2026-08-30T00:00:00.000Z' });
}

function candidate(botId, health, position, overrides) {
  return {
    botId,
    worldKey: 'server:25565',
    dimension: 'overworld',
    position,
    alive: overrides.alive ?? true,
    available: overrides.available ?? true,
    health,
    food: overrides.food ?? 20,
    freeSlots: overrides.freeSlots ?? 10,
    equipmentScore: overrides.equipmentScore ?? 0.5,
    workload: overrides.workload ?? 0,
    dangerTolerance: overrides.dangerTolerance ?? 0.75
  };
}
