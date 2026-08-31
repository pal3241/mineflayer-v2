import { ValidationError } from '../core/errors.js';

const DEFAULT_POLICY = Object.freeze({ enabled: true, autoEquipArmor: true, minimumDurabilityPercent: 10, preferProtection: true, preferDurability: false, allowBindingCurse: false, allowAnimalKill: false, minimumSheepReserve: 2, minimumCowReserve: 2, interactionCooldownMs: 500, entitySearchDistance: 48 });

export function createSurvivalService({ acquisition, events, logger, config }) {
  if (!acquisition || typeof acquisition.registerSpecialSource !== 'function') throw new ValidationError('Survival service requires acquisition special-source support');
  const policy = normalizeSurvivalPolicy({ ...DEFAULT_POLICY, ...(config ?? {}) });
  const attached = new Map();
  const armorRunning = new Set();
  const publish = async (type, payload, runtime) => events?.publish(type, { botId: runtime.bot.id, ...payload }, { source: 'survival' });
  const call = async (runtime, method, input, context, event) => {
    if (!policy.enabled) throw new ValidationError(`Survival capability '${method}' is disabled by policy`);
    const operation = runtime.adapter?.[method];
    if (typeof operation !== 'function') throw new ValidationError(`Survival capability '${method}' is unavailable for bot '${runtime.bot.id}'`);
    try { const result = await operation.call(runtime.adapter, input, context); await publish(event, result, runtime); return result; }
    catch (error) { await publish(survivalFailureEvent(event), { capability: method, code: error.code ?? 'CAPABILITY_UNAVAILABLE', error: error.message }, runtime); throw error; }
  };

  acquisition.registerSpecialSource({
    name: 'sheep-wool',
    capability: 'minecraft.acquire-wool',
    matches: item => policy.enabled && item.endsWith('_wool'),
    dependencies: () => [{ type: 'ITEM', item: 'shears', count: 1, consume: false }],
    execute: async ({ runtime, item, count, context }) => call(runtime, 'acquireWool', { color: item.slice(0, -5), count, maxDistance: policy.entitySearchDistance, minimumSheepReserve: policy.minimumSheepReserve, allowAnimalKill: policy.allowAnimalKill }, context, 'wool.acquired')
  });
  acquisition.registerSpecialSource({
    name: 'cow-milk',
    capability: 'minecraft.acquire-milk',
    matches: item => policy.enabled && item === 'milk_bucket',
    dependencies: ({ count }) => [{ type: 'ITEM', item: 'bucket', count, consume: true }],
    execute: async ({ runtime, count, context }) => call(runtime, 'acquireMilk', { count, maxDistance: policy.entitySearchDistance, minimumCowReserve: policy.minimumCowReserve }, context, 'milk.acquired')
  });

  const attach = runtime => {
    if (attached.has(runtime.bot.id)) return attached.get(runtime.bot.id);
    const evaluateArmor = () => { if (!policy.enabled || !policy.autoEquipArmor || armorRunning.has(runtime.bot.id)) return; armorRunning.add(runtime.bot.id); void call(runtime, 'autoEquipArmor', armorPolicy(policy), {}, 'armor.equipped').catch(error => { logger?.error?.('armor.auto-equip.failed', { botId: runtime.bot.id, error: error.message, code: error.code }); void publish('armor.auto-equip.failed', { error: error.message, code: error.code ?? 'CAPABILITY_UNAVAILABLE' }, runtime); }).finally(() => armorRunning.delete(runtime.bot.id)); };
    const onSpawn = () => evaluateArmor(); const onInventoryUpdate = () => evaluateArmor(); runtime.adapter.on('spawn', onSpawn); runtime.adapter.on('inventoryUpdate', onInventoryUpdate);
    const detach = () => { runtime.adapter.removeListener('spawn', onSpawn); runtime.adapter.removeListener('inventoryUpdate', onInventoryUpdate); armorRunning.delete(runtime.bot.id); attached.delete(runtime.bot.id); };
    attached.set(runtime.bot.id, detach);
    return detach;
  };

  const configure = input => { Object.assign(policy, normalizeSurvivalPolicy({ ...policy, ...input })); logger?.info?.('survival.settings.configured', { settings: structuredClone(policy) }); return structuredClone(policy); };
  const invoke = (runtime, method, input, context, event) => call(runtime, method, input, context, event);
  return Object.freeze({
    settings: () => structuredClone(policy), configure, attach, stop: () => { for (const detach of attached.values()) detach(); attached.clear(); },
    equip: (runtime, input, context) => invoke(runtime, 'equipItem', input, context, 'minecraft.item.equipped'),
    unequip: (runtime, input, context) => invoke(runtime, 'unequipItem', input, context, 'minecraft.item.unequipped'),
    useItem: (runtime, input, context) => invoke(runtime, 'useItem', input, context, 'minecraft.item.used'),
    findEntity: (runtime, input, context) => invoke(runtime, 'findNearestEntity', input, context, 'minecraft.entity.found'),
    interactEntity: (runtime, input, context) => invoke(runtime, 'interactEntity', input, context, 'minecraft.entity.interaction'),
    interactBlock: (runtime, input, context) => invoke(runtime, 'interactBlock', { ...input, cooldownMs: policy.interactionCooldownMs }, context, 'minecraft.block.interaction'),
    inspectArmor: (runtime, input, context) => invoke(runtime, 'inspectArmor', input, context, 'armor.inspected'),
    equipArmor: (runtime, input, context) => invoke(runtime, 'equipArmor', { ...armorPolicy(policy), ...input }, context, 'armor.equipped'),
    autoEquipArmor: (runtime, input, context) => invoke(runtime, 'autoEquipArmor', { ...armorPolicy(policy), ...input }, context, 'armor.equipped'),
    findSheep: (runtime, input, context) => invoke(runtime, 'findSheep', { maxDistance: policy.entitySearchDistance, ...input }, context, 'sheep.found'),
    shearSheep: (runtime, input, context) => invoke(runtime, 'shearSheep', input, context, 'sheep.sheared'),
    shearNearest: async (runtime, input, context) => { const sheep = await invoke(runtime, 'findSheep', { maxDistance: policy.entitySearchDistance, ...input }, context, 'sheep.found'); return invoke(runtime, 'shearSheep', { entityId: sheep.entityId }, context, 'sheep.sheared'); },
    acquireWool: (runtime, input, context) => invoke(runtime, 'acquireWool', { maxDistance: policy.entitySearchDistance, minimumSheepReserve: policy.minimumSheepReserve, allowAnimalKill: policy.allowAnimalKill, ...input }, context, 'wool.acquired'),
    findCow: (runtime, input, context) => invoke(runtime, 'findCow', { maxDistance: policy.entitySearchDistance, ...input }, context, 'cow.found'),
    milkCow: (runtime, input, context) => invoke(runtime, 'milkCow', input, context, 'cow.milked'),
    milkNearest: async (runtime, input, context) => { const cow = await invoke(runtime, 'findCow', { maxDistance: policy.entitySearchDistance, ...input }, context, 'cow.found'); return invoke(runtime, 'milkCow', { entityId: cow.entityId }, context, 'cow.milked'); },
    acquireMilk: (runtime, input, context) => invoke(runtime, 'acquireMilk', { maxDistance: policy.entitySearchDistance, minimumCowReserve: policy.minimumCowReserve, ...input }, context, 'milk.acquired'),
    findBed: (runtime, input, context) => invoke(runtime, 'findBed', input, context, 'sleep.searching'),
    sleep: (runtime, input, context) => invoke(runtime, 'sleep', input, context, 'sleep.started'),
    wake: (runtime, input, context) => invoke(runtime, 'wake', input, context, 'sleep.completed'),
    sleepStatus: (runtime, input, context) => invoke(runtime, 'sleepStatus', input, context, 'sleep.status'),
    openDoor: (runtime, input, context) => invoke(runtime, 'openDoor', { ...input, cooldownMs: policy.interactionCooldownMs }, context, 'door.opened'),
    closeDoor: (runtime, input, context) => invoke(runtime, 'closeDoor', { ...input, cooldownMs: policy.interactionCooldownMs }, context, 'door.closed'),
    openTrapdoor: (runtime, input, context) => invoke(runtime, 'openTrapdoor', { ...input, cooldownMs: policy.interactionCooldownMs }, context, 'trapdoor.opened'),
    closeTrapdoor: (runtime, input, context) => invoke(runtime, 'closeTrapdoor', { ...input, cooldownMs: policy.interactionCooldownMs }, context, 'trapdoor.closed'),
    status: () => ({ status: policy.enabled ? 'HEALTHY' : 'DISABLED', attachedBots: attached.size, settings: structuredClone(policy) })
  });
}

export function normalizeSurvivalPolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Survival policy must be an object');
  const policy = { ...DEFAULT_POLICY, ...input };
  for (const field of ['enabled', 'autoEquipArmor', 'preferProtection', 'preferDurability', 'allowBindingCurse', 'allowAnimalKill']) if (typeof policy[field] !== 'boolean') throw new ValidationError(`Survival policy '${field}' must be a boolean`);
  for (const [field, minimum, maximum] of [['minimumDurabilityPercent', 0, 100], ['minimumSheepReserve', 0, 100], ['minimumCowReserve', 0, 100], ['interactionCooldownMs', 100, 10_000], ['entitySearchDistance', 4, 128]]) if (!Number.isInteger(policy[field]) || policy[field] < minimum || policy[field] > maximum) throw new ValidationError(`Survival policy '${field}' must be an integer between ${minimum} and ${maximum}`);
  return policy;
}

function armorPolicy(policy) { return { preserveDurability: true, minimumDurability: policy.minimumDurabilityPercent, preferProtection: policy.preferProtection, preferDurability: policy.preferDurability, allowBindingCurse: policy.allowBindingCurse }; }
function survivalFailureEvent(event) { if (event.startsWith('sleep.')) return 'sleep.failed'; if (event.startsWith('door.')) return 'door.interaction.failed'; if (event.startsWith('trapdoor.')) return 'trapdoor.interaction.failed'; return `${event}.failed`; }
