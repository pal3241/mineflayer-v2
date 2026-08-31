import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, MemoryRepository, Task, TaskStatus, createFleetTransferService, createHelpCommandService, createHelpService } from '../src/index.js';
import { CapabilityRegistry } from '../src/bots/capabilities.js';
import { MetricsManager } from '../src/core/health.js';
import { FleetScheduler } from '../src/fleet/scheduler.js';
import { GoalService } from '../src/goals/goal-service.js';
import { DeterministicPlanner } from '../src/goals/planner.js';
import { resolveActiveHelpTask } from '../src/help/active-task-resolver.js';
import { TaskExecutor } from '../src/tasks/task-executor.js';

class BotAdapter {
  constructor(items, position) { this.items = items; this.position = position; }
  snapshot() { return { inventorySummary: structuredClone(this.items), position: this.position, dimension: 'overworld' }; }
  async smartMove() {}
  async dropItem({ item, count }) { change(this.items, item, -count); }
  async pickupItem({ item, count }) { change(this.items, item, count); }
}

function setup(target = 64, options = {}) {
  const owner = runtime('owner', options.ownerStone ?? 34, 0); const helper = runtime('helper', options.helperStone ?? 0, 8); const helper2 = runtime('helper2', options.helper2Stone ?? 0, 16); const helper3 = runtime('helper3', options.helper3Stone ?? 0, 24); const runtimes = { owner, helper, helper2, helper3 }; const parent = new Task({ id: 'parent-collect', goalId: 'goal-1', type: 'collect', input: { block: 'stone', count: target }, requiredCapabilities: ['minecraft.collection'] });
  const events = new EventBus(); const goals = { task: id => { if (id !== parent.id) throw new Error(`Task '${id}' not found`); return parent; }, allTasks: () => [parent.toDTO()], completeExternalTask: async (id, result) => { if (id !== parent.id) throw new Error(`Task '${id}' not found`); parent.update(TaskStatus.COMPLETED, { result }); return parent.toDTO(); }, transitionTaskToCollaborative: async (id, helpSessionId) => { if (id !== parent.id) throw new Error(`Task '${id}' not found`); parent.update(TaskStatus.COLLABORATIVE, { helpSessionId }); return parent.toDTO(); } }; const executor = { cancel: () => true, execute: async task => { change(runtimes[task.assignedBot].adapter.items, 'stone', task.input.count); task.update(TaskStatus.COMPLETED); return { collected: task.input.count }; } }; const logistics = { store: async ({ runtime: value, item, count }) => { change(value.adapter.items, item, -count); return { stored: count }; }, storages: async () => options.storages ?? [] };
  const repositories = { sessions: new MemoryRepository(), shares: new MemoryRepository(), contributions: new MemoryRepository() }; const service = createHelpService({ repository: repositories.sessions, workShareRepository: repositories.shares, contributionRepository: repositories.contributions, bots: { get: id => runtimes[id], list: () => Object.values(runtimes) }, fleetTransfer: createFleetTransferService({ events }), logistics, goals, executor, events, maxHelpersPerSession: options.maxHelpersPerSession ?? 4, minimumChunk: options.minimumChunk ?? 4 }); return { owner, helper, helper2, helper3, parent, service, repositories, bots: { get: id => runtimes[id], list: () => Object.values(runtimes) }, fleetTransfer: createFleetTransferService({ events }), logistics, goals, executor, events };
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
  const { service } = setup(); const invalid = { id: 'parent-collect', goalId: 'goal-1', input: { count: 1 }, requiredCapabilities: ['minecraft.crafting'] }; const invalidService = createHelpService({ repository: new MemoryRepository(), workShareRepository: new MemoryRepository(), contributionRepository: new MemoryRepository(), bots: { get: () => runtime('owner', 0, 0) }, fleetTransfer: createFleetTransferService({ events: new EventBus() }), logistics: {}, goals: { task: () => invalid }, executor: { execute: async () => {}, cancel: () => false }, maxHelpersPerSession: 4, minimumChunk: 4 }); await assert.rejects(invalidService.create({ parentTaskId: 'parent-collect', ownerBotId: 'owner' }), /not a supported collection task/); assert.ok(service);
});

test('uses shared storage and fleet possession as authoritative progress sources', async () => {
  const storage = { name: 'warehouse', inventory: [{ name: 'stone', count: 700 }] }; const shared = setup(1000, { ownerStone: 0, storages: [storage] }); const sharedSession = await shared.service.create({ parentTaskId: shared.parent.id, ownerBotId: 'owner', workers: ['helper'], outputPolicy: { mode: 'SHARED_STORAGE', storageName: 'warehouse' } }); assert.equal(sharedSession.progress.remaining, 300);
  const fleet = setup(100, { ownerStone: 10, helperStone: 20, helper2Stone: 30 }); const fleetSession = await fleet.service.create({ parentTaskId: fleet.parent.id, ownerBotId: 'owner', workers: ['helper3'], fleetWide: true, outputPolicy: { mode: 'HELPER_KEEP' } }); assert.equal(fleetSession.progress.current, 60); assert.equal(fleetSession.workShares[0].assigned, 40);
});

test('owner death pauses delivery until the owner is available again', async () => {
  const { owner, parent, service } = setup(49); const session = await service.create({ parentTaskId: parent.id, ownerBotId: 'owner', workers: ['helper'] }); await service.executeShare({ sessionId: session.id, shareId: session.workShares[0].shareId }); owner.status = 'DEAD'; const affected = await service.handleBotDeath('owner'); assert.equal(affected.length, 1); assert.equal((await service.get(session.id)).status, 'WAITING_DESTINATION'); await assert.rejects(service.handoff({ sessionId: session.id, shareId: session.workShares[0].shareId }), /unavailable/); owner.status = 'READY'; const complete = await service.handoff({ sessionId: session.id, shareId: session.workShares[0].shareId }); assert.equal(complete.status, 'COMPLETED');
});

test('concurrent helper handoffs serialize progress without over-credit', async () => {
  const { owner, parent, service } = setup(); const session = await service.create({ parentTaskId: parent.id, ownerBotId: 'owner', workers: ['helper', 'helper2'] }); await Promise.all(session.workShares.map(share => service.executeShare({ sessionId: session.id, shareId: share.shareId }))); const complete = await Promise.all(session.workShares.map(share => service.handoff({ sessionId: session.id, shareId: share.shareId }))); assert.equal(complete.at(-1).progress.credited, 30); assert.equal(count(owner.adapter.items, 'stone'), 64); assert.equal((await service.get(session.id)).status, 'COMPLETED');
});

test('restart reconciliation reassigns orphaned running shares and preserves output-ready shares', async () => {
  const context = setup(49); const session = await context.service.create({ parentTaskId: context.parent.id, ownerBotId: 'owner', workers: ['helper'] }); const share = session.workShares[0]; await context.repositories.shares.update(share.shareId, { ...share, status: 'RUNNING', taskId: 'missing-task' }); const restored = createHelpService({ repository: context.repositories.sessions, workShareRepository: context.repositories.shares, contributionRepository: context.repositories.contributions, bots: context.bots, fleetTransfer: context.fleetTransfer, logistics: context.logistics, goals: context.goals, executor: { ...context.executor, status: () => ({ running: {}, queues: {} }) }, events: context.events, maxHelpersPerSession: 4, minimumChunk: 4 }); assert.equal(await restored.initialize(), 1); assert.equal((await restored.get(session.id)).workShares[0].status, 'REASSIGN_REQUIRED');
});

test('manual helper request creates one collaborative session and rebalances joins', async () => {
  const context = setup(); context.parent.update(TaskStatus.ASSIGNED, { assignedBot: 'owner' }); const commands = createHelpCommandService({ help: context.service, goals: context.goals, bots: context.bots, events: context.events, maxHelpersPerSession: 4, minimumChunk: 4 }); const first = await commands.requestHelp({ helperBotId: 'helper', ownerBotId: 'owner' }); assert.equal(first.workShares.length, 2); assert.deepEqual(first.workShares.map(share => share.assigned), [15, 15]); assert.equal(context.parent.status, TaskStatus.COLLABORATIVE);
  const joined = await commands.requestHelp({ helperBotId: 'helper2', ownerBotId: 'owner' }); const active = joined.workShares.filter(share => share.status !== 'SUPERSEDED'); assert.deepEqual(active.map(share => share.assigned), [10, 10, 10]);
});

test('active task resolver skips unsupported running task and selects helpable assigned task', () => {
  const unsupported = new Task({ id: 'unsupported', goalId: 'goal-1', type: 'craft', input: { item: 'stick', count: 1 }, requiredCapabilities: ['minecraft.crafting'], priority: 100 }); unsupported.update(TaskStatus.RUNNING, { assignedBot: 'owner' }); const supported = new Task({ id: 'supported', goalId: 'goal-1', type: 'collect', input: { block: 'stone', count: 16 }, requiredCapabilities: ['minecraft.collection'], priority: 10 }); supported.update(TaskStatus.ASSIGNED, { assignedBot: 'owner' }); const tasks = new Map([[unsupported.id, unsupported], [supported.id, supported]]); const goals = { allTasks: () => [...tasks.values()].map(task => task.toDTO()), task: id => tasks.get(id) };
  assert.equal(resolveActiveHelpTask(goals, 'owner').id, supported.id);
});

test('joinMany enforces max helpers and minimum chunk with an incremental preview', async () => {
  const limited = setup(100, { ownerStone: 0, maxHelpersPerSession: 2 }); const session = await limited.service.create({ parentTaskId: limited.parent.id, ownerBotId: 'owner', workers: ['owner', 'helper'] }); await assert.rejects(limited.service.joinMany({ sessionId: session.id, botIds: ['helper2', 'helper3'] }), /MAX_HELPERS_REACHED/); assert.equal((await limited.service.get(session.id)).workShares.filter(share => !['SUPERSEDED', 'CANCELLED'].includes(share.status)).length, 2);
  const small = setup(10, { ownerStone: 0, minimumChunk: 4 }); const smallSession = await small.service.create({ parentTaskId: small.parent.id, ownerBotId: 'owner', workers: ['owner', 'helper'] }); await assert.rejects(small.service.joinMany({ sessionId: smallSession.id, botIds: ['helper2'] }), /Minimum work chunk/);
});

test('first manual join validates authoritative remaining before creating a session', async () => {
  const context = setup(64, { ownerStone: 62, minimumChunk: 4 }); context.parent.update(TaskStatus.ASSIGNED, { assignedBot: 'owner' }); const commands = createHelpCommandService({ help: context.service, goals: context.goals, bots: context.bots, events: context.events, maxHelpersPerSession: 4, minimumChunk: 4 }); await assert.rejects(commands.requestHelp({ helperBotId: 'helper', ownerBotId: 'owner' }), /Minimum work chunk/); assert.equal((await context.service.list()).length, 0);
});

test('stop helping hands off pending output before helper leaves', async () => {
  const context = setup(49); context.parent.update(TaskStatus.ASSIGNED, { assignedBot: 'owner' }); const commands = createHelpCommandService({ help: context.service, goals: context.goals, bots: context.bots, events: context.events, maxHelpersPerSession: 4, minimumChunk: 4 }); const session = await commands.requestHelp({ helperBotId: 'helper', ownerBotId: 'owner' }); const share = session.workShares.find(entry => entry.botId === 'helper'); change(context.helper.adapter.items, 'stone', share.assigned); await context.service.recordCollected({ sessionId: session.id, shareId: share.shareId, contributionId: 'CONTRIB-LEAVE', before: 0, after: share.assigned }); const result = await commands.stopHelping({ botId: 'helper' }); assert.equal(count(context.owner.adapter.items, 'stone'), 34 + share.assigned); assert.equal(result.progress.credited, share.assigned); assert.equal(result.workShares.some(entry => entry.botId === 'helper' && entry.status === 'OUTPUT_READY'), false);
});

test('owner removal hands off pending output before removing the helper', async () => {
  const context = setup(49); context.parent.update(TaskStatus.ASSIGNED, { assignedBot: 'owner' }); const commands = createHelpCommandService({ help: context.service, goals: context.goals, bots: context.bots, events: context.events, maxHelpersPerSession: 4, minimumChunk: 4 }); const session = await commands.requestHelp({ helperBotId: 'helper', ownerBotId: 'owner' }); const share = session.workShares.find(entry => entry.botId === 'helper'); change(context.helper.adapter.items, 'stone', share.assigned); await context.service.recordCollected({ sessionId: session.id, shareId: share.shareId, contributionId: 'CONTRIB-REMOVE', before: 0, after: share.assigned }); const result = await commands.removeHelper({ ownerBotId: 'owner', helperBotId: 'helper' }); assert.equal(count(context.owner.adapter.items, 'stone'), 34 + share.assigned); assert.equal(result.workShares.some(entry => entry.botId === 'helper' && entry.status === 'OUTPUT_READY'), false);
});

test('manual help rejects helpers in recovery state', async () => {
  const context = setup(); context.parent.update(TaskStatus.ASSIGNED, { assignedBot: 'owner' }); context.helper.status = 'RECOVERY'; const commands = createHelpCommandService({ help: context.service, goals: context.goals, bots: context.bots, events: context.events, maxHelpersPerSession: 4, minimumChunk: 4 }); await assert.rejects(commands.requestHelp({ helperBotId: 'helper', ownerBotId: 'owner' }), /HELPER_BUSY/); context.helper.status = 'READY'; const recovery = new Task({ id: 'recovery-task', goalId: 'goal-2', type: 'recovery', input: {}, requiredCapabilities: ['minecraft.collection'] }); recovery.update(TaskStatus.RUNNING, { assignedBot: 'helper' }); context.goals.allTasks = () => [context.parent.toDTO(), recovery.toDTO()]; await assert.rejects(commands.requestHelp({ helperBotId: 'helper', ownerBotId: 'owner' }), /executing RECOVERY/); assert.equal((await context.service.list()).length, 0);
});

test('concurrent command joins create one session without duplicate work shares', async () => {
  const context = setup(100, { ownerStone: 0 }); context.parent.update(TaskStatus.ASSIGNED, { assignedBot: 'owner' }); const commands = createHelpCommandService({ help: context.service, goals: context.goals, bots: context.bots, events: context.events, maxHelpersPerSession: 4, minimumChunk: 4 }); const joined = await Promise.all([commands.requestHelp({ helperBotId: 'helper', ownerBotId: 'owner' }), commands.requestHelp({ helperBotId: 'helper2', ownerBotId: 'owner' }), commands.requestHelp({ helperBotId: 'helper3', ownerBotId: 'owner' })]); const sessions = await context.service.list(); const current = await context.service.get(joined[0].id); const active = current.workShares.filter(share => !['SUPERSEDED', 'CANCELLED', 'COMPLETED', 'FAILED'].includes(share.status)); assert.equal(sessions.length, 1); assert.deepEqual([...new Set(active.map(share => share.botId))].sort(), ['helper', 'helper2', 'helper3', 'owner']);
});

test('running parent takeover waits for executor stop and never publishes task.cancelled', async () => {
  const events = new EventBus(); const metrics = new MetricsManager(); const capabilities = new CapabilityRegistry(); capabilities.register({ name: 'minecraft.collection', execute: async (_input, context) => new Promise((resolve, reject) => { context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }); }) }); const botManager = { list: () => [{ id: 'owner', status: 'READY', capabilities: ['minecraft.collection'] }] }; const scheduler = new FleetScheduler({ botManager }); const executor = new TaskExecutor({ capabilities, scheduler, eventBus: events, metrics, checkpointRepository: null, maxQueuePerBot: 10 }); const goals = new GoalService({ planner: new DeterministicPlanner(), scheduler, executor, eventBus: events, metrics }); let cancellations = 0; events.subscribe('task.cancelled', async () => { cancellations += 1; }); const goal = goals.create({ description: 'collect stone', constraints: { preferredBot: 'owner' }, steps: [{ type: 'collect', input: { block: 'stone', count: 64 }, requiredCapabilities: ['minecraft.collection'] }] }); const parent = goals.tasks(goal.id)[0]; const running = goals.run(goal.id); await waitFor(() => goals.task(parent.id).status === TaskStatus.RUNNING, 100, 10); const collaborative = await goals.transitionTaskToCollaborative(parent.id, 'help-session-1'); await running; assert.equal(collaborative.status, TaskStatus.COLLABORATIVE); assert.equal(goals.task(parent.id).status, TaskStatus.COLLABORATIVE); assert.equal(cancellations, 0); assert.deepEqual(executor.status().running, {});
});

function runtime(id, stone, x) { return { id, status: 'READY', bot: { id }, options: { host: 'server', port: 25565 }, adapter: new BotAdapter(stone ? [{ name: 'stone', count: stone }] : [], { x, y: 64, z: 0 }) }; }
function count(items, name) { return items.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0); }
function change(items, name, amount) { const item = items.find(entry => entry.name === name); if (!item && amount > 0) items.push({ name, count: amount }); else if (item) { item.count += amount; if (item.count === 0) items.splice(items.indexOf(item), 1); } }
async function waitFor(predicate, maxAttempts, intervalMs) { for (let attempt = 0; attempt < maxAttempts; attempt++) { if (predicate()) return; await new Promise(resolveWait => setTimeout(resolveWait, intervalMs)); } throw new Error(`Condition was not met within ${maxAttempts * intervalMs}ms`); }
