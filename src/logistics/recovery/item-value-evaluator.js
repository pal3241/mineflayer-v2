import { ValidationError } from '../../core/errors.js';
import {
  createRecoveryConfig,
  finiteNumber,
  itemName,
  nonNegativeInteger,
  normalizeInventoryItem,
  optionalRecord,
  positiveInteger,
  requiredRecord,
  strictBoolean,
  validateDeathManifest
} from './recovery-schema.js';

const BASE_SCORES = Object.freeze({ CRITICAL: 85, HIGH: 62, NORMAL: 30, LOW: 14, TRASH: 2 });
const EXACT_PRIORITIES = new Map([
  ['diamond', 'CRITICAL'], ['netherite_ingot', 'CRITICAL'], ['netherite_scrap', 'CRITICAL'], ['ancient_debris', 'CRITICAL'],
  ['elytra', 'CRITICAL'], ['dragon_egg', 'CRITICAL'], ['beacon', 'CRITICAL'], ['enchanted_golden_apple', 'CRITICAL'], ['totem_of_undying', 'CRITICAL'],
  ['iron_ingot', 'HIGH'], ['gold_ingot', 'HIGH'], ['emerald', 'HIGH'], ['diamond_ore', 'HIGH'], ['deepslate_diamond_ore', 'HIGH'],
  ['redstone', 'HIGH'], ['lapis_lazuli', 'HIGH'], ['blaze_rod', 'HIGH'], ['ender_pearl', 'HIGH'], ['ghast_tear', 'HIGH'],
  ['coal', 'NORMAL'], ['charcoal', 'NORMAL'], ['bread', 'NORMAL'], ['cooked_beef', 'NORMAL'], ['cooked_mutton', 'NORMAL'],
  ['cooked_porkchop', 'NORMAL'], ['cooked_chicken', 'NORMAL'], ['golden_carrot', 'NORMAL'], ['baked_potato', 'NORMAL'],
  ['cobblestone', 'LOW'], ['cobbled_deepslate', 'LOW'], ['stone', 'LOW'], ['blackstone', 'LOW'],
  ['dirt', 'TRASH'], ['coarse_dirt', 'TRASH'], ['rotten_flesh', 'TRASH'], ['poisonous_potato', 'TRASH']
]);

export function evaluateRecoveryItems(input) {
  const source = requiredRecord(input, 'Recovery evaluation input');
  const manifest = validateDeathManifest(source.manifest);
  const config = createRecoveryConfig(source.config);
  const signals = normalizeSignals(source.signals);
  const cost = calculateRecoveryCost(source.cost, config);
  const items = Object.freeze(manifest.items.map(item => evaluateRecoveryItem({ item, signal: signals.get(item.name), cost, config })));
  const recoveryScore = items.length ? Math.max(...items.map(item => item.dynamicScore)) : 0;
  const blockedBy = recoveryBlocks({ manifest, config, cost, recoveryScore, items });
  const shouldRecover = blockedBy.length === 0 && items.some(item => item.decision === 'REQUIRED');
  const decision = shouldRecover ? (recoveryScore >= config.urgentScore ? 'URGENT_RECOVERY' : 'RECOVER') : 'DO_NOT_RECOVER';
  return Object.freeze({ items, recoveryScore, decision, shouldRecover, blockedBy: Object.freeze(blockedBy) });
}

export function evaluateRecoveryItem(input) {
  const source = requiredRecord(input, 'Item recovery evaluation input');
  const item = normalizeInventoryItem(source.item, 'Item recovery evaluation item');
  const config = createRecoveryConfig(source.config);
  const signal = normalizeSignal(source.signal, item.name, 'Item recovery signal');
  const cost = normalizeCalculatedCost(source.cost);
  const basePriority = baseItemPriority(item);
  const base = BASE_SCORES[basePriority];
  const quantity = quantityValue(item.count, basePriority);
  const scarcity = scarcityRatio(signal) * 20;
  const demand = signal.demand * 20;
  const task = signal.taskImportance * 35;
  const logistics = signal.logisticsCount > 0 ? 35 : 0;
  const replacement = signal.replacementCost * 15;
  const strategic = signal.strategicValue * 15;
  const unique = uniqueRatio(item, signal) * 40;
  const dynamicScore = rounded(clamp(base + quantity + scarcity + demand + task + logistics + replacement + strategic + unique - cost.total, 0, 100));
  const decision = dynamicScore >= config.minScore ? 'REQUIRED' : dynamicScore >= config.optionalScore ? 'OPTIONAL' : 'IGNORE';
  return Object.freeze({
    ...item,
    basePriority,
    baseScore: base,
    dynamicScore,
    recoveryCost: cost.total,
    decision,
    scoreBreakdown: Object.freeze({
      base,
      quantity: rounded(quantity),
      scarcity: rounded(scarcity),
      demand: rounded(demand),
      task: rounded(task),
      logistics: rounded(logistics),
      replacement: rounded(replacement),
      strategic: rounded(strategic),
      unique: rounded(unique),
      cost: cost.total
    })
  });
}

export function calculateRecoveryCost(input, configInput) {
  const source = requiredRecord(input, 'Recovery cost input');
  const config = createRecoveryConfig(configInput);
  const distance = finiteNumber(source.distance, 0, 30_000_000, 'Recovery cost distance');
  const danger = finiteNumber(source.danger, 0, 1, 'Recovery cost danger');
  const workload = finiteNumber(source.workload, 0, 1, 'Recovery cost workload');
  const risk = finiteNumber(source.risk, 0, 1, 'Recovery cost risk');
  const remainingDespawnTicks = nonNegativeInteger(source.remainingDespawnTicks, 'Recovery cost remainingDespawnTicks');
  const travelCost = Math.min(1, distance / config.maxDistance) * 25;
  const dangerCost = danger * 40;
  const workloadCost = workload * 10;
  const riskCost = risk * 15;
  const timePressureRatio = remainingDespawnTicks >= config.safetyMarginTicks
    ? 0
    : config.safetyMarginTicks === 0 ? Number(remainingDespawnTicks === 0) : 1 - (remainingDespawnTicks / config.safetyMarginTicks);
  const timePressureCost = timePressureRatio * 10;
  return Object.freeze({
    distance,
    danger,
    workload,
    risk,
    remainingDespawnTicks,
    travel: rounded(travelCost),
    dangerCost: rounded(dangerCost),
    workloadCost: rounded(workloadCost),
    riskCost: rounded(riskCost),
    timePressureCost: rounded(timePressureCost),
    total: rounded(clamp(travelCost + dangerCost + workloadCost + riskCost + timePressureCost, 0, 100))
  });
}

export function baseItemPriority(input) {
  const item = normalizeInventoryItem(input, 'Base priority item');
  if (item.enchanted || item.unique || item.customName || item.nbtHash) return 'CRITICAL';
  const exact = EXACT_PRIORITIES.get(item.name);
  if (exact) return exact;
  if (/^(diamond|netherite)_/.test(item.name) || item.name.endsWith('shulker_box')) return 'CRITICAL';
  if (/^(iron|golden)_/.test(item.name) && /_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots)$/.test(item.name)) return 'HIGH';
  if (/_ore$/.test(item.name) || /^(raw_iron|raw_gold|raw_copper)$/.test(item.name)) return 'HIGH';
  if (/(_log|_wood|_stem|_hyphae|_planks)$/.test(item.name)) return 'NORMAL';
  if (/(_seeds|_sapling)$/.test(item.name)) return 'LOW';
  return 'NORMAL';
}

function normalizeSignals(input) {
  if (input === undefined || input === null) return new Map();
  if (!Array.isArray(input)) throw new ValidationError('Recovery signals must be an array');
  const signals = new Map();
  for (let index = 0; index < input.length; index++) {
    const source = requiredRecord(input[index], `Recovery signals[${index}]`);
    const name = itemName(source.name, `Recovery signals[${index}].name`);
    if (signals.has(name)) throw new ValidationError(`Recovery signal for '${name}' is duplicated`, { name });
    signals.set(name, normalizeSignal(source, name, `Recovery signals[${index}]`));
  }
  return signals;
}

function normalizeSignal(input, expectedName, label) {
  const source = optionalRecord(input, label);
  const name = source.name === undefined ? expectedName : itemName(source.name, `${label}.name`);
  if (name !== expectedName) throw new ValidationError(`${label}.name must match '${expectedName}'`, { name });
  return Object.freeze({
    name,
    currentStock: optionalNonNegativeInteger(source.currentStock, 0, `${label}.currentStock`),
    targetStock: optionalNonNegativeInteger(source.targetStock, 0, `${label}.targetStock`),
    scarcity: optionalRatio(source.scarcity, null, `${label}.scarcity`),
    demand: optionalRatio(source.demand, 0, `${label}.demand`),
    taskImportance: optionalRatio(source.taskImportance, 0, `${label}.taskImportance`),
    logisticsCount: optionalNonNegativeInteger(source.logisticsCount, 0, `${label}.logisticsCount`),
    replacementCost: optionalRatio(source.replacementCost, 0, `${label}.replacementCost`),
    strategicValue: optionalRatio(source.strategicValue, 0, `${label}.strategicValue`),
    uniqueValue: optionalRatio(source.uniqueValue, 0, `${label}.uniqueValue`)
  });
}

function normalizeCalculatedCost(input) {
  const source = requiredRecord(input, 'Calculated recovery cost');
  return Object.freeze({
    distance: finiteNumber(source.distance, 0, 30_000_000, 'Calculated recovery cost distance'),
    danger: finiteNumber(source.danger, 0, 1, 'Calculated recovery cost danger'),
    workload: finiteNumber(source.workload, 0, 1, 'Calculated recovery cost workload'),
    risk: finiteNumber(source.risk, 0, 1, 'Calculated recovery cost risk'),
    remainingDespawnTicks: nonNegativeInteger(source.remainingDespawnTicks, 'Calculated recovery cost remainingDespawnTicks'),
    total: finiteNumber(source.total, 0, 100, 'Calculated recovery cost total')
  });
}

function recoveryBlocks(input) {
  const blocked = [];
  if (!input.config.enabled) blocked.push('RECOVERY_DISABLED');
  if (input.manifest.keepInventory === 'ENABLED') blocked.push('KEEP_INVENTORY');
  if (!input.manifest.items.length) blocked.push('NO_DROPPED_ITEMS');
  if (input.cost.remainingDespawnTicks === 0) blocked.push('ITEMS_DESPAWNED');
  if (input.cost.distance > input.config.maxDistance) blocked.push('MAX_DISTANCE_EXCEEDED');
  if (input.cost.danger > input.config.dangerLimit) blocked.push('DANGER_TOO_HIGH');
  if (!input.items.some(item => item.decision === 'REQUIRED') || input.recoveryScore < input.config.minScore) blocked.push('RECOVERY_NOT_WORTH_COST');
  return [...new Set(blocked)];
}

function scarcityRatio(signal) {
  if (signal.scarcity !== null) return signal.scarcity;
  if (signal.targetStock === 0) return 0;
  return clamp((signal.targetStock - signal.currentStock) / signal.targetStock, 0, 1);
}
function uniqueRatio(item, signal) { return Math.max(Number(item.unique || item.enchanted || Boolean(item.customName) || Boolean(item.nbtHash)), signal.uniqueValue); }
function quantityValue(count, priority) {
  const multiplier = priority === 'CRITICAL' ? 1.8 : priority === 'HIGH' ? 1.6 : priority === 'NORMAL' ? 1.2 : priority === 'LOW' ? 0.6 : 0;
  const maximum = priority === 'CRITICAL' ? 10 : priority === 'HIGH' ? 8 : priority === 'NORMAL' ? 6 : priority === 'LOW' ? 3 : 0;
  return Math.min(maximum, Math.log2(count + 1) * multiplier);
}
function optionalRatio(value, fallback, label) { return value === undefined || value === null ? fallback : finiteNumber(value, 0, 1, label); }
function optionalNonNegativeInteger(value, fallback, label) { return value === undefined || value === null ? fallback : nonNegativeInteger(value, label); }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function rounded(value) { return Math.round(value * 100) / 100; }
