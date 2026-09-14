import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/event-bus.js';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createExpansionService, createTerritoryService, validateExpansion } from '../src/territory/index.js';

const proposal = { action: 'EXPAND_TERRITORY', direction: 'north-east', radiusIncrease: 180, reason: 'Iron supply is below reserve target.', priority: 'HIGH', source: 'LLM', targetResource: 'iron_ore', worldKey: 'localhost:25565', dimension: 'overworld', origin: { x: 0, y: 64, z: 0 } };
const context = { resourceAvailable: true, food: 64, availableBots: 3, availableGuards: 1, routeAvailable: true, dangerLevel: 0.25, warehouseUtilization: 0.7, estimatedCost: 120, availableBudget: 200 };

function setup(policy) { const events = new EventBus(); const territory = createTerritoryService({ repository: new MemoryRepository(), events }); return { events, territory, expansion: createExpansionService({ repository: new MemoryRepository(), territory, events, policy }) }; }

test('deterministic validator approves a safe LLM proposal without trusting its source', () => {
  const decision = validateExpansion(proposal, context); assert.equal(decision.outcome, 'APPROVED'); assert.equal(decision.checks.length, 9); assert.equal(decision.blockers.length, 0);
});

test('deterministic validator reports every failed safety gate', () => {
  const decision = validateExpansion({ ...proposal, radiusIncrease: 600 }, { ...context, resourceAvailable: false, food: 5, availableBots: 1, availableGuards: 0, routeAvailable: false, dangerLevel: 0.9, warehouseUtilization: 0.95, estimatedCost: 300 });
  assert.equal(decision.outcome, 'REJECTED'); assert.deepEqual(decision.blockers.map(item => item.code), ['TARGET_RESOURCE_UNAVAILABLE', 'INSUFFICIENT_FOOD', 'INSUFFICIENT_BOTS', 'INSUFFICIENT_DEFENSE', 'ROUTE_UNAVAILABLE', 'DANGER_TOO_HIGH', 'WAREHOUSE_CAPACITY_LOW', 'EXPANSION_COST_TOO_HIGH', 'EXPANSION_TOO_LARGE']);
});

test('large safe expansion remains blocked until explicit human approval', async () => {
  const { expansion } = setup(); const pending = await expansion.propose({ ...proposal, radiusIncrease: 300, context }); assert.equal(pending.status, 'APPROVAL_REQUIRED'); await assert.rejects(expansion.apply(pending.id), error => error.code === 'CONFLICT'); const approved = await expansion.approve(pending.id, { approvedBy: 'owner' }); assert.equal(approved.status, 'APPROVED'); assert.equal(approved.approval.approvedBy, 'owner');
});

test('approved expansion creates an asymmetric frontier exactly once', async () => {
  const { expansion, territory } = setup(); const approved = await expansion.propose({ ...proposal, context }); const applied = await expansion.apply(approved.id); assert.equal(applied.proposal.status, 'APPLIED'); assert.equal(applied.region.type, 'FRONTIER'); assert.equal(applied.region.resources[0], 'iron_ore'); assert.ok(applied.region.center.x > 0 && applied.region.center.z < 0); assert.equal((await territory.list()).length, 1); await assert.rejects(expansion.apply(approved.id), error => error.code === 'CONFLICT');
});

test('revalidation can recover a rejected proposal after capacity changes', async () => {
  const { expansion } = setup(); const rejected = await expansion.propose({ ...proposal, context: { ...context, food: 0 } }); assert.equal(rejected.status, 'REJECTED'); const approved = await expansion.revalidate(rejected.id, context); assert.equal(approved.status, 'APPROVED'); assert.equal(approved.version, 2); assert.equal((await expansion.status()).approved, 1);
});

test('outpost proposal creates an OUTPOST region after approval', async () => {
  const { expansion } = setup(); const approved = await expansion.propose({ ...proposal, needsOutpost: true, context }); assert.equal((await expansion.apply(approved.id)).region.type, 'OUTPOST');
});
