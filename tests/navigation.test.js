import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MetricsManager } from '../src/core/health.js';
import { createNavigationService, createResourceReservationService, normalizeNavigationPolicy } from '../src/navigation/index.js';

function setup(options) {
  const state = { bot1: { x: 0, y: 64, z: 0 }, bot2: { x: 10, y: 64, z: 0 } }; const runtimes = Object.fromEntries(Object.keys(state).map(id => [id, { id, status: options?.statuses?.[id] ?? 'READY', adapter: { snapshot: () => ({ position: { ...state[id] }, inventorySummary: structuredClone(options?.inventory?.[id] ?? []) }) } }])); const calls = { navigation: [], stopped: [] }; const capabilities = { execute: async (name, input, context) => {
    if (name === 'minecraft.navigation-stop') { calls.stopped.push(context.botId); return { stopped: true }; }
    if (name === 'minecraft.navigation-target') return options?.targets?.[input.target.type] ?? { x: 4, y: 64, z: 0 };
    if (name === 'minecraft.navigation-pillar') return options?.pillar?.({ input, context, state, calls }) ?? { position: { x: 0, y: 64, z: 0 }, verified: true };
    if (name !== 'minecraft.navigation') throw new Error(`Unexpected capability '${name}'`);
    calls.navigation.push({ input, context }); if (options?.navigate) return options.navigate({ input, context, state, calls }); state[context.botId] = { ...input.target }; return { position: { ...state[context.botId] } };
  } };
  const bots = { get: id => { if (!runtimes[id]) throw new Error(`Bot '${id}' not found`); return runtimes[id]; } }; const events = new EventBus(); const metrics = new MetricsManager(); return { service: createNavigationService({ bots, capabilities, events, metrics, reservations: options?.reservations }), state, calls, events, metrics };
}

test('navigation arrives with verified runtime position and normalized policy', async () => {
  const { service, calls } = setup(); const result = await service.moveTo({ botId: 'bot1', target: { x: 8, y: 64, z: -2 }, mode: 'SAFE', tolerance: 2, timeout: 1000, source: 'TASK' }); assert.equal(result.status, 'ARRIVED'); assert.equal(result.distanceRemaining, 0); assert.equal(calls.navigation[0].input.policy.mode, 'SAFE'); assert.equal(service.status().active, 0);
});

test('navigation accepts a final position within tolerance and rejects an unverified arrival', async () => {
  const near = setup({ navigate: async ({ state, context }) => { state[context.botId] = { x: 1.5, y: 64, z: 0 }; return {}; } }); const arrived = await near.service.moveTo({ botId: 'bot1', target: { x: 0, y: 64, z: 0 }, tolerance: 2, timeout: 1000, source: 'TASK' }); assert.equal(arrived.status, 'ARRIVED');
  const far = setup({ navigate: async ({ state, context }) => { state[context.botId] = { x: 7, y: 64, z: 0 }; return {}; } }); await assert.rejects(far.service.moveTo({ botId: 'bot1', target: { x: 0, y: 64, z: 0 }, tolerance: 2, timeout: 1000, source: 'TASK' }), error => error.code === 'ARRIVAL_NOT_VERIFIED'); assert.equal(far.service.status().active, 0);
});

test('navigation timeout and cancellation stop low-level movement and release the lock', async () => {
  let navigationAttempts = 0; const pending = setup({ navigate: async ({ input, context, state }) => { navigationAttempts++; if (navigationAttempts === 1) return new Promise(() => {}); state[context.botId] = { ...input.target }; return {}; } }); await assert.rejects(pending.service.moveTo({ botId: 'bot1', target: { x: 4, y: 64, z: 0 }, timeout: 250, source: 'TASK' }), error => error.code === 'NAVIGATION_TIMEOUT'); assert.deepEqual(pending.calls.stopped, ['bot1']); await pending.service.moveTo({ botId: 'bot1', target: { x: 1, y: 64, z: 0 }, timeout: 1000, source: 'TASK' });
  const cancellable = setup({ navigate: async ({ context }) => new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })) }); const moving = cancellable.service.moveTo({ botId: 'bot1', target: { x: 4, y: 64, z: 0 }, timeout: 1000, source: 'TASK' }); await waitFor(() => cancellable.service.status().active === 1); await cancellable.service.cancel({ botId: 'bot1', reason: 'manual test cancellation' }); await assert.rejects(moving, error => error.code === 'NAVIGATION_CANCELLED'); assert.deepEqual(cancellable.calls.stopped, ['bot1', 'bot1']);
});

test('navigation enforces one active session per bot while different bots move concurrently', async () => {
  const deferred = deferredNavigation(); const context = setup({ navigate: deferred.navigate }); const first = context.service.moveTo({ botId: 'bot1', target: { x: 4, y: 64, z: 0 }, timeout: 1000, source: 'TASK' }); await waitFor(() => context.service.status().active === 1); await assert.rejects(context.service.moveTo({ botId: 'bot1', target: { x: 5, y: 64, z: 0 }, timeout: 1000, source: 'TASK' }), error => error.code === 'NAVIGATION_BUSY'); const second = context.service.moveTo({ botId: 'bot2', target: { x: 6, y: 64, z: 0 }, timeout: 1000, source: 'TASK' }); await waitFor(() => context.calls.navigation.length === 2); deferred.resolveAll(); const [firstResult, secondResult] = await Promise.all([first, second]); assert.equal(firstResult.status, 'ARRIVED'); assert.equal(secondResult.status, 'ARRIVED');
});

test('navigation rejects invalid targets, unavailable bots, and pathfinder failures with structured codes', async () => {
  const invalid = setup(); await assert.rejects(invalid.service.moveTo({ botId: 'bot1', target: { x: Number.NaN, y: 64, z: 0 }, timeout: 1000, source: 'TASK' }), error => error.code === 'INVALID_TARGET'); const unavailable = setup({ statuses: { bot1: 'OFFLINE' } }); await assert.rejects(unavailable.service.moveTo({ botId: 'bot1', target: { x: 1, y: 64, z: 0 }, timeout: 1000, source: 'TASK' }), error => error.code === 'BOT_NOT_READY'); const failed = setup({ navigate: async () => { throw new Error('path not found'); } }); await assert.rejects(failed.service.moveTo({ botId: 'bot1', target: { x: 1, y: 64, z: 0 }, timeout: 1000, source: 'TASK' }), error => error.code === 'PATH_NOT_FOUND'); assert.equal(failed.service.status().active, 0);
});

test('navigation policy keeps scaffolding, towering, and bridging opt-in', () => {
  const safe = normalizeNavigationPolicy({ mode: 'SAFE' }); assert.equal(safe.allowPlace, false); assert.equal(safe.allowTower, false); assert.equal(safe.allowBridge, false); awaitInvalidPolicy();
  function awaitInvalidPolicy() { assert.throws(() => normalizeNavigationPolicy({ mode: 'SAFE', allowTower: true }), error => error.code === 'INVALID_POLICY'); }
});

test('resource leases protect reserved quantities and prevent concurrent scaffold consumption', () => {
  const reservations = createResourceReservationService(); const inventory = [{ name: 'dirt', count: 12 }]; const taskOutput = reservations.protect({ ownerType: 'TASK', ownerId: 'task-1', botId: 'bot1', item: 'dirt', count: 8, inventory, reason: 'TASK_OUTPUT' }); assert.equal(reservations.available({ botId: 'bot1', item: 'dirt', inventory }), 4); assert.throws(() => reservations.reserve({ sessionId: 'two', botId: 'bot1', item: 'dirt', count: 5, inventory }), error => error.code === 'SCAFFOLD_RESOURCE_UNAVAILABLE'); const first = reservations.reserve({ sessionId: 'one', botId: 'bot1', item: 'dirt', count: 4, inventory, reason: 'NAVIGATION_SCAFFOLD' }); const used = reservations.commit({ leaseId: first.id, count: 1 }); assert.equal(used.used, 1); reservations.release({ leaseId: first.id }); reservations.release({ leaseId: taskOutput.id }); assert.equal(reservations.available({ botId: 'bot1', item: 'dirt', inventory }), 12);
});

test('partial reservation transfer moves only actual help output and releases the remainder', () => {
  const reservations = createResourceReservationService(); const original = reservations.reserve({ ownerType: 'TASK', ownerId: 'task', botId: 'bot1', item: 'stone', count: 64, inventory: [], reason: 'TASK_OUTPUT', allowUnbacked: true }); const result = reservations.splitTransfer({ leaseId: original.id, transferCount: 10, ownerType: 'HELP', ownerId: 'contribution', sessionId: 'help-session', reason: 'HELP_OUTPUT' }); assert.equal(result.transferred.reserved, 10); assert.equal(result.transferred.reason, 'HELP_OUTPUT'); assert.equal(result.released.reserved, 54); assert.equal(result.released.status, 'RELEASED');
});

test('true stuck movement is confirmed, replanned, and resumes without retrying forever', async () => {
  let attempts = 0; const context = setup({ navigate: async ({ input, context: capabilityContext, state }) => { attempts++; if (attempts === 1) return new Promise((_resolve, reject) => capabilityContext.signal.addEventListener('abort', () => reject(capabilityContext.signal.reason), { once: true })); state[capabilityContext.botId] = { ...input.target }; return {}; } }); const events = []; context.events.subscribe('navigation.stuck.detected', event => { events.push(event.payload); }); const result = await context.service.moveTo({ botId: 'bot1', target: { x: 4, y: 64, z: 0 }, timeout: 2_000, source: 'TASK', policy: { sampleIntervalMs: 50, stuckTimeoutMs: 500, confirmationSamples: 1, maxRecoveryAttempts: 2, maxReplans: 2 } }); assert.equal(result.status, 'ARRIVED'); assert.equal(attempts, 2); assert.equal(events.length, 1); assert.ok(context.calls.stopped.length >= 1);
});

test('explicit scaffolding leases only preferred unreserved blocks and is released after navigation', async () => {
  const reservations = createResourceReservationService(); const context = setup({ reservations, inventory: { bot1: [{ name: 'stone', count: 20 }, { name: 'dirt', count: 4 }] } }); const result = await context.service.moveTo({ botId: 'bot1', target: { x: 3, y: 64, z: 0 }, timeout: 1_000, source: 'TASK', policy: { allowPlace: true, allowScaffolding: true, allowTower: true, maxScaffoldBlocks: 3, scaffoldPreference: ['dirt'] } }); assert.equal(result.status, 'ARRIVED'); const leases = reservations.reservationsForBot('bot1'); assert.equal(leases.length, 1); assert.equal(leases[0].item, 'dirt'); assert.equal(leases[0].status, 'RELEASED');
});

test('pillar recovery verifies and records a leased scaffold only after replan budget is exhausted', async () => {
  let attempts = 0; const reservations = createResourceReservationService(); const context = setup({ reservations, inventory: { bot1: [{ name: 'dirt', count: 3 }] }, navigate: async ({ input, context: capabilityContext, state }) => { attempts++; if (attempts === 1) return new Promise((_resolve, reject) => capabilityContext.signal.addEventListener('abort', () => reject(capabilityContext.signal.reason), { once: true })); state[capabilityContext.botId] = { ...input.target }; return {}; }, pillar: () => ({ position: { x: 0, y: 64, z: 0 }, verified: true }) }); const result = await context.service.moveTo({ botId: 'bot1', target: { x: 4, y: 66, z: 0 }, timeout: 2_000, source: 'TASK', policy: { allowPlace: true, allowScaffolding: true, allowTower: true, maxScaffoldBlocks: 2, maxReplans: 0, maxRecoveryAttempts: 2, sampleIntervalMs: 50, stuckTimeoutMs: 500, confirmationSamples: 1 } }); assert.equal(result.status, 'ARRIVED'); assert.equal(context.service.scaffoldLedger.forSession(result.sessionId).length, 1); assert.equal(reservations.reservationsForBot('bot1')[0].used, 1);
});

function deferredNavigation() { const pending = []; return { navigate: ({ input, context, state }) => new Promise(resolveMove => pending.push(() => { state[context.botId] = { ...input.target }; resolveMove({}); })), resolveAll: () => pending.splice(0).forEach(resolveMove => resolveMove()) }; }
async function waitFor(predicate) { for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await new Promise(resolveWait => setTimeout(resolveWait, 5)); } throw new Error('Navigation condition did not complete'); }
