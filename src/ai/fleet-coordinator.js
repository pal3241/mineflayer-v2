import { ConflictError, ValidationError } from '../core/errors.js';

const AVAILABLE_STATES = new Set(['READY', 'ACTIVE', 'PAUSED']);
const TOOL_TIER = Object.freeze({ wooden: 1, golden: 2, stone: 3, iron: 4, diamond: 5, netherite: 6 });
const HOES = ['wooden_hoe', 'golden_hoe', 'stone_hoe', 'iron_hoe', 'diamond_hoe', 'netherite_hoe'];
const AXES = ['wooden_axe', 'golden_axe', 'stone_axe', 'iron_axe', 'diamond_axe', 'netherite_axe'];
const SWORDS = ['wooden_sword', 'golden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'netherite_sword'];

export class FleetCoordinator {
  #recent = new Map();
  #busy = new Map();
  #operationTails = new Map();
  #operationWaiting = new Map();
  constructor({ gateway, bots, goals, memory, semanticMemory, discovery, logistics, acquisition, ml, hive, events, logger, maxQueuePerBot }) { if (!Number.isInteger(maxQueuePerBot) || maxQueuePerBot < 1) throw new ValidationError('Coordinator queue limit must be a positive integer'); this.gateway = gateway; this.bots = bots; this.goals = goals; this.memory = memory; this.semanticMemory = semanticMemory; this.discovery = discovery; this.logistics = logistics; this.acquisition = acquisition ?? null; this.ml = ml; this.hive = hive; this.events = events; this.logger = logger; this.maxQueuePerBot = maxQueuePerBot; }
  status() { const depths = [...this.#operationWaiting.values()]; const maximumDepth = Math.max(0, ...depths); return { llm: this.gateway.status(), bots: this.bots.list().length, coordination: 'semantic-ml-hivemind-resource-planning', queuedOperations: depths.reduce((sum, count) => sum + count, 0), queues: Object.fromEntries(this.#operationWaiting), maxQueuePerBot: this.maxQueuePerBot, maximumDepth, saturation: maximumDepth / this.maxQueuePerBot }; }
  fleetView() {
    const bots = this.bots.list();
    return bots.map(bot => ({ id: bot.id, alias: bot.metadata.commandAlias ?? bot.name, class: bot.metadata.className ?? 'worker', status: bot.status,
      server: serverIdentity(this.bots.get(bot.id).options), dimension: bot.runtime.dimension, position: bot.runtime.position, inventory: bot.runtime.inventorySummary,
      nearby: nearestTo(bot, bots, this.bots).slice(0, 12).map(candidate => ({ id: candidate.id, alias: candidate.metadata.commandAlias ?? candidate.name, distance: round(candidate.distance), status: candidate.status, inventory: candidate.runtime.inventorySummary })) }));
  }
  shouldHandle(botId, selector) { return this.#select(selector).map(bot => bot.id).sort()[0] === botId; }
  coordinateOnce(key, request) { const recent = this.#recent.get(key); if (recent && Date.now() - recent.createdAt < 3000) return recent.promise; const promise = this.coordinate(request).finally(() => { const timer = setTimeout(() => this.#recent.delete(key), 3000); timer.unref?.(); }); this.#recent.set(key, { createdAt: Date.now(), promise }); return promise; }
  async coordinate({ text, selector, actor = 'api' }) {
    if (typeof text !== 'string' || !text.trim()) throw new ValidationError('Coordinator request text is required');
    this.hive.syncMembers(this.bots.list()); const memoryTargets = this.#select(selector ?? 'auto'); const targetRuntime = memoryTargets.length ? this.bots.get(memoryTargets[0].id) : null; const rawMemories = targetRuntime ? await this.memory?.forBot(targetRuntime, { limit: 12 }) : []; const identity = targetRuntime ? serverIdentity(targetRuntime.options) : null; const semantic = targetRuntime ? await this.semanticMemory.recall({ text, worldKey: `${identity.host}:${identity.port}`, dimension: targetRuntime.adapter.snapshot().dimension, sourceBotId: targetRuntime.id, limit: 8 }) : []; const memories = [...rawMemories.map(memory => ({ kind: 'world', type: memory.type, name: memory.name, position: memory.position, confidence: memory.confidence, updatedAt: memory.updatedAt })), ...semantic.map(memory => ({ kind: 'semantic', type: memory.type, content: memory.content, confidence: memory.confidence, relevance: memory.relevance, source: memory.source }))];
    const intent = await this.gateway.interpret(text, { selector, fleet: this.fleetView(), memories, conversationId: `${actor}:${selector ?? 'auto'}` });
    const selected = await rankByPrediction(this.#select(intent.selector), intent.intent, this.ml); if (!selected.length) throw new ConflictError(`No available bots match '${intent.selector}'`);
    const singleton = ['register_storage', 'retrieve', 'stock'].includes(intent.intent); const distributed = ['collect', 'craft', 'smelt', 'store', 'farm', 'deforest', 'reforest'].includes(intent.intent); const targets = singleton ? selected.slice(0, 1) : distributed ? selected.slice(0, Math.min(selected.length, intent.count)) : selected; const counts = distribute(intent.count, targets.length);
    this.#reserve(targets.map(bot => bot.id));
    const started = performance.now(); try {
      await this.events.publish('coordinator.requested', { actor, text, intent, targets: targets.map(bot => bot.id) }, { source: 'fleet-coordinator' });
      const results = await Promise.allSettled(targets.map((bot, index) => this.#enqueueBot(bot.id, { ...intent, count: counts[index] })));
      const response = { intent, results: results.map((result, index) => ({ botId: targets[index].id, status: result.status === 'fulfilled' ? 'COMPLETED' : 'FAILED', result: result.value, error: result.reason?.message })) };
      const durationMs = performance.now() - started; await Promise.all(response.results.map(result => this.ml.recordOutcome({ botId: result.botId, intent: intent.intent, success: result.status === 'COMPLETED', durationMs, features: botFeatures(this.bots.get(result.botId).snapshot(), intent.intent, selected.length), source: 'coordinator' })));
      await Promise.all(response.results.map(result => { const runtime = this.bots.get(result.botId); const server = serverIdentity(runtime.options); return this.semanticMemory.rememberShortTerm({ content: `${intent.intent} oleh ${result.botId}: ${result.status}${result.error ? ` - ${result.error}` : ''}`, visibility: 'HIVE', worldKey: `${server.host}:${server.port}`, dimension: runtime.adapter.snapshot().dimension, source: 'fleet-coordinator', sourceBotId: result.botId, confidence: result.status === 'COMPLETED' ? 0.9 : 0.7, importance: result.status === 'COMPLETED' ? 0.5 : 0.8, tags: [intent.intent, result.status.toLowerCase()], metadata: { actor, memoryClass: 'episodic' } }); }));
      await this.events.publish('coordinator.completed', response, { source: 'fleet-coordinator' }); return response;
    } finally { this.#release(targets.map(bot => bot.id)); }
  }
  #enqueueBot(botId, intent) { const waiting = this.#operationWaiting.get(botId) ?? 0; if (waiting >= this.maxQueuePerBot) throw new ConflictError(`Coordinator queue for bot '${botId}' reached its limit of ${this.maxQueuePerBot}`); const previous = this.#operationTails.get(botId) ?? Promise.resolve(); this.#operationWaiting.set(botId, waiting + 1); const operation = previous.then(async () => { this.#operationWaiting.set(botId, this.#operationWaiting.get(botId) - 1); if (!this.#operationWaiting.get(botId)) this.#operationWaiting.delete(botId); await this.events.publish('coordinator.bot.started', { botId, intent: intent.intent }, { source: 'fleet-coordinator' }); try { const result = await this.#execute(botId, intent); await this.events.publish('coordinator.bot.completed', { botId, intent: intent.intent }, { source: 'fleet-coordinator' }); return result; } catch (error) { await this.events.publish('coordinator.bot.failed', { botId, intent: intent.intent, error: error.message }, { source: 'fleet-coordinator' }); throw error; } }); const tail = operation.then(() => undefined, () => undefined); this.#operationTails.set(botId, tail); void tail.then(() => { if (this.#operationTails.get(botId) === tail) this.#operationTails.delete(botId); }); return operation; }
  #select(selector = 'auto') {
    const available = this.bots.list().filter(bot => AVAILABLE_STATES.has(bot.status));
    if (selector === 'global') return available;
    if (selector.startsWith('bot:')) { const name = selector.slice(4).toLowerCase(); return available.filter(bot => bot.id.toLowerCase() === name || String(bot.metadata.commandAlias ?? bot.name).toLowerCase() === name); }
    if (selector.startsWith('class:')) { const name = selector.slice(6).toLowerCase(); return available.filter(bot => String(bot.metadata.className ?? 'worker').toLowerCase() === name); }
    return available.slice(0, 1);
  }
  async #execute(botId, intent) {
    const runtime = this.bots.get(botId); const adapter = runtime.adapter;
    if (intent.intent === 'status') return runtime.snapshot();
    if (intent.intent === 'converse') return { reply: intent.reply };
    if (intent.intent === 'follow') return adapter.followPlayer({ username: intent.player });
    if (intent.intent === 'come') return adapter.comeToPlayer({ username: intent.player });
    if (intent.intent === 'move') return adapter.smartMove({ x: intent.x, y: intent.y, z: intent.z });
    if (intent.intent === 'set_home') return adapter.setHome({ name: intent.home });
    if (intent.intent === 'home') return adapter.goHome({ name: intent.home });
    if (intent.intent === 'survey') {
      const survey = await adapter.survey({ maxDistance: intent.radius }); return this.discovery.record({ runtime, survey, reason: 'command' });
    }
    if (intent.intent === 'register_storage') return this.logistics.registerNearest({ runtime, name: intent.name, maxDistance: intent.radius });
    if (intent.intent === 'store') return this.logistics.store({ runtime, storageName: intent.name, item: intent.item, count: intent.count });
    if (intent.intent === 'retrieve') return this.logistics.retrieve({ runtime, storageName: intent.name, item: intent.item, count: intent.count });
    if (intent.intent === 'stock') { const server = serverIdentity(runtime.options); return { storages: await this.logistics.stock({ worldKey: `${server.host}:${server.port}`, dimension: adapter.snapshot().dimension }) }; }
    if (intent.intent === 'remember') { const snapshot = adapter.snapshot(); return this.memory.remember({ ...runtime.options, dimension: snapshot.dimension, position: snapshot.position, name: intent.name, type: intent.type, sourceBotId: botId }); }
    if (intent.intent === 'place') { const places = await this.memory.forBot(runtime, { name: intent.name, limit: 1 }); if (!places.length) throw new ConflictError(`Shared memory '${intent.name}' was not found in this world`); return { memory: places[0], movement: await adapter.smartMove({ ...places[0].position, range: 2 }) }; }
    if (intent.intent === 'farm') { const requirements = typeof adapter.farmRequirements === 'function' ? await adapter.farmRequirements({ crop: intent.crop, count: intent.count }) : { needsHoe: true, needsSeed: false }; const equipment = requirements.needsHoe ? await this.#ensureEquipment(botId, HOES) : null; const seed = requirements.needsSeed ? await this.#acquireItem(botId, requirements.seed, 1, new Set()) : null; return { requirements, equipment, seed, farming: await adapter.farm({ crop: intent.crop, count: intent.count }) }; }
    if (intent.intent === 'deforest') { const equipment = await this.#ensureEquipment(botId, AXES); const result = await adapter.deforest({ log: intent.block ?? 'any', count: intent.count, replant: intent.replant }); for (const [index, site] of result.sites.entries()) await this.memory.remember({ ...runtime.options, dimension: adapter.snapshot().dimension, position: site, name: `tree-site-${Date.now()}-${index}`, type: 'tree_site', sourceBotId: botId, metadata: { log: site.log, replantRequested: intent.replant } }); return { equipment, ...result }; }
    if (intent.intent === 'reforest') { const sites = await this.memory.forBot(runtime, { type: 'tree_site', limit: intent.count }); return adapter.reforest({ count: intent.count, sites: sites.map(site => ({ ...site.position, log: site.metadata?.log })) }); }
    if (intent.intent === 'combat') { const equipment = await this.#ensureEquipment(botId, SWORDS); const snapshot = adapter.snapshot(); let position = intent.mode === 'guard' ? snapshot.position : undefined; if (intent.mode === 'guard' && intent.name) { const place = (await this.memory.forBot(runtime, { name: intent.name, limit: 1 }))[0]; if (!place) throw new ConflictError(`Guard place '${intent.name}' was not found in shared memory`); position = place.position; } return { equipment, combat: await adapter.startCombat({ mode: intent.mode, position, radius: intent.radius }) }; }
    if (intent.intent === 'craft') { const preparation = await this.#prepareCraft(botId, intent.item, intent.count, new Set()); return { preparation, crafted: await adapter.craftItem({ item: intent.item, count: intent.count }) }; }
    if (intent.intent === 'smelt') return this.#prepareSmelt(botId, intent.item, intent.count, new Set());
    if (intent.intent === 'collect') {
      const preparation = await this.#ensureToolForBlock(botId, intent.block, new Set());
      const goal = this.goals.create({ description: `Coordinator collect ${intent.count} ${intent.block}`, priority: 70, constraints: { preferredBot: botId }, steps: [{ type: 'collect', input: { block: intent.block, count: intent.count }, requiredCapabilities: ['minecraft.collection'], timeout: 300_000, retries: 1, reportLifecycle: false }] });
      return { preparation, goal: await this.goals.run(goal.id) };
    }
    throw new ValidationError(`Unsupported coordinator intent '${intent.intent}'`);
  }
  async #ensureToolForBlock(botId, block, visiting) {
    const key = `${botId}:${block}`; if (visiting.has(key)) throw new ConflictError(`Tool dependency cycle while preparing to mine '${block}'`); visiting.add(key);
    const target = this.bots.get(botId); const analysis = await target.adapter.analyzeBlock({ block });
    if (!analysis.diggable) throw new ConflictError(`Block '${block}' is not diggable`);
    if (analysis.handMineable || !analysis.requiredTools.length) { visiting.delete(key); return { block, required: false, source: 'hand' }; }
    const existing = findInventoryItem(target.adapter.snapshot(), analysis.requiredTools); if (existing) { visiting.delete(key); return { block, required: true, tool: existing, source: 'inventory' }; }
    if (this.acquisition) {
      try {
        const plan = await this.acquisition.request({ requesterBotId: botId, type: 'TOOL', category: 'TOOL', acceptedItems: analysis.requiredTools, minimumTier: 'WOODEN', count: 1, purpose: `prepare tool for ${block}` });
        if (plan.status === 'SATISFIED' || plan.status === 'CRAFT_READY') {
          const tool = findInventoryItem(target.adapter.snapshot(), analysis.requiredTools) ?? analysis.requiredTools[0];
          visiting.delete(key);
          return { block, required: true, tool, source: plan.status === 'SATISFIED' ? 'acquisition-inventory' : 'acquisition-craft', plan };
        }
      } catch (error) {
        this.logger?.warn?.('coordinator.acquisition.tool-fallback', { botId, block, error: error.message });
      }
    }
    const borrowed = await this.#borrowNearest(botId, analysis.requiredTools, 1);
    if (borrowed) { visiting.delete(key); return { block, required: true, tool: borrowed.item, source: 'nearest-bot', donor: borrowed.donor, distance: borrowed.distance }; }
    let lastError;
    for (const tool of [...analysis.requiredTools].sort(toolOrder)) {
      try { const preparation = await this.#prepareCraft(botId, tool, 1, visiting); await target.adapter.craftItem({ item: tool, count: 1 }); if (findInventoryItem(target.adapter.snapshot(), [tool])) { visiting.delete(key); return { block, required: true, tool, source: 'crafted', preparation }; } }
      catch (error) { lastError = error; }
    }
    visiting.delete(key); throw new ConflictError(`No valid tool could be prepared for '${block}': ${lastError?.message ?? 'no craftable tool or donor'}`);
  }
  async #prepareCraft(botId, item, count, visiting) {
    const target = this.bots.get(botId); const available = itemCount(target.adapter.snapshot(), item); if (available >= count) return { item, count, source: 'inventory' };
    try { await target.adapter.craftItem({ item, count }); return { item, count, source: 'existing-materials' }; } catch {}
    const plan = await target.adapter.craftRequirements({ item, count });
    if (plan && Array.isArray(plan.missing) && plan.missing.length === 0) {
      return { item, count, source: 'craft-ready', steps: plan.steps ?? [], recipe: plan };
    }
    const acquisitions = [];
    for (const missing of plan.missing) {
      if (this.acquisition) {
        try {
          const result = await this.acquisition.request({ requesterBotId: botId, type: 'ITEM', item: missing.name, count: missing.count, purpose: `craft ${item}` });
          acquisitions.push({ item: missing.name, count: missing.count, acquisitionResult: result });
          continue;
        } catch (error) {
          this.logger?.warn?.('coordinator.acquisition.craft-fallback', { botId, item, missing: missing.name, error: error.message });
        }
      }
      acquisitions.push(await this.#acquireItem(botId, missing.name, missing.count, visiting));
    }
    return { item, count, source: 'prepared-materials', missing: plan.missing, acquisitions, steps: plan.steps };
  }
  async #prepareSmelt(botId, item, count, visiting) {
    const target = this.bots.get(botId); const requirements = await target.adapter.smeltRequirements({ item, count }); if (!requirements) throw new ValidationError(`No supported smelting recipe for '${item}'`);
    let furnacePreparation = null;
    if (!requirements.furnace) { furnacePreparation = await this.#prepareCraft(botId, 'furnace', 1, visiting); if (itemCount(target.adapter.snapshot(), 'furnace') < 1) await target.adapter.craftItem({ item: 'furnace', count: 1 }); }
    const input = await this.#acquireItem(botId, requirements.input.name, requirements.input.count, visiting); const fuel = await this.#acquireItem(botId, requirements.fuel.name, requirements.fuel.count, visiting); const smelted = await target.adapter.smeltItem({ item, count, fuel: requirements.fuel.name }); return { requirements, furnacePreparation, input, fuel, smelted };
  }
  async #acquireItem(botId, item, count, visiting) {
    const target = this.bots.get(botId); let shortage = Math.max(0, count - itemCount(target.adapter.snapshot(), item)); if (!shortage) return { item, count, source: 'inventory' };
    const transfers = [];
    while (shortage > 0) {
      const transfer = await this.#borrowNearest(botId, [item], shortage); if (!transfer) break; transfers.push(transfer); shortage = Math.max(0, count - itemCount(target.adapter.snapshot(), item));
    }
    if (!shortage) return { item, count, source: 'nearby-bots', transfers };
    const sources = await target.adapter.findSourceBlocks({ item }); let lastError;
    for (const block of sources) {
      try { await this.#ensureToolForBlock(botId, block, visiting); await target.adapter.collect({ block, count: shortage, maxDistance: 64 }); shortage = Math.max(0, count - itemCount(target.adapter.snapshot(), item)); if (!shortage) return { item, count, source: 'collected', block, transfers }; }
      catch (error) { lastError = error; }
    }
    const smelting = typeof target.adapter.smeltRequirements === 'function' ? await target.adapter.smeltRequirements({ item, count: shortage }) : null;
    if (smelting) {
      try {
        const furnacePreparation = smelting.furnace ? null : await this.#prepareCraft(botId, 'furnace', 1, visiting); if (!smelting.furnace) await target.adapter.craftItem({ item: 'furnace', count: 1 });
        const input = await this.#acquireItem(botId, smelting.input.name, smelting.input.count, visiting); const fuel = await this.#acquireItem(botId, smelting.fuel.name, smelting.fuel.count, visiting);
        const result = await target.adapter.smeltItem({ item, count: shortage }); if (itemCount(target.adapter.snapshot(), item) >= count) return { item, count, source: 'smelted', furnacePreparation, input, fuel, result, transfers };
      } catch (error) { lastError = error; }
    }
    throw new ConflictError(`Unable to obtain ${shortage} '${item}' from inventory, nearby bots, or reachable blocks${lastError ? `: ${lastError.message}` : ''}`);
  }
  async #borrowNearest(targetId, acceptedItems, requestedCount) {
    const target = this.bots.get(targetId); const activeBots = new Set(this.goals.allTasks().filter(task => task.status === 'RUNNING').map(task => task.assignedBot));
    const targetBot = target.snapshot(); const donors = nearestTo(targetBot, this.bots.list(), this.bots).filter(bot => !activeBots.has(bot.id) && !this.#busy.has(bot.id));
    for (const donor of donors) {
      const item = findInventoryItem(donor.runtime, acceptedItems); if (!item) continue; const available = itemCount(donor.runtime, item); const count = Math.min(requestedCount, available); if (!count) continue;
      this.#reserve([donor.id]);
      try {
        const donorRuntime = this.bots.get(donor.id); const targetBefore = itemCount(target.adapter.snapshot(), item); const donorBefore = itemCount(donorRuntime.adapter.snapshot(), item); const meeting = meetingPoint(target.adapter.snapshot().position, donorRuntime.adapter.snapshot().position); await Promise.all([target.adapter.smartMove({ ...meeting, range: 2 }), donorRuntime.adapter.smartMove({ ...meeting, range: 2 })]); await donorRuntime.adapter.dropItem({ item, count }); const donorAfterDrop = itemCount(donorRuntime.adapter.snapshot(), item); if (donorBefore - donorAfterDrop !== count) throw new ConflictError(`Donor '${donor.id}' dropped ${donorBefore - donorAfterDrop} '${item}', expected ${count}`); const message = `[MineHive handoff] ${targetId}, ${count} ${item} sudah dijatuhkan`; await donorRuntime.adapter.chat(message); await this.events.publish('coordinator.item.dropped', { target: targetId, donor: donor.id, item, count, meeting, message }, { source: 'fleet-coordinator' }); await target.adapter.pickupItem({ item, count }); const targetAfterPickup = itemCount(target.adapter.snapshot(), item); if (targetAfterPickup - targetBefore !== count) throw new ConflictError(`Recipient '${targetId}' picked up ${targetAfterPickup - targetBefore} '${item}', expected ${count}`);
        const result = { item, count, donor: donor.id, distance: round(donor.distance), meeting, notification: message, verified: true }; await this.events.publish('coordinator.item.transferred', { target: targetId, ...result }, { source: 'fleet-coordinator' }); return result;
      } finally { this.#release([donor.id]); }
    }
    return null;
  }
  async #ensureEquipment(botId, acceptedItems) { const target = this.bots.get(botId); const existing = findInventoryItem(target.adapter.snapshot(), acceptedItems); if (existing) return { item: existing, source: 'inventory' }; const borrowed = await this.#borrowNearest(botId, acceptedItems, 1); if (borrowed) return { ...borrowed, source: 'nearest-bot' }; let lastError; for (const item of [...acceptedItems].sort(toolOrder)) { try { const preparation = await this.#prepareCraft(botId, item, 1, new Set()); await target.adapter.craftItem({ item, count: 1 }); if (itemCount(target.adapter.snapshot(), item)) return { item, source: 'crafted', preparation }; } catch (error) { lastError = error; } } throw new ConflictError(`Unable to prepare equipment: ${lastError?.message ?? 'no item, donor, or recipe'}`); }
  #reserve(ids) { for (const id of ids) this.#busy.set(id, (this.#busy.get(id) ?? 0) + 1); }
  #release(ids) { for (const id of ids) { const count = (this.#busy.get(id) ?? 1) - 1; if (count > 0) this.#busy.set(id, count); else this.#busy.delete(id); } }
}

function nearestTo(target, bots, manager) {
  if (!target.runtime.position) return [];
  return bots.filter(bot => bot.id !== target.id && AVAILABLE_STATES.has(bot.status) && bot.runtime.position && bot.runtime.dimension === target.runtime.dimension && sameServer(manager.get(bot.id).options, manager.get(target.id).options))
    .map(bot => ({ ...bot, distance: distance(target.runtime.position, bot.runtime.position) })).sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id));
}
function findInventoryItem(snapshot, accepted) { return accepted.find(name => itemCount(snapshot, name) > 0); }
function itemCount(snapshot, name) { return snapshot.inventorySummary?.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0) ?? 0; }
function distance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z); }
function meetingPoint(left, right) { if (!left || !right || ![left.x, left.y, left.z, right.x, right.y, right.z].every(value => Number.isFinite(Number(value)))) throw new ConflictError('Both bots require finite positions for an item handoff'); return { x: Math.round((Number(left.x) + Number(right.x)) / 2), y: Math.ceil(Math.max(Number(left.y), Number(right.y))), z: Math.round((Number(left.z) + Number(right.z)) / 2) }; }
function round(value) { return Math.round(value * 100) / 100; }
function toolOrder(left, right) { return toolTier(left) - toolTier(right) || left.localeCompare(right); }
function toolTier(name) { const material = Object.keys(TOOL_TIER).find(value => name.startsWith(`${value}_`)); return TOOL_TIER[material] ?? 99; }
function serverIdentity(options = {}) { return { host: options.host ?? 'localhost', port: Number(options.port ?? 25565) }; }
function sameServer(left = {}, right = {}) { const a = serverIdentity(left); const b = serverIdentity(right); return String(a.host).toLowerCase() === String(b.host).toLowerCase() && a.port === b.port; }
function distribute(total, slots) { const base = Math.floor(total / slots); const remainder = total % slots; return Array.from({ length: slots }, (_, index) => base + (index < remainder ? 1 : 0)); }
async function rankByPrediction(bots, intent, ml) { const candidates = await Promise.all(bots.map(async (bot, index) => ({ bot, index, prediction: await ml.predict({ botId: bot.id, intent, features: botFeatures(bot, intent, bots.length) }) }))); return candidates.sort((left, right) => right.prediction.prediction - left.prediction.prediction || left.index - right.index).map(candidate => candidate.bot); }
function botFeatures(bot, intent, fleetSize) { const inventory = bot.runtime?.inventorySummary ?? []; return { intent, className: String(bot.metadata?.className ?? 'worker'), healthBand: band(bot.runtime?.health, 5), foodBand: band(bot.runtime?.food, 5), inventoryStacks: inventory.length, hasTool: inventory.some(item => /_(pickaxe|axe|hoe|sword)$/.test(item.name)), fleetSize }; }
function band(value, size) { const number = Number(value); return Number.isFinite(number) ? Math.floor(number / size) * size : -1; }
