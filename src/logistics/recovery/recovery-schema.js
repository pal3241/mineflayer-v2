import { ValidationError } from '../../core/errors.js';

export const RECOVERY_DECISIONS = Object.freeze(['REQUIRED', 'OPTIONAL', 'IGNORE']);
export const RECOVERY_STATES = Object.freeze([
  'DETECTED',
  'PENDING',
  'EVALUATING',
  'ASSIGNED',
  'TRAVELLING',
  'SEARCHING',
  'COLLECTING',
  'VERIFYING',
  'RECOVERED',
  'PARTIAL',
  'PARTIAL_RECONCILED',
  'FAILED',
  'EXPIRED',
  'EXPIRED_RECONCILED',
  'CANCELLED',
  'UNRECOVERABLE',
  'REASSIGN_REQUIRED'
]);

export const RECOVERY_FAILURE_CODES = Object.freeze([
  'ITEMS_DESPAWNED',
  'AREA_UNREACHABLE',
  'DANGER_TOO_HIGH',
  'RECOVERY_BOT_DIED',
  'RECOVERY_TIMEOUT',
  'PARTIAL_RECOVERY',
  'ITEMS_MISSING',
  'UNKNOWN_DEATH_LOCATION',
  'DIMENSION_UNAVAILABLE',
  'PATHFINDER_FAILED',
  'INVENTORY_FULL',
  'MAX_RECOVERY_ATTEMPTS',
  'VOID_DEATH',
  'LAVA_LOSS',
  'FIRE_LOSS',
  'RECOVERY_NOT_WORTH_COST'
]);

const STATE_SET = new Set(RECOVERY_STATES);
const FAILURE_CODE_SET = new Set(RECOVERY_FAILURE_CODES);
const DECISION_SET = new Set(RECOVERY_DECISIONS);

export function createRecoveryConfig(input) {
  const source = optionalRecord(input, 'Recovery config');
  const config = {
    enabled: optionalBoolean(source.enabled, true, 'Recovery enabled'),
    maxAttempts: optionalInteger(source.maxAttempts, 3, 1, 10, 'Recovery maxAttempts'),
    minScore: optionalNumber(source.minScore, 40, 0, 100, 'Recovery minScore'),
    optionalScore: optionalNumber(source.optionalScore, 20, 0, 100, 'Recovery optionalScore'),
    urgentScore: optionalNumber(source.urgentScore, 70, 0, 100, 'Recovery urgentScore'),
    despawnTicks: optionalInteger(source.despawnTicks, 6000, 1200, 72_000, 'Recovery despawnTicks'),
    safetyMarginTicks: optionalInteger(source.safetyMarginTicks, 600, 0, 71_999, 'Recovery safetyMarginTicks'),
    maxDistance: optionalNumber(source.maxDistance, 2000, 16, 100_000, 'Recovery maxDistance'),
    dangerLimit: optionalNumber(source.dangerLimit, 0.75, 0, 1, 'Recovery dangerLimit')
  };
  if (config.optionalScore > config.minScore) throw new ValidationError('Recovery optionalScore must not exceed minScore', { optionalScore: config.optionalScore, minScore: config.minScore });
  if (config.minScore > config.urgentScore) throw new ValidationError('Recovery minScore must not exceed urgentScore', { minScore: config.minScore, urgentScore: config.urgentScore });
  if (config.safetyMarginTicks >= config.despawnTicks) throw new ValidationError('Recovery safetyMarginTicks must be lower than despawnTicks', { safetyMarginTicks: config.safetyMarginTicks, despawnTicks: config.despawnTicks });
  return Object.freeze(config);
}

export function createDeathManifest(input, identity) {
  const source = requiredRecord(input, 'Death manifest input');
  const recordIdentity = requiredRecord(identity, 'Death manifest identity');
  const status = source.status === undefined ? 'DETECTED' : recoveryState(source.status, 'Death manifest status');
  const items = normalizeInventory(source.items, 'Death manifest items');
  return Object.freeze({
    id: identifier(recordIdentity.id, 'Death manifest id'),
    botId: identifier(source.botId, 'Death manifest botId'),
    worldKey: boundedString(source.worldKey, 1, 255, 'Death manifest worldKey'),
    dimension: boundedString(source.dimension, 1, 128, 'Death manifest dimension'),
    position: normalizePosition(source.position, 'Death manifest position'),
    items,
    relatedTransferId: optionalIdentifier(source.relatedTransferId, 'Death manifest relatedTransferId'),
    cause: optionalString(source.cause, 1, 255, 'Death manifest cause'),
    keepInventory: normalizeKeepInventory(source.keepInventory),
    status,
    createdAt: isoTimestamp(recordIdentity.createdAt, 'Death manifest createdAt')
  });
}

export function validateDeathManifest(input) {
  const source = requiredRecord(input, 'Death manifest');
  return createDeathManifest(source, { id: source.id, createdAt: source.createdAt });
}

export function mergeDeathInventory(input) {
  const source = requiredRecord(input, 'Death inventory sources');
  const snapshotSources = [
    ['lastKnownInventory', source.lastKnownInventory],
    ['runtimeInventory', source.runtimeInventory],
    ['eventInventory', source.eventInventory]
  ];
  const suppliedSnapshots = snapshotSources.filter(([, value]) => value !== undefined && value !== null);
  const hasTransferFallback = source.transferItems !== undefined && source.transferItems !== null;
  if (!suppliedSnapshots.length && !hasTransferFallback) throw new ValidationError('At least one death inventory source is required');
  const normalizedSnapshots = suppliedSnapshots.map(([name, value]) => [name, aggregateInventory(normalizeInventory(value, `Death inventory ${name}`), `Death inventory ${name}`)]);
  const snapshotHasItems = normalizedSnapshots.some(([, value]) => value.length > 0);
  const supplied = snapshotHasItems
    ? normalizedSnapshots
    : hasTransferFallback ? [['transferItems', aggregateInventory(normalizeInventory(source.transferItems, 'Death inventory transferItems'), 'Death inventory transferItems')]] : normalizedSnapshots;
  const items = new Map();
  for (const [name, value] of supplied) {
    for (const item of value) {
      const key = inventoryIdentity(item);
      const current = items.get(key);
      if (!current) {
        items.set(key, item);
        continue;
      }
      items.set(key, Object.freeze({
        ...current,
        count: Math.max(current.count, item.count),
        enchanted: current.enchanted || item.enchanted,
        unique: current.unique || item.unique
      }));
    }
  }
  return Object.freeze([...items.values()].sort(compareInventoryItems));
}

export function normalizeInventory(input, label) {
  if (!Array.isArray(input)) throw new ValidationError(`${label} must be an array`, { receivedType: valueType(input) });
  return Object.freeze(input.map((item, index) => normalizeInventoryItem(item, `${label}[${index}]`)));
}

export function normalizeInventoryItem(input, label) {
  const source = requiredRecord(input, label);
  const item = {
    name: itemName(source.name, `${label}.name`),
    count: positiveInteger(source.count, `${label}.count`),
    customName: optionalString(source.customName, 1, 255, `${label}.customName`),
    enchanted: optionalBoolean(source.enchanted, false, `${label}.enchanted`),
    unique: optionalBoolean(source.unique, false, `${label}.unique`),
    durability: optionalNullableInteger(source.durability, 0, 1_000_000, `${label}.durability`),
    nbtHash: optionalString(source.nbtHash, 1, 512, `${label}.nbtHash`)
  };
  return Object.freeze(item);
}

export function normalizeEvaluatedItem(input, label) {
  const source = requiredRecord(input, label);
  const normalized = normalizeInventoryItem(source, label);
  return Object.freeze({
    ...normalized,
    basePriority: enumValue(source.basePriority, new Set(['CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'TRASH']), `${label}.basePriority`),
    baseScore: finiteNumber(source.baseScore, 0, 100, `${label}.baseScore`),
    dynamicScore: finiteNumber(source.dynamicScore, 0, 100, `${label}.dynamicScore`),
    recoveryCost: finiteNumber(source.recoveryCost, 0, 100, `${label}.recoveryCost`),
    decision: recoveryDecision(source.decision, `${label}.decision`),
    scoreBreakdown: normalizeScoreBreakdown(source.scoreBreakdown, `${label}.scoreBreakdown`)
  });
}

export function normalizeRecoveryEvaluation(input) {
  const source = requiredRecord(input, 'Recovery evaluation');
  if (!Array.isArray(source.items)) throw new ValidationError('Recovery evaluation items must be an array');
  const items = Object.freeze(source.items.map((item, index) => normalizeEvaluatedItem(item, `Recovery evaluation items[${index}]`)));
  const decision = enumValue(source.decision, new Set(['RECOVER', 'URGENT_RECOVERY', 'DO_NOT_RECOVER']), 'Recovery evaluation decision');
  const shouldRecover = strictBoolean(source.shouldRecover, 'Recovery evaluation shouldRecover');
  if (shouldRecover !== (decision !== 'DO_NOT_RECOVER')) throw new ValidationError('Recovery evaluation decision and shouldRecover are inconsistent', { decision, shouldRecover });
  const blockedBy = normalizeStringArray(source.blockedBy, 'Recovery evaluation blockedBy');
  return Object.freeze({
    items,
    recoveryScore: finiteNumber(source.recoveryScore, 0, 100, 'Recovery evaluation recoveryScore'),
    decision,
    shouldRecover,
    blockedBy
  });
}

export function recoveryState(value, label) { return enumValue(value, STATE_SET, label); }
export function recoveryFailureCode(value, label) { return enumValue(value, FAILURE_CODE_SET, label); }
export function recoveryDecision(value, label) { return enumValue(value, DECISION_SET, label); }
export function normalizePosition(input, label) {
  const source = requiredRecord(input, label);
  return Object.freeze({
    x: finiteNumber(source.x, -30_000_000, 30_000_000, `${label}.x`),
    y: finiteNumber(source.y, -2048, 2048, `${label}.y`),
    z: finiteNumber(source.z, -30_000_000, 30_000_000, `${label}.z`)
  });
}

export function requiredRecord(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError(`${label} must be an object`, { receivedType: valueType(input) });
  return input;
}

export function optionalRecord(input, label) {
  if (input === undefined || input === null) return {};
  return requiredRecord(input, label);
}

export function boundedString(value, minimumLength, maximumLength, label) {
  if (typeof value !== 'string') throw new ValidationError(`${label} must be a string`, { receivedType: valueType(value) });
  const normalized = value.trim();
  if (normalized.length < minimumLength || normalized.length > maximumLength) throw new ValidationError(`${label} length must be between ${minimumLength} and ${maximumLength}`, { length: normalized.length });
  return normalized;
}

export function identifier(value, label) {
  const normalized = boundedString(value, 1, 128, label);
  if (!/^[A-Za-z0-9_.:-]+$/.test(normalized)) throw new ValidationError(`${label} contains unsupported characters`, { value: normalized });
  return normalized;
}

export function optionalIdentifier(value, label) { return value === undefined || value === null ? null : identifier(value, label); }
export function itemName(value, label) {
  const normalized = boundedString(value, 1, 128, label).toLowerCase();
  if (!/^[a-z0-9_.:-]+$/.test(normalized)) throw new ValidationError(`${label} is not a valid item name`, { value: normalized });
  return normalized;
}

export function finiteNumber(value, minimum, maximum, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError(`${label} must be a finite number`, { value });
  if (value < minimum || value > maximum) throw new ValidationError(`${label} must be between ${minimum} and ${maximum}`, { value });
  return value;
}

export function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError(`${label} must be a non-negative safe integer`, { value });
  return value;
}

export function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new ValidationError(`${label} must be a positive safe integer`, { value });
  return value;
}

export function isoTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new ValidationError(`${label} must be a valid ISO timestamp`, { value });
  return new Date(value).toISOString();
}

export function strictBoolean(value, label) {
  if (typeof value !== 'boolean') throw new ValidationError(`${label} must be a boolean`, { receivedType: valueType(value) });
  return value;
}

function optionalBoolean(value, fallback, label) { return value === undefined ? fallback : strictBoolean(value, label); }
function normalizeKeepInventory(value) {
  if (value === undefined || value === null) return 'UNKNOWN';
  if (value === true) return 'ENABLED';
  if (value === false) return 'DISABLED';
  return enumValue(value, new Set(['UNKNOWN', 'ENABLED', 'DISABLED']), 'Death manifest keepInventory');
}
function optionalNumber(value, fallback, minimum, maximum, label) { return value === undefined ? fallback : finiteNumber(value, minimum, maximum, label); }
function optionalInteger(value, fallback, minimum, maximum, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new ValidationError(`${label} must be an integer between ${minimum} and ${maximum}`, { value });
  return value;
}
function optionalNullableInteger(value, minimum, maximum, label) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new ValidationError(`${label} must be an integer between ${minimum} and ${maximum}`, { value });
  return value;
}
function optionalString(value, minimum, maximum, label) { return value === undefined || value === null ? null : boundedString(value, minimum, maximum, label); }
function enumValue(value, values, label) {
  if (typeof value !== 'string' || !values.has(value)) throw new ValidationError(`${label} must be one of: ${[...values].join(', ')}`, { value });
  return value;
}
function normalizeScoreBreakdown(input, label) {
  const source = requiredRecord(input, label);
  return Object.freeze({
    base: finiteNumber(source.base, 0, 100, `${label}.base`),
    quantity: finiteNumber(source.quantity, 0, 100, `${label}.quantity`),
    scarcity: finiteNumber(source.scarcity, 0, 100, `${label}.scarcity`),
    demand: finiteNumber(source.demand, 0, 100, `${label}.demand`),
    task: finiteNumber(source.task, 0, 100, `${label}.task`),
    logistics: finiteNumber(source.logistics, 0, 100, `${label}.logistics`),
    replacement: finiteNumber(source.replacement, 0, 100, `${label}.replacement`),
    strategic: finiteNumber(source.strategic, 0, 100, `${label}.strategic`),
    unique: finiteNumber(source.unique, 0, 100, `${label}.unique`),
    cost: finiteNumber(source.cost, 0, 100, `${label}.cost`)
  });
}
function normalizeStringArray(input, label) {
  if (!Array.isArray(input)) throw new ValidationError(`${label} must be an array`, { receivedType: valueType(input) });
  return Object.freeze(input.map((value, index) => boundedString(value, 1, 128, `${label}[${index}]`)));
}
function inventoryIdentity(item) { return [item.name, item.customName ?? '', item.enchanted ? '1' : '0', item.unique ? '1' : '0', item.nbtHash ?? ''].join('|'); }
function compareInventoryItems(left, right) { return inventoryIdentity(left).localeCompare(inventoryIdentity(right)); }
function aggregateInventory(items, label) {
  const aggregated = new Map();
  for (const item of items) {
    const key = inventoryIdentity(item);
    const current = aggregated.get(key);
    const count = (current?.count ?? 0) + item.count;
    if (!Number.isSafeInteger(count)) throw new ValidationError(`${label} count exceeds the safe integer limit`, { item: item.name, count });
    aggregated.set(key, Object.freeze({ ...item, count }));
  }
  return Object.freeze([...aggregated.values()]);
}
function valueType(value) { return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value; }
