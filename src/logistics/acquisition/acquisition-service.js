import { randomUUID } from 'node:crypto';
import { ConflictError, ValidationError } from '../../core/errors.js';

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  maxDepth: 8,
  maxSubtasks: 32,
  maxAttempts: 3,
  maxDistance: 2000,
  storageFirst: true,
  allowFleet: true,
  allowCraft: true,
  allowSmelt: true,
  allowCollect: true,
  allowPartial: false,
  toolPreservation: true
});

export function createAcquisitionService({ bots, logistics, events, logger, config = {} } = {}) {
  const settings = normalizeConfig({ ...DEFAULT_CONFIG, ...config });
  const records = new Map();
  let taskRunner = null;

  const record = requirement => {
    const normalized = normalizeRequirement(requirement);
    const candidateBots = bots?.list?.() ?? [];
    const requester = candidateBots.find(bot => bot.id === normalized.requesterBotId) ?? null;
    if (!requester) throw new ValidationError(`Acquisition requesterBotId '${normalized.requesterBotId}' was not found in the active bot fleet`);
    if (normalized.type === 'TOOL' && normalized.count !== 1) throw new ValidationError('Tool acquisition requires an exact count of 1');
    if (normalized.type === 'TOOL') normalized.acceptedItems = normalized.acceptedItems.filter(item => toolTier(item) >= toolTier(normalized.minimumTier));
    if (normalized.type === 'TOOL' && !normalized.acceptedItems.length) throw new ValidationError(`No accepted tool meets minimum tier '${normalized.minimumTier}'`);
    if (normalized.count > settings.maxSubtasks) throw new ValidationError(`Acquisition count ${normalized.count} exceeds the runtime maxSubtasks limit of ${settings.maxSubtasks}`);
    const id = normalized.id ?? randomUUID();
    normalized.id = id;
    const existing = records.get(id);
    if (existing) return existing;
    const request = {
      id,
      requesterBotId: normalized.requesterBotId,
      status: 'PENDING',
      attempts: 0,
      requirement: normalized,
      strategy: 'deterministic',
      trace: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(existing ?? {})
    };
    records.set(id, request);
    return request;
  };

  const configure = input => {
    Object.assign(settings, normalizeConfig({ ...settings, ...input }));
    logger?.info?.('acquisition.settings.configured', { settings: structuredClone(settings) });
    return structuredClone(settings);
  };

  const resolve = async input => {
    if (!settings.enabled) throw new ConflictError('Acquisition subsystem is disabled');
    const request = record(input);
    const candidateBots = bots?.list?.() ?? [];
    const target = candidateBots.find(bot => bot.id === request.requirement.requesterBotId);
    if (!target) throw new ValidationError('Acquisition requires at least one bot runtime');
    if (request.attempts >= settings.maxAttempts) throw new ConflictError(`Acquisition request '${request.id}' exceeded maxAttempts (${settings.maxAttempts})`);
    const runtime = bots.get?.(target.id) ?? target;
    const requirement = request.requirement;
    request.attempts += 1;
    request.status = 'RESOLVING';
    request.updatedAt = new Date().toISOString();
    request.trace.push({ at: request.updatedAt, step: 'resolve-start', detail: requirement.type === 'TOOL' ? `tool ${requirement.category}` : requirement.item });

    const inventory = runtime.adapter?.snapshot?.().inventorySummary ?? [];
    const inventoryTotals = aggregateInventory(inventory);
    const hasExact = requirement.type === 'ITEM'
      ? (inventoryTotals[requirement.item] ?? 0) >= requirement.count
      : requirement.acceptedItems.some(name => (inventoryTotals[name] ?? 0) > 0);
    if (hasExact) {
      request.status = 'SATISFIED';
      request.updatedAt = new Date().toISOString();
      request.trace.push({ at: request.updatedAt, step: 'inventory-satisfied', detail: requirement.type === 'ITEM' ? requirement.item : requirement.category });
      events?.publish?.('acquisition.inventory.satisfied', { requestId: request.id, requirement }, { source: 'acquisition' });
      return { requestId: request.id, status: 'SATISFIED', source: 'inventory', requirement, inventory: runtime.adapter?.snapshot?.().inventorySummary ?? [] };
    }

    const tryStorage = async () => {
      if (!logistics?.stock) return null;
      const stock = await logistics.stock({ worldKey: `${String(runtime.options?.host ?? 'localhost').toLowerCase()}:${Number(runtime.options?.port ?? 25565)}`, dimension: runtime.adapter?.snapshot?.().dimension ?? 'overworld' });
      const match = stock.find(storage => {
        const totals = aggregateInventory(storage.availableInventory ?? []);
        return requirement.type === 'ITEM'
          ? (totals[requirement.item] ?? 0) >= requirement.count
          : requirement.acceptedItems.some(name => (totals[name] ?? 0) > 0);
      });
      if (match) {
        const item = requirement.type === 'ITEM'
          ? requirement.item
          : requirement.acceptedItems.find(name => (aggregateInventory(match.availableInventory ?? [])[name] ?? 0) > 0) ?? requirement.acceptedItems[0];
        request.status = 'STORAGE_FOUND';
        request.updatedAt = new Date().toISOString();
        request.trace.push({ at: request.updatedAt, step: 'storage-resolved', detail: `${match.name}:${item}` });
        events?.publish?.('acquisition.storage.reserved', { requestId: request.id, storage: match.name, item }, { source: 'acquisition' });
        return { requestId: request.id, status: 'STORAGE_FOUND', source: 'storage', storage: match.name, item, requirement };
      }
      return null;
    };
    if (settings.storageFirst) {
      const storageResult = await tryStorage();
      if (storageResult) return storageResult;
    }

    if (settings.allowFleet) {
      const donors = candidateBots.filter(bot => bot.id !== target.id && bot.status === 'READY');
      const donor = donors.find(bot => {
        const snapshot = bot.runtime?.inventorySummary ?? [];
        const totals = aggregateInventory(snapshot);
        return requirement.type === 'ITEM'
          ? (totals[requirement.item] ?? 0) >= requirement.count
          : requirement.acceptedItems.some(name => (totals[name] ?? 0) > 0);
      });
      if (donor) {
        request.status = 'FLEET_DONOR_SELECTED';
        request.updatedAt = new Date().toISOString();
        request.trace.push({ at: request.updatedAt, step: 'fleet-transfer', detail: `${donor.id}` });
        events?.publish?.('acquisition.fleet.transferred', { requestId: request.id, donorId: donor.id, requirement }, { source: 'acquisition' });
        return { requestId: request.id, status: 'FLEET_DONOR_SELECTED', source: 'fleet', donorId: donor.id, requirement };
      }
    }

    if (!settings.storageFirst) {
      const storageResult = await tryStorage();
      if (storageResult) return storageResult;
    }

    if (settings.allowCraft && requirement.type === 'ITEM') {
      const recipe = runtime.adapter?.craftRequirements ? await runtime.adapter.craftRequirements({ item: requirement.item, count: requirement.count }) : null;
      if (recipe?.craftable === true) {
        if (recipe.missing?.length === 0) {
          request.status = 'CRAFT_READY';
          request.updatedAt = new Date().toISOString();
          request.trace.push({ at: request.updatedAt, step: 'craft-ready', detail: `${requirement.item}:${requirement.count}` });
          await events?.publish?.('acquisition.craft.ready', { requestId: request.id, requirement, recipe }, { source: 'acquisition' });
          return { requestId: request.id, status: 'CRAFT_READY', source: 'craft', requirement, recipe };
        }
        const subrequests = recipe.missing.map(ingredient => ({ requesterBotId: target.id, type: 'ITEM', item: ingredient.name, count: ingredient.count, purpose: `craft ${requirement.item}`, priority: requirement.priority, consume: true }));
        request.status = 'CRAFT_PLAN_CREATED';
        request.updatedAt = new Date().toISOString();
        request.trace.push({ at: request.updatedAt, step: 'craft-plan', detail: recipe.missing.map(item => `${item.name}:${item.count}`).join(', ') });
        await events?.publish?.('acquisition.craft.planned', { requestId: request.id, requirement, subrequests }, { source: 'acquisition' });
        return { requestId: request.id, status: 'CRAFT_PLAN_CREATED', source: 'craft', requirement, subrequests };
      }
    }

    if (settings.allowSmelt && requirement.type === 'ITEM') {
      const formula = runtime.adapter?.smeltRequirements ? await runtime.adapter.smeltRequirements({ item: requirement.item, count: requirement.count }) : null;
      if (formula) {
        request.status = 'SMELT_PLAN_CREATED';
        request.updatedAt = new Date().toISOString();
        request.trace.push({ at: request.updatedAt, step: 'smelt-plan', detail: `${formula.input.name}:${formula.input.count}` });
        events?.publish?.('acquisition.production.planned', { requestId: request.id, requirement, formula }, { source: 'acquisition' });
        return { requestId: request.id, status: 'SMELT_PLAN_CREATED', source: 'smelt', requirement, formula };
      }
    }

    if (settings.allowCollect && requirement.type === 'ITEM') {
      const blocks = runtime.adapter?.findSourceBlocks ? await runtime.adapter.findSourceBlocks({ item: requirement.item }) : [];
      if (blocks.length) {
        request.status = 'COLLECTION_PLANNED';
        request.updatedAt = new Date().toISOString();
        request.trace.push({ at: request.updatedAt, step: 'collect-plan', detail: blocks.slice(0, 3).join(', ') });
        events?.publish?.('acquisition.collection.planned', { requestId: request.id, requirement, blocks }, { source: 'acquisition' });
        return { requestId: request.id, status: 'COLLECTION_PLANNED', source: 'collect', requirement, blocks };;
      }
    }

    request.status = 'FAILED';
    request.updatedAt = new Date().toISOString();
    request.trace.push({ at: request.updatedAt, step: 'failed', detail: 'no viable source' });
    events?.publish?.('acquisition.failed', { requestId: request.id, requirement }, { source: 'acquisition' });
    throw new ConflictError(`Unable to satisfy acquisition requirement for '${requirement.type === 'ITEM' ? requirement.item : requirement.category}'`);
  };

  const acquire = async (input, depth = 0) => {
    if (depth > settings.maxDepth) throw new ConflictError(`Acquisition exceeded maxDepth (${settings.maxDepth})`);
    const plan = await resolve(input);
    const runtime = bots.get(plan.requirement.requesterBotId);
    if (plan.status === 'SATISFIED') return { ...plan, status: 'COMPLETED' };
    if (plan.status === 'STORAGE_FOUND') {
      if (!logistics?.retrieve) throw new ConflictError('Storage acquisition executor is unavailable');
      const result = await logistics.retrieve({ runtime, storageName: plan.storage, item: plan.item, count: plan.requirement.count });
      verifyAcquired(runtime, plan.item, plan.requirement.count);
      return { ...plan, status: 'COMPLETED', execution: result };
    }
    if (plan.status === 'FLEET_DONOR_SELECTED') {
      const result = await transferFromFleet(runtime, bots.get(plan.donorId), plan.item, plan.requirement.count);
      return { ...plan, status: 'COMPLETED', execution: result };
    }
    if (plan.status === 'CRAFT_READY') {
      const result = await runAdapter(taskRunner, runtime, 'minecraft.crafting', { item: plan.requirement.item, count: plan.requirement.count }, () => runtime.adapter.craftItem({ item: plan.requirement.item, count: plan.requirement.count }));
      verifyAcquired(runtime, plan.requirement.item, plan.requirement.count);
      return { ...plan, status: 'COMPLETED', execution: result };
    }
    if (plan.status === 'CRAFT_PLAN_CREATED') {
      if (plan.subrequests.length > settings.maxSubtasks) throw new ConflictError(`Acquisition plan exceeds maxSubtasks (${settings.maxSubtasks})`);
      const executions = [];
      for (const subrequest of plan.subrequests) executions.push(await acquire(subrequest, depth + 1));
      const result = await runAdapter(taskRunner, runtime, 'minecraft.crafting', { item: plan.requirement.item, count: plan.requirement.count }, () => runtime.adapter.craftItem({ item: plan.requirement.item, count: plan.requirement.count }));
      verifyAcquired(runtime, plan.requirement.item, plan.requirement.count);
      return { ...plan, status: 'COMPLETED', execution: { dependencies: executions, craft: result } };
    }
    if (plan.status === 'COLLECTION_PLANNED') {
      let collected = 0;
      for (const block of plan.blocks) {
        if (collected >= plan.requirement.count) break;
        const before = itemTotal(runtime, plan.requirement.item);
        await runAdapter(taskRunner, runtime, 'minecraft.collection', { block, count: plan.requirement.count - collected, maxDistance: settings.maxDistance }, () => runtime.adapter.collect({ block, count: plan.requirement.count - collected, maxDistance: settings.maxDistance }));
        collected += Math.max(0, itemTotal(runtime, plan.requirement.item) - before);
      }
      verifyAcquired(runtime, plan.requirement.item, plan.requirement.count);
      return { ...plan, status: 'COMPLETED', execution: { collected } };
    }
    if (plan.status === 'SMELT_PLAN_CREATED') {
      const result = await runAdapter(taskRunner, runtime, 'minecraft.smelting', { item: plan.requirement.item, count: plan.requirement.count, fuel: plan.formula.fuel?.name }, () => runtime.adapter.smeltItem({ item: plan.requirement.item, count: plan.requirement.count, fuel: plan.formula.fuel?.name }));
      verifyAcquired(runtime, plan.requirement.item, plan.requirement.count);
      return { ...plan, status: 'COMPLETED', execution: result };
    }
    throw new ConflictError(`Acquisition plan '${plan.status}' cannot be executed`);
  };

  const status = () => ({
    enabled: settings.enabled,
    totalRequests: records.size,
    activeRequests: [...records.values()].filter(request => ['PENDING', 'RESOLVING'].includes(request.status)).length,
    completedRequests: [...records.values()].filter(request => ['SATISFIED', 'CRAFT_READY'].includes(request.status)).length,
    failedRequests: [...records.values()].filter(request => request.status === 'FAILED').length,
    maxDepth: settings.maxDepth,
    maxSubtasks: settings.maxSubtasks,
    maxAttempts: settings.maxAttempts,
    maxDistance: settings.maxDistance,
    storageFirst: settings.storageFirst,
    allowFleet: settings.allowFleet,
    allowCraft: settings.allowCraft,
    allowSmelt: settings.allowSmelt,
    allowCollect: settings.allowCollect,
    allowPartial: settings.allowPartial,
    toolPreservation: settings.toolPreservation,
    requests: [...records.values()].slice(-20)
  });

  return Object.freeze({
    settings: () => structuredClone(settings),
    configure,
    configureTaskRunner: runner => { if (runner !== null && typeof runner !== 'function') throw new ValidationError('Acquisition task runner must be a function or null'); taskRunner = runner; },
    status,
    resolve,
    request: resolve,
    acquire,
    list: () => [...records.values()],
    clear: () => { records.clear(); return true; },
    normalizeRequirement
  });
}

async function runAdapter(taskRunner, runtime, capability, input, fallback) {
  return taskRunner ? taskRunner({ runtime, capability, input }) : fallback();
}

function aggregateInventory(items = []) {
  return (Array.isArray(items) ? items : []).reduce((totals, entry) => {
    if (!entry || !entry.name) return totals;
    const name = String(entry.name).trim().toLowerCase();
    if (!name) return totals;
    totals[name] = (totals[name] ?? 0) + Number(entry.count ?? entry.available ?? 0);
    return totals;
  }, {});
}

function toolTier(name) {
  const material = String(name).toLowerCase().split('_', 1)[0];
  return { wooden: 1, golden: 2, stone: 3, iron: 4, diamond: 5, netherite: 6 }[material] ?? 0;
}

function itemTotal(runtime, name) {
  return aggregateInventory(runtime.adapter?.snapshot?.().inventorySummary ?? [])[String(name).toLowerCase()] ?? 0;
}

function verifyAcquired(runtime, name, count) {
  if (itemTotal(runtime, name) < count) throw new ConflictError(`Acquisition verification failed for '${name}': expected ${count}, found ${itemTotal(runtime, name)}`);
}

async function transferFromFleet(target, donor, item, count) {
  if (!donor || donor.id === target.id) throw new ConflictError('Fleet acquisition donor is unavailable');
  const targetSnapshot = target.adapter.snapshot(); const donorSnapshot = donor.adapter.snapshot();
  if (targetSnapshot.dimension !== donorSnapshot.dimension) throw new ConflictError('Fleet acquisition requires the same dimension');
  const targetOptions = target.options ?? {}; const donorOptions = donor.options ?? {};
  if (String(targetOptions.host ?? 'localhost').toLowerCase() !== String(donorOptions.host ?? 'localhost').toLowerCase() || Number(targetOptions.port ?? 25565) !== Number(donorOptions.port ?? 25565)) throw new ConflictError('Fleet acquisition requires the same server');
  const available = itemTotal(donor, item); if (available < count) throw new ConflictError(`Fleet donor '${donor.id}' has only ${available} '${item}'`);
  const targetBefore = itemTotal(target, item); await donor.adapter.dropItem({ item, count }); await target.adapter.pickupItem({ item, count });
  if (itemTotal(donor, item) !== available - count || itemTotal(target, item) !== targetBefore + count) throw new ConflictError(`Fleet acquisition verification failed for '${item}'`);
  return { donorId: donor.id, item, count, verified: true };
}

function normalizeConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...input };
  if (typeof config.enabled !== 'boolean') throw new ValidationError('Acquisition enabled must be a boolean');
  if (!Number.isInteger(config.maxDepth) || config.maxDepth < 1 || config.maxDepth > 32) throw new ValidationError('Acquisition maxDepth must be an integer between 1 and 32');
  if (!Number.isInteger(config.maxSubtasks) || config.maxSubtasks < 1 || config.maxSubtasks > 256) throw new ValidationError('Acquisition maxSubtasks must be an integer between 1 and 256');
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 10) throw new ValidationError('Acquisition maxAttempts must be an integer between 1 and 10');
  if (!Number.isInteger(config.maxDistance) || config.maxDistance < 16 || config.maxDistance > 100_000) throw new ValidationError('Acquisition maxDistance must be between 16 and 100000');
  if (typeof config.storageFirst !== 'boolean') throw new ValidationError('Acquisition storageFirst must be a boolean');
  if (typeof config.allowFleet !== 'boolean') throw new ValidationError('Acquisition allowFleet must be a boolean');
  if (typeof config.allowCraft !== 'boolean') throw new ValidationError('Acquisition allowCraft must be a boolean');
  if (typeof config.allowSmelt !== 'boolean') throw new ValidationError('Acquisition allowSmelt must be a boolean');
  if (typeof config.allowCollect !== 'boolean') throw new ValidationError('Acquisition allowCollect must be a boolean');
  if (typeof config.allowPartial !== 'boolean') throw new ValidationError('Acquisition allowPartial must be a boolean');
  if (typeof config.toolPreservation !== 'boolean') throw new ValidationError('Acquisition toolPreservation must be a boolean');
  return config;
}

function normalizeRequirement(requirement) {
  if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) throw new ValidationError('Acquisition requirement must be an object');
  const normalized = { ...requirement };
  normalized.requesterBotId = String(requirement.requesterBotId ?? '').trim();
  if (!normalized.requesterBotId) throw new ValidationError('Acquisition requirement requires requesterBotId');
  if (!['ITEM', 'TOOL'].includes(requirement.type)) throw new ValidationError("Acquisition requirement type must be 'ITEM' or 'TOOL'");
  if (normalized.type === 'ITEM') {
    if (typeof requirement.item !== 'string' || !requirement.item.trim()) throw new ValidationError('Acquisition item requirement requires a non-empty item name');
    normalized.item = requirement.item.trim().toLowerCase();
    normalized.count = Number(requirement.count ?? 1);
    if (!Number.isInteger(normalized.count) || normalized.count < 1 || normalized.count > 10_000) throw new ValidationError('Acquisition item count must be a positive integer up to 10000');
  }
  if (normalized.type === 'TOOL') {
    normalized.category = String(requirement.category ?? 'TOOL').toUpperCase();
    normalized.acceptedItems = Array.isArray(requirement.acceptedItems) && requirement.acceptedItems.length ? requirement.acceptedItems.map(value => String(value).trim().toLowerCase()).filter(Boolean) : ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];
    normalized.minimumTier = String(requirement.minimumTier ?? 'WOODEN').toUpperCase();
    normalized.count = Number(requirement.count ?? 1);
    if (!Number.isInteger(normalized.count) || normalized.count < 1) throw new ValidationError('Acquisition tool count must be a positive integer');
  }
  normalized.priority = Number(requirement.priority ?? 50);
  normalized.consume = Boolean(requirement.consume ?? true);
  normalized.purpose = String(requirement.purpose ?? 'general acquisition');
  if (normalized.type === 'TOOL' && (!Number.isInteger(normalized.count) || normalized.count !== 1)) throw new ValidationError('Tool acquisition requires an exact count of 1');
  normalized.id = requirement.id ?? null;
  return normalized;
}
