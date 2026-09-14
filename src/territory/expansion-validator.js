import { ValidationError } from '../core/errors.js';

export const EXPANSION_DIRECTIONS = Object.freeze({ NORTH: { x: 0, z: -1 }, NORTH_EAST: { x: 1, z: -1 }, EAST: { x: 1, z: 0 }, SOUTH_EAST: { x: 1, z: 1 }, SOUTH: { x: 0, z: 1 }, SOUTH_WEST: { x: -1, z: 1 }, WEST: { x: -1, z: 0 }, NORTH_WEST: { x: -1, z: -1 } });

export const DEFAULT_EXPANSION_POLICY = Object.freeze({ minFood: 32, minBots: 2, minGuards: 1, maxDanger: 0.6, maxWarehouseUtilization: 0.9, maxRadiusIncrease: 512, humanApprovalRadius: 256 });

export function normalizeExpansionProposal(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Expansion proposal must be an object');
  const action = String(input.action ?? 'EXPAND_TERRITORY').trim().toUpperCase();
  if (action !== 'EXPAND_TERRITORY') throw new ValidationError("Expansion action must be 'EXPAND_TERRITORY'");
  const direction = normalizeDirection(input.direction); const radiusIncrease = finite(input.radiusIncrease, 'radiusIncrease');
  if (radiusIncrease < 1 || radiusIncrease > 2048) throw new ValidationError('Expansion radiusIncrease must be between 1 and 2048 blocks');
  const priority = String(input.priority ?? 'NORMAL').trim().toUpperCase(); if (!['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority)) throw new ValidationError('Expansion priority is invalid');
  const source = String(input.source ?? 'MANUAL').trim().toUpperCase(); if (!['LLM', 'MANUAL', 'SYSTEM'].includes(source)) throw new ValidationError('Expansion source is invalid');
  const reason = safeText(input.reason, 500, 'reason'); const targetResource = input.targetResource == null ? null : safeToken(input.targetResource, 'targetResource');
  const confidence = input.confidence == null ? null : finite(input.confidence, 'confidence'); if (confidence != null && (confidence < 0 || confidence > 1)) throw new ValidationError('Expansion confidence must be between 0 and 1');
  return { action, direction, radiusIncrease, reason, priority, source, targetResource, needsOutpost: Boolean(input.needsOutpost), needsWarehouse: Boolean(input.needsWarehouse), confidence, worldKey: worldKey(input.worldKey), dimension: safeToken(input.dimension ?? 'overworld', 'dimension'), origin: position(input.origin) };
}

export function validateExpansion(proposalInput, contextInput, policyInput = {}) {
  const proposal = normalizeExpansionProposal(proposalInput); const context = normalizeContext(contextInput); const policy = normalizePolicy(policyInput); const checks = [];
  check('RESOURCE_AVAILABLE', !proposal.targetResource || context.resourceAvailable, 'TARGET_RESOURCE_UNAVAILABLE', { targetResource: proposal.targetResource });
  check('FOOD_SUFFICIENT', context.food >= policy.minFood, 'INSUFFICIENT_FOOD', { actual: context.food, required: policy.minFood });
  check('BOTS_SUFFICIENT', context.availableBots >= policy.minBots, 'INSUFFICIENT_BOTS', { actual: context.availableBots, required: policy.minBots });
  check('GUARDS_SUFFICIENT', context.availableGuards >= policy.minGuards, 'INSUFFICIENT_DEFENSE', { actual: context.availableGuards, required: policy.minGuards });
  check('ROUTE_AVAILABLE', context.routeAvailable, 'ROUTE_UNAVAILABLE');
  check('DANGER_ACCEPTABLE', context.dangerLevel <= policy.maxDanger, 'DANGER_TOO_HIGH', { actual: context.dangerLevel, maximum: policy.maxDanger });
  check('WAREHOUSE_CAPACITY', context.warehouseUtilization <= policy.maxWarehouseUtilization, 'WAREHOUSE_CAPACITY_LOW', { actual: context.warehouseUtilization, maximum: policy.maxWarehouseUtilization });
  check('COST_ACCEPTABLE', context.estimatedCost <= context.availableBudget, 'EXPANSION_COST_TOO_HIGH', { cost: context.estimatedCost, budget: context.availableBudget });
  check('SIZE_ACCEPTABLE', proposal.radiusIncrease <= policy.maxRadiusIncrease, 'EXPANSION_TOO_LARGE', { actual: proposal.radiusIncrease, maximum: policy.maxRadiusIncrease });
  const blockers = checks.filter(item => !item.passed).map(item => ({ code: item.failureCode, details: item.details })); const approvalRequired = blockers.length === 0 && proposal.radiusIncrease >= policy.humanApprovalRadius;
  return { outcome: blockers.length ? 'REJECTED' : approvalRequired ? 'APPROVAL_REQUIRED' : 'APPROVED', approved: blockers.length === 0 && !approvalRequired, approvalRequired, blockers, checks, policy, evaluatedAt: new Date().toISOString() };
  function check(name, passed, failureCode, details = undefined) { checks.push({ name, passed: Boolean(passed), failureCode: passed ? null : failureCode, details }); }
}

function normalizeContext(input) { if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Expansion validation context must be an object'); return { resourceAvailable: input.resourceAvailable !== false, food: nonNegative(input.food, 'food'), availableBots: integer(input.availableBots, 'availableBots'), availableGuards: integer(input.availableGuards, 'availableGuards'), routeAvailable: input.routeAvailable === true, dangerLevel: ratio(input.dangerLevel, 'dangerLevel'), warehouseUtilization: ratio(input.warehouseUtilization, 'warehouseUtilization'), estimatedCost: nonNegative(input.estimatedCost, 'estimatedCost'), availableBudget: nonNegative(input.availableBudget, 'availableBudget') }; }
function normalizePolicy(input) { const result = { ...DEFAULT_EXPANSION_POLICY, ...input }; result.minFood = nonNegative(result.minFood, 'policy.minFood'); result.minBots = integer(result.minBots, 'policy.minBots'); result.minGuards = integer(result.minGuards, 'policy.minGuards'); result.maxDanger = ratio(result.maxDanger, 'policy.maxDanger'); result.maxWarehouseUtilization = ratio(result.maxWarehouseUtilization, 'policy.maxWarehouseUtilization'); result.maxRadiusIncrease = positive(result.maxRadiusIncrease, 'policy.maxRadiusIncrease'); result.humanApprovalRadius = positive(result.humanApprovalRadius, 'policy.humanApprovalRadius'); return result; }
function normalizeDirection(value) { const key = String(value ?? '').trim().toUpperCase().replace(/[ -]+/g, '_'); const aliases = { N: 'NORTH', NE: 'NORTH_EAST', E: 'EAST', SE: 'SOUTH_EAST', S: 'SOUTH', SW: 'SOUTH_WEST', W: 'WEST', NW: 'NORTH_WEST' }; const result = aliases[key] ?? key; if (!EXPANSION_DIRECTIONS[result]) throw new ValidationError('Expansion direction is invalid'); return result; }
function finite(value, field) { const number = Number(value); if (!Number.isFinite(number)) throw new ValidationError(`Expansion ${field} must be finite`); return number; }
function nonNegative(value, field) { const number = finite(value, field); if (number < 0) throw new ValidationError(`Expansion ${field} cannot be negative`); return number; }
function positive(value, field) { const number = finite(value, field); if (number <= 0) throw new ValidationError(`Expansion ${field} must be positive`); return number; }
function integer(value, field) { const number = nonNegative(value, field); if (!Number.isInteger(number)) throw new ValidationError(`Expansion ${field} must be an integer`); return number; }
function ratio(value, field) { const number = finite(value, field); if (number < 0 || number > 1) throw new ValidationError(`Expansion ${field} must be between 0 and 1`); return number; }
function position(value) { if (!value || ![value.x, value.y, value.z].every(item => Number.isFinite(Number(item)))) throw new ValidationError('Expansion origin requires finite x, y, z'); return { x: Number(value.x), y: Number(value.y), z: Number(value.z) }; }
function worldKey(value) { const key = String(value ?? '').trim().toLowerCase(); if (!/^[a-z0-9.-]+:[1-9][0-9]{0,4}$/.test(key) || Number(key.slice(key.lastIndexOf(':') + 1)) > 65535) throw new ValidationError('Expansion worldKey must use host:port'); return key; }
function safeText(value, maximum, field) { const text = String(value ?? '').trim(); if (!text || text.length > maximum || /[\u0000-\u001f]/.test(text)) throw new ValidationError(`Expansion ${field} is invalid`); return text; }
function safeToken(value, field) { const text = String(value ?? '').trim().toLowerCase(); if (!/^[a-z0-9_:.-]{1,80}$/.test(text)) throw new ValidationError(`Expansion ${field} is invalid`); return text; }
