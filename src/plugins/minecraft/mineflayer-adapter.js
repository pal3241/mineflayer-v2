import { EventEmitter } from 'node:events';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { NavigationError } from '../../navigation/navigation-error.js';
import { SurvivalCapabilityError } from '../../survival/survival-errors.js';

const SMELTING_RECIPES = Object.freeze({
  iron_ingot: 'raw_iron', gold_ingot: 'raw_gold', copper_ingot: 'raw_copper',
  cooked_beef: 'beef', cooked_porkchop: 'porkchop', cooked_mutton: 'mutton', cooked_chicken: 'chicken', cooked_rabbit: 'rabbit',
  cooked_cod: 'cod', cooked_salmon: 'salmon', baked_potato: 'potato', dried_kelp: 'kelp'
});
const SMELTING_FUELS = Object.freeze({ coal: 8, charcoal: 8 });
const CROP_ITEMS = Object.freeze({ wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato', beetroot: 'beetroot_seeds' });
const CROP_AGE = Object.freeze({ wheat: 7, carrots: 7, potatoes: 7, beetroot: 3 });
const HOSTILE_MOBS = new Set(['zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'drowned', 'husk', 'stray', 'witch', 'pillager', 'vindicator', 'evoker', 'ravager', 'phantom', 'slime', 'magma_cube', 'guardian', 'elder_guardian', 'blaze', 'ghast', 'hoglin', 'zoglin', 'piglin_brute', 'silverfish', 'endermite', 'shulker', 'wither_skeleton']);
const MEAT_MOBS = new Set(['cow', 'sheep', 'pig', 'chicken', 'rabbit', 'mooshroom']);
const STORAGE_BLOCKS = new Set(['chest', 'trapped_chest', 'barrel', 'shulker_box']);
const SURVEY_MARKERS = Object.freeze([
  { block: 'bell', type: 'village', confidence: 0.95 },
  { block: 'end_portal_frame', type: 'stronghold', confidence: 0.99 },
  { block: 'reinforced_deepslate', type: 'ancient_city', confidence: 0.99 },
  { block: 'trial_spawner', type: 'trial_chamber', confidence: 0.98 },
  { block: 'diamond_ore', type: 'resource', confidence: 0.95 },
  { block: 'deepslate_diamond_ore', type: 'resource', confidence: 0.95 },
  { block: 'ancient_debris', type: 'resource', confidence: 0.98 },
  { block: 'emerald_ore', type: 'resource', confidence: 0.9 },
  { block: 'deepslate_emerald_ore', type: 'resource', confidence: 0.9 }
]);

export class MineflayerAdapter extends EventEmitter {
  constructor({ factory, plugins = true, autoEat = {} } = {}) { super(); this.factory = factory; this.plugins = plugins; this.autoEatConfig = { enabled: true, minHunger: 15, ...autoEat }; this.client = null; this.status = 'DISCONNECTED'; this.pluginStatus = {}; this.homes = new Map(); this.combatState = { mode: 'OFF', status: 'IDLE' }; this.lastAliveState = null; this.alive = false; this.interactionCooldowns = new Map(); this.currentSleepState = { state: 'IDLE', bed: null, error: null }; }

  async connect(options) {
    if (this.client) return;
    const factory = this.factory ?? (await import('mineflayer')).createBot;
    this.status = 'CONNECTING'; this.lastAliveState = null; this.alive = false;
    this.client = factory(options);
    if (this.plugins) await this.#loadPlugins();
    for (const name of ['login', 'spawn', 'end', 'kicked', 'error', 'health', 'move', 'chat', 'whisper']) this.client.on(name, (...args) => this.emit(name, ...args));
    this.client.on('health', () => this.#captureAliveState()); this.client.on('move', () => this.#captureAliveState()); this.client.inventory?.on?.('updateSlot', () => { this.#captureAliveState(); this.emit('inventoryUpdate', this.snapshot().inventorySummary); });
    this.client.on('death', () => { const state = this.lastAliveState ?? recoveryState(this.client); this.alive = false; this.emit('death', { ...state, cause: deathCause(this.client), keepInventory: keepInventoryState(this.client), detectedAt: new Date().toISOString() }); });
    this.client.on('spawn', () => { this.status = 'READY'; this.alive = true; this.#captureAliveState(); void this.#configureMovement().catch(error => { this.status = 'DEGRADED'; this.emit('pluginError', { plugin: 'movement', error }); }); });
    this.client.once('end', () => { this.status = 'DISCONNECTED'; this.alive = false; this.lastAliveState = null; this.client = null; });
  }

  async #loadPlugins() {
    try { const module = await import('mineflayer-pathfinder'); this.pathfinderModule = module; this.client.loadPlugin(module.pathfinder ?? module.default?.pathfinder); this.pluginStatus.pathfinder = 'HEALTHY'; }
    catch (error) { this.pluginStatus.pathfinder = 'FAILED'; this.emit('pluginError', { plugin: 'pathfinder', error }); }
    try { const module = await import('mineflayer-collectblock'); this.client.loadPlugin(module.plugin ?? module.default?.plugin); this.pluginStatus.collectblock = 'HEALTHY'; }
    catch (error) { this.pluginStatus.collectblock = 'FAILED'; this.emit('pluginError', { plugin: 'collectblock', error }); }
    if (this.autoEatConfig.enabled) {
      try { const module = await import('mineflayer-auto-eat'); this.autoEatLoader = module.loader; this.pluginStatus.autoEat = 'LOADED'; }
      catch (error) { this.pluginStatus.autoEat = 'FAILED'; this.emit('pluginError', { plugin: 'auto-eat', error }); }
    } else this.pluginStatus.autoEat = 'DISABLED';
  }

  async #configureMovement() {
    if (!this.client?.pathfinder || !this.pathfinderModule) return;
    const Movements = this.pathfinderModule.Movements ?? this.pathfinderModule.default?.Movements;
    if (Movements) this.#applyMovementPolicy({ allow1by1towers: false, allowBridge: false, allowParkour: false, allowSprinting: true, allowFreeMotion: false, maxDropDown: 3, placeCost: Number.POSITIVE_INFINITY, scaffoldItems: [] });
    if (this.autoEatLoader && !this.client.autoEat) {
      this.client.loadPlugin(this.autoEatLoader); this.client.autoEat.setOpts({ minHunger: this.autoEatConfig.minHunger }); this.client.autoEat.enableAuto(); this.pluginStatus.autoEat = 'HEALTHY';
    }
  }

  #applyMovementPolicy(policy) {
    if (!this.client?.pathfinder || !this.pathfinderModule) return;
    const Movements = this.pathfinderModule.Movements ?? this.pathfinderModule.default?.Movements; if (!Movements) return;
    const movements = new Movements(this.client); movements.allow1by1towers = Boolean(policy.allow1by1towers); movements.allowParkour = Boolean(policy.allowParkour); movements.allowSprinting = Boolean(policy.allowSprinting); movements.allowFreeMotion = Boolean(policy.allowFreeMotion); movements.maxDropDown = Math.min(Number(policy.maxDropDown ?? 3), movements.maxDropDown); movements.placeCost = Number(policy.placeCost); movements.scafoldingBlocks = (policy.scaffoldItems ?? []).map(item => this.client.registry?.itemsByName?.[item]?.id).filter(Number.isInteger); configureDoorNavigation(movements, this.client.registry); this.client.pathfinder.setMovements(movements); if (this.client.collectBlock) this.client.collectBlock.movements = movements;
  }

  #ready(capability) { if (!this.client || this.status !== 'READY') throw new ValidationError(`Cannot use '${capability}' while bot is ${this.status}`); return this.client; }
  #captureAliveState() { if (!this.client || Number(this.client.health ?? 20) <= 0) return; this.lastAliveState = recoveryState(this.client); }
  #abort(signal, action) { if (!signal) return () => {}; const handler = () => action(); if (signal.aborted) handler(); else signal.addEventListener('abort', handler, { once: true }); return () => signal.removeEventListener('abort', handler); }

  async chat(message) { const bot = this.#ready('chat'); bot.chat(String(message).slice(0, 240)); return { sent: true }; }
  async navigate(input, context) { return this.navigateTo({ position: { x: input?.x, y: input?.y, z: input?.z }, tolerance: input?.range }, context); }
  async navigateTo(input, context) {
    const position = input?.position; const signal = context?.signal;
    const bot = this.#ready('navigation'); if (!bot.pathfinder) throw new ValidationError('Pathfinder plugin is unavailable');
    for (const value of [position?.x, position?.y, position?.z]) if (!Number.isFinite(Number(value))) throw new ValidationError('Navigation requires numeric x, y, z');
    this.#applyMovementPolicy(input?.movement ?? input?.policy?.movement ?? { allow1by1towers: false, allowBridge: false, allowParkour: false, allowSprinting: true, allowFreeMotion: false, maxDropDown: 3, placeCost: Number.POSITIVE_INFINITY, scaffoldItems: [] }); const destination = { x: Number(position.x), y: Number(position.y), z: Number(position.z) }; const acceptedRange = boundedDistance(input?.tolerance ?? 1, 0, 64, 'Navigation range'); const goals = this.pathfinderModule.goals ?? this.pathfinderModule.default?.goals; const goal = new goals.GoalNear(destination.x, destination.y, destination.z, acceptedRange);
    const cleanupAbort = this.#abort(signal, () => bot.pathfinder.setGoal(null)); const guard = navigationGuard(bot, destination, acceptedRange, 10_000, Boolean((input?.movement?.scaffoldItems ?? []).length));
    try { await Promise.race([bot.pathfinder.goto(goal), guard.promise]); const finalPosition = this.snapshot().position; if (!finalPosition || distance3(finalPosition, destination) > acceptedRange + 1) throw new ValidationError(`Navigation ended outside target range: target ${destination.x},${destination.y},${destination.z}, actual ${formatPosition(finalPosition)}`); return { position: finalPosition }; }
    catch (error) { bot.pathfinder.setGoal(null); throw error; } finally { guard.stop(); cleanupAbort(); this.#applyMovementPolicy(safeMovementPolicy()); }
  }
  async stopNavigation() { const bot = this.#ready('navigation-stop'); bot.pathfinder?.setGoal(null); return { stopped: true }; }
  async controlledRecovery(input, context) {
    const bot = this.#ready('navigation-recovery'); const action = String(input?.action ?? '').toUpperCase(); const controls = { JUMP: ['jump'], BACKWARD: ['back'], STRAFE_LEFT: ['left'], STRAFE_RIGHT: ['right'] }[action]; if (!controls) throw new NavigationError('RECOVERY_ACTION_INVALID', `Unsupported micro escape action '${action}'`, { action }); const durationMs = boundedTimeout(input?.durationMs ?? 350, 100, 2_000, 'Micro escape durationMs'); const threshold = boundedDistance(input?.minimumDisplacement ?? 0.25, 0.05, 4, 'Micro escape minimumDisplacement'); const start = validRecoveryPosition(bot.entity.position); for (const control of controls) bot.setControlState(control, true); try { await cancellableDelay(durationMs, context?.signal); } finally { for (const control of controls) bot.setControlState(control, false); } const end = validRecoveryPosition(bot.entity.position); const displacement = distance3(start, end); if (displacement < threshold) throw new NavigationError('MICRO_ESCAPE_NOT_VERIFIED', `Micro escape '${action}' moved only ${displacement.toFixed(3)} blocks`, { action, start, end, displacement, threshold }); return { action, start, end, displacement, verified: true };
  }
  async safePillarStep(input, context) {
    const bot = this.#ready('navigation-pillar'); if (context?.signal?.aborted) throw context.signal.reason ?? new NavigationError('PILLAR_CANCELLED', 'Pillar step was cancelled', {}); const itemName = String(input?.item ?? '').trim(); const item = bot.inventory.items().find(entry => entry.name === itemName); if (!item) throw new NavigationError('PILLAR_RESOURCE_UNAVAILABLE', `Scaffold item '${itemName}' is unavailable`, { item: itemName }); const start = bot.entity.position; const pillarStartY = Number(input?.pillarStartY ?? start.y); if (start.y - pillarStartY >= Number(input?.maxPillarHeight ?? 0)) throw new NavigationError('PILLAR_HEIGHT_EXCEEDED', 'Maximum pillar height was reached', { pillarStartY, currentY: start.y, maxPillarHeight: Number(input?.maxPillarHeight ?? 0) }); const feet = start.floored(); const base = bot.blockAt(feet.offset(0, -1, 0)); const head = bot.blockAt(feet.offset(0, 1, 0)); const nextHead = bot.blockAt(feet.offset(0, 2, 0)); if (!base || isAir(base)) throw new NavigationError('PILLAR_SUPPORT_MISSING', 'Pillar step has no supporting block below the bot', { position: { x: feet.x, y: feet.y - 1, z: feet.z } }); if (!isAir(head) || !isAir(nextHead)) throw new NavigationError('PILLAR_CLEARANCE_BLOCKED', 'Pillar head clearance is blocked', { position: { x: feet.x, y: feet.y, z: feet.z } }); const target = base.position.offset(0, 1, 0); if (!isAir(bot.blockAt(target))) throw new NavigationError('PILLAR_TARGET_OCCUPIED', 'Pillar target is occupied', { position: { x: target.x, y: target.y, z: target.z } }); const { Vec3 } = await import('vec3'); await bot.equip(item, 'hand'); bot.setControlState('jump', true); let placed = false; try { await waitForVerticalPosition(bot, start.y + 0.35, context?.signal); await bot.placeBlock(base, new Vec3(0, 1, 0)); const placedBlock = bot.blockAt(target); if (!placedBlock || placedBlock.name !== itemName) throw new NavigationError('PILLAR_PLACEMENT_NOT_VERIFIED', 'Navigation scaffold block was not found after placement', { item: itemName, position: { x: target.x, y: target.y, z: target.z } }); placed = true; await waitForVerticalPosition(bot, start.y + 0.8, context?.signal); return { position: { x: target.x, y: target.y, z: target.z }, item: itemName, verified: true }; } catch (error) { if (placed) { error.details = { ...(error.details ?? {}), blockPlaced: true, position: { x: target.x, y: target.y, z: target.z }, item: itemName }; } throw error instanceof NavigationError ? error : new NavigationError('PILLAR_STEP_FAILED', `Pillar step failed: ${error.message}`, { cause: error.message }); } finally { bot.setControlState('jump', false); }
  }
  resolveNavigationTarget(target) {
    const bot = this.#ready('navigation-target'); const type = String(target?.type ?? '').toUpperCase();
    if (type === 'PLAYER') { const actualName = Object.keys(bot.players ?? {}).find(name => name.toLowerCase() === String(target.username).toLowerCase()); const entity = bot.players?.[actualName]?.entity; if (!entity?.position) throw new NotFoundError('Visible player', target.username); return validRecoveryPosition(entity.position); }
    if (type === 'ENTITY') { const entity = Object.values(bot.entities ?? {}).find(value => String(value?.id) === String(target.entityId)); if (!entity?.position) throw new NotFoundError('Entity', target.entityId); return validRecoveryPosition(entity.position); }
    throw new ValidationError(`Unsupported adapter navigation target '${type}'`);
  }
  async followPlayer({ username, range = 2 }, { signal } = {}) {
    const bot = this.#ready('follow-player'); const actualName = Object.keys(bot.players ?? {}).find(name => name.toLowerCase() === String(username).toLowerCase()); const entity = bot.players?.[actualName]?.entity;
    if (!entity) throw new ValidationError(`Player '${username}' is not visible`);
    if (!bot.pathfinder) throw new ValidationError('Pathfinder plugin is unavailable');
    this.#applyMovementPolicy(safeMovementPolicy()); const acceptedRange = boundedDistance(range, 1, 64, 'Follow range'); const goals = this.pathfinderModule.goals ?? this.pathfinderModule.default?.goals; bot.pathfinder.setGoal(new goals.GoalFollow(entity, acceptedRange), true);
    this.#abort(signal, () => { bot.pathfinder.setGoal(null); this.#applyMovementPolicy(safeMovementPolicy()); }); return { following: actualName, range };
  }
  async comeToPlayer({ username, range = 1 }, context = {}) { const bot = this.#ready('come'); const actualName = Object.keys(bot.players ?? {}).find(name => name.toLowerCase() === String(username).toLowerCase()); const entity = bot.players?.[actualName]?.entity; if (!entity) throw new ValidationError(`Player '${username}' is not visible`); return this.navigate({ x: entity.position.x, y: entity.position.y, z: entity.position.z, range }, context); }
  async setHome({ name = 'home' } = {}) { const position = this.#ready('set-home').entity.position; const home = { x: position.x, y: position.y, z: position.z, dimension: this.client.game?.dimension }; this.homes.set(name, home); return { name, ...home }; }
  async goHome({ name = 'home', range = 1 } = {}, context = {}) { const home = this.homes.get(name); if (!home) throw new ValidationError(`Home '${name}' has not been set`); if (home.dimension && this.client.game?.dimension !== home.dimension) throw new ValidationError(`Home '${name}' is in ${home.dimension}`); return this.navigate({ ...home, range }, context); }
  async smartMove(input, context = {}) {
    if (input.player) return this.followPlayer({ username: input.player, range: input.range ?? 2 }, context);
    if (input.home) return this.goHome({ name: input.home, range: input.range }, context);
    return this.navigate(input, context);
  }
  async analyzeBlock({ block }) {
    const bot = this.#ready('block-analysis'); const definition = bot.registry?.blocksByName?.[block]; if (!definition) throw new ValidationError(`Unknown block '${block}'`);
    const requiredTools = Object.keys(definition.harvestTools ?? {}).map(id => bot.registry.items?.[Number(id)]?.name).filter(Boolean);
    return { block, diggable: definition.diggable !== false, material: definition.material ?? null, handMineable: requiredTools.length === 0, requiredTools };
  }
  toolRequirementForBlock(block) {
    const bot = this.#ready('tool-requirement'); const definition = bot.registry?.blocksByName?.[block]; if (!definition) throw new ValidationError(`Unknown block '${block}'`); const tools = Object.keys(definition.harvestTools ?? {}).map(id => bot.registry.items?.[Number(id)]?.name).filter(name => String(name).endsWith('_pickaxe')); if (!tools.length) return null; return { type: 'pickaxe', tier: Math.min(...tools.map(toolTier)) };
  }
  async craftRequirements({ item, count = 1 }) {
    const bot = this.#ready('craft-planning'); const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1)); const inventory = inventoryLedger(bot);
    const definition = bot.registry?.itemsByName?.[item]; const recipes = definition ? bot.recipesAll(definition.id, null, true) ?? [] : [];
    if (!recipes.length) return { item, count: amount, craftable: false, missing: [], ingredients: [], steps: [], selectedRecipe: null, alternatives: [] };
    const plan = resolveCraftPlan(bot, item, amount, inventory, new Set(), 0); const alternatives = inspectRecipeAlternatives(bot, item, amount, inventory, plan.recipe);
    return { item, count: amount, craftable: true, missing: missingList(plan.missing), ingredients: craftIngredients(bot, plan), steps: plan.steps, selectedRecipe: alternatives[0] ?? null, alternatives };
  }
  async findSourceBlocks({ item }) {
    const bot = this.#ready('resource-analysis'); const definition = bot.registry?.itemsByName?.[item]; if (!definition) return [];
    const itemId = Number(definition.id);
    const candidates = (bot.registry.blocksArray ?? Object.values(bot.registry.blocksByName ?? {})).filter(block => {
      if (!block || block.diggable === false) return false;
      const dropIds = Array.isArray(block.drops) ? block.drops : [];
      return dropIds.some(dropId => Number(dropId) === itemId || bot.registry.items?.[Number(dropId)]?.name === item || block.name === item);
    });
    return [...new Set(candidates.map(block => block.name))].sort((left, right) => left.localeCompare(right));
  }
  async survey({ maxDistance }) {
    const bot = this.#ready('survey'); const radius = boundedDistance(maxDistance, 8, 128, 'Survey distance');
    if (!Number.isFinite(radius)) throw new ValidationError('Survey distance must be numeric');
    const discoveries = SURVEY_MARKERS.flatMap(marker => {
      const definition = bot.registry?.blocksByName?.[marker.block]; if (!definition) return [];
      return bot.findBlocks({ matching: definition.id, maxDistance: radius, count: 8 }).map(position => ({ type: marker.type, name: marker.block, marker: marker.block, confidence: marker.confidence, position: { x: position.x, y: position.y, z: position.z } }));
    });
    return { maxDistance: radius, scannedAt: new Date().toISOString(), discoveries: uniqueDiscoveries(discoveries).slice(0, 32) };
  }
  async findNearestStorage({ maxDistance }) {
    const bot = this.#ready('storage-discovery'); const radius = Math.max(2, Math.min(64, Number(maxDistance))); if (!Number.isFinite(radius)) throw new ValidationError('Storage search distance must be numeric'); const block = bot.findBlock({ matching: candidate => isStorageBlock(candidate?.name), maxDistance: radius }); if (!block) throw new ValidationError(`No chest or barrel found within ${radius} blocks`); return this.inspectStorage({ position: block.position });
  }
  async inspectStorage({ position }) { return this.#withStorage(position, 'storage-inspection', async container => storageSnapshot(container, position)); }
  async depositStorage({ position, item, count }) {
    const bot = this.#ready('storage-deposit'); const definition = bot.registry?.itemsByName?.[item]; const amount = Math.max(1, Math.min(2304, Number(count))); if (!definition || !Number.isInteger(amount)) throw new ValidationError(`Invalid deposit item or count for '${item}'`); const beforeBot = inventoryCount(bot, item); if (beforeBot < amount) throw new ValidationError(`Bot only has ${beforeBot} '${item}', cannot deposit ${amount}`);
    return this.#withStorage(position, 'storage-deposit', async container => { const beforeStorage = containerCount(container, item); await container.deposit(definition.id, null, amount); const verified = await waitForStorageState(bot, container, item, { bot: beforeBot - amount, storage: beforeStorage + amount }, 5_000, 'deposit'); const storage = storageSnapshot(container, position); return { item, transferred: amount, storage, verification: { botBefore: beforeBot, botAfter: verified.bot, storageBefore: beforeStorage, storageAfter: verified.storage } }; });
  }
  async withdrawStorage({ position, item, count }) {
    const bot = this.#ready('storage-withdraw'); const definition = bot.registry?.itemsByName?.[item]; const amount = Math.max(1, Math.min(2304, Number(count))); if (!definition || !Number.isInteger(amount)) throw new ValidationError(`Invalid withdrawal item or count for '${item}'`);
    return this.#withStorage(position, 'storage-withdraw', async container => { const beforeBot = windowInventoryCount(container, bot, item); const beforeStorage = containerCount(container, item); if (beforeStorage < amount) throw new ValidationError(`Storage only has ${beforeStorage} '${item}', cannot withdraw ${amount}`); await container.withdraw(definition.id, null, amount); const verified = await waitForStorageState(bot, container, item, { bot: beforeBot + amount, storage: beforeStorage - amount }, 5_000, 'withdrawal'); const storage = storageSnapshot(container, position); return { item, transferred: amount, storage, verification: { botBefore: beforeBot, botAfter: verified.bot, storageBefore: beforeStorage, storageAfter: verified.storage } }; });
  }
  async smeltRequirements({ item, count }) {
    const bot = this.#ready('smelting-plan'); const input = SMELTING_RECIPES[item]; if (!input) return null; const amount = smeltingCount(count); const fuel = selectSmeltingFuel(bot, amount, null);
    return { item, count: amount, input: { name: input, count: amount }, fuel, furnace: Boolean(bot.findBlock({ matching: bot.registry.blocksByName?.furnace?.id, maxDistance: 6 })) };
  }
  async smeltItem({ item, count, fuel }, context) {
    const bot = this.#ready('smelting'); const inputName = SMELTING_RECIPES[item]; if (!inputName) throw new ValidationError(`No supported smelting recipe for '${item}'`); const amount = smeltingCount(count); const selectedFuel = selectSmeltingFuel(bot, amount, fuel ?? null); const signal = context?.signal;
    let furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName?.furnace?.id, maxDistance: 6 });
    if (!furnaceBlock) { await this.#ensureCrafted('furnace', 1, new Set(), 0); await this.#placeUtilityBlock('furnace'); furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName.furnace.id, maxDistance: 6 }); }
    if (!furnaceBlock) throw new ValidationError('Could not place furnace');
    const input = bot.registry.itemsByName[inputName]; const fuelDefinition = bot.registry.itemsByName[selectedFuel.name]; if (!input || inventoryCount(bot, inputName) < amount) throw new ValidationError(`Not enough '${inputName}' to smelt ${amount} '${item}'`); if (!fuelDefinition || inventoryCount(bot, selectedFuel.name) < selectedFuel.count) throw new ValidationError(`Not enough '${selectedFuel.name}' for smelting`);
    const furnace = await bot.openFurnace(furnaceBlock); const started = Date.now(); const timeout = Math.max(20_000, amount * 12_000);
    try {
      const occupiedInput = furnace.inputItem?.(); if (occupiedInput?.count) throw new ValidationError(`Furnace input is occupied by '${occupiedInput.name}'`); const occupiedOutput = furnace.outputItem?.(); if (occupiedOutput?.count && occupiedOutput.name !== item) throw new ValidationError(`Furnace output is occupied by '${occupiedOutput.name}'`); if (occupiedOutput?.count) await furnace.takeOutput(); const outputBefore = inventoryCount(bot, item);
      await furnace.putInput(input.id, null, amount); await furnace.putFuel(fuelDefinition.id, null, selectedFuel.count);
      while (furnace.outputItem()?.name !== item || (furnace.outputItem()?.count ?? 0) < amount) { if (signal?.aborted) throw signal.reason ?? new ValidationError('Smelting cancelled'); if (Date.now() - started > timeout) throw new ValidationError(`Smelting '${item}' timed out`); await new Promise(resolve => setTimeout(resolve, 250)); }
      await furnace.takeOutput(); const outputAfter = inventoryCount(bot, item); if (outputAfter - outputBefore !== amount) throw new ValidationError(`Smelting verification failed for '${item}': inventory delta ${outputAfter - outputBefore}, expected ${amount}`); return { item, input: inputName, count: amount, fuel: selectedFuel, inventory: this.snapshot().inventorySummary };
    } finally { furnace.close(); }
  }
  async collect({ block, count = 1, maxDistance = 64 }, { signal } = {}) {
    const bot = this.#ready('collection'); if (!bot.collectBlock) throw new ValidationError('CollectBlock plugin is unavailable');
    const definition = bot.registry?.blocksByName?.[block]; if (!definition) throw new ValidationError(`Unknown block '${block}'`);
    const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1));
    const radius = boundedDistance(maxDistance, 1, 128, 'Collection distance');
    const positions = bot.findBlocks({ matching: candidate => candidate && candidate.name === block, maxDistance: radius, count: amount });
    const blocks = positions.map(position => bot.blockAt(position)).filter(Boolean); if (!blocks.length) throw new ValidationError(`No '${block}' found within ${maxDistance} blocks`);
    this.#applyMovementPolicy(safeMovementPolicy()); const cleanup = this.#abort(signal, () => { void bot.collectBlock.cancelTask(); });
    try { await bot.collectBlock.collect(blocks); return { block, requested: amount, collectedTargets: blocks.length, inventory: this.snapshot().inventorySummary }; } finally { cleanup(); this.#applyMovementPolicy(safeMovementPolicy()); }
  }
  async #withStorage(position, capability, operation) { const bot = this.#ready(capability); const { Vec3 } = await import('vec3'); const target = new Vec3(Number(position.x), Number(position.y), Number(position.z)); await this.smartMove({ x: target.x, y: target.y, z: target.z, range: 2 }); const block = bot.blockAt(target); if (!block || !isStorageBlock(block.name)) throw new NotFoundError('Storage block', `${target.x},${target.y},${target.z}`); const container = await bot.openContainer(block); try { return await operation(container); } finally { container.close(); } }
  async farm({ crop = 'wheat', count = 16, maxDistance = 32 } = {}, { signal } = {}) {
    const bot = this.#ready('farming'); const seedName = CROP_ITEMS[crop]; const age = CROP_AGE[crop]; if (!seedName || !bot.registry.blocksByName?.[crop]) throw new ValidationError(`Unsupported crop '${crop}'`); const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1)); let harvested = 0; let planted = 0;
    const mature = bot.findBlocks({ matching: block => block.name === crop && Number(block.getProperties?.().age ?? -1) >= age, maxDistance, count: amount }).map(position => bot.blockAt(position)).filter(Boolean);
    if (mature.length) { const cleanup = this.#abort(signal, () => void bot.collectBlock.cancelTask()); try { await bot.collectBlock.collect(mature); harvested = mature.length; } finally { cleanup(); } }
    const farmland = bot.findBlocks({ matching: bot.registry.blocksByName.farmland.id, maxDistance, count: amount * 2 });
    for (const position of farmland) { if (planted >= amount || inventoryCount(bot, seedName) < 1) break; const block = bot.blockAt(position); const above = bot.blockAt(position.offset(0, 1, 0)); if (!block || !isAir(above)) continue; await bot.equip(bot.inventory.items().find(item => item.name === seedName), 'hand'); await bot.placeBlock(block, new (await import('vec3')).Vec3(0, 1, 0)); planted++; }
    if (planted < amount && inventoryCount(bot, seedName) > 0) {
      const hoe = bestItem(bot, item => item.name.endsWith('_hoe')); if (!hoe) throw new ValidationError('Farming requires a hoe to prepare new soil'); const dirt = bot.findBlocks({ matching: block => ['dirt', 'grass_block'].includes(block.name) && isAir(bot.blockAt(block.position.offset(0, 1, 0))), maxDistance, count: amount - planted });
      const { Vec3 } = await import('vec3'); await bot.equip(hoe, 'hand');
      for (const position of dirt) { if (planted >= amount || inventoryCount(bot, seedName) < 1) break; await this.navigate({ x: position.x, y: position.y, z: position.z, range: 3 }, { signal }); const soil = bot.blockAt(position); await bot.activateBlock(soil, new Vec3(0, 1, 0)); await delay(150); const prepared = bot.blockAt(position); if (prepared?.name !== 'farmland') continue; await bot.equip(bot.inventory.items().find(item => item.name === seedName), 'hand'); await bot.placeBlock(prepared, new Vec3(0, 1, 0)); planted++; await bot.equip(hoe, 'hand'); }
    }
    return { crop, requested: amount, harvested, planted, inventory: this.snapshot().inventorySummary };
  }
  async farmRequirements({ crop = 'wheat', count = 16, maxDistance = 32 } = {}) {
    const bot = this.#ready('farm-planning'); const seed = CROP_ITEMS[crop]; const age = CROP_AGE[crop]; if (!seed) throw new ValidationError(`Unsupported crop '${crop}'`); const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1)); const mature = bot.findBlocks({ matching: block => block.name === crop && Number(block.getProperties?.().age ?? -1) >= age, maxDistance, count: amount }).length; const emptyFarmland = bot.findBlocks({ matching: block => block.name === 'farmland' && isAir(bot.blockAt(block.position.offset(0, 1, 0))), maxDistance, count: amount }).length;
    return { crop, seed, count: amount, mature, emptyFarmland, needsHoe: mature + emptyFarmland < amount, needsSeed: inventoryCount(bot, seed) < 1 && mature === 0 };
  }
  async deforest({ log = 'any', count = 1, maxDistance = 64, replant = true } = {}, { signal } = {}) {
    const bot = this.#ready('deforestation'); const amount = Math.max(1, Math.min(32, Number.parseInt(count, 10) || 1)); const matching = block => isLog(block?.name) && (log === 'any' || block.name === log); const seeds = bot.findBlocks({ matching, maxDistance, count: amount * 8 }); const visited = new Set(); const sites = []; let logs = 0; let replanted = 0;
    for (const position of seeds) { if (sites.length >= amount || visited.has(positionKey(position))) continue; const tree = connectedTreeLogs(bot, position, visited, log).sort((left, right) => right.position.y - left.position.y); if (!tree.length) continue; const base = tree.reduce((lowest, block) => block.position.y < lowest.y ? block.position : lowest, tree[0].position); const cleanup = this.#abort(signal, () => void bot.collectBlock.cancelTask()); try { await bot.collectBlock.collect(tree); logs += tree.length; } finally { cleanup(); } const site = { x: base.x, y: base.y, z: base.z, log: tree.at(-1)?.name ?? log }; sites.push(site);
      if (replant && await this.#plantTreeSite(site)) replanted++;
    }
    if (!sites.length) throw new ValidationError(`No '${log}' tree found within ${maxDistance} blocks`); return { trees: sites.length, logs, replanted, sites, inventory: this.snapshot().inventorySummary };
  }
  async reforest({ sites = [], count = 8, maxDistance = 48 } = {}) {
    const bot = this.#ready('reforestation'); const targets = sites.length ? sites : bot.findBlocks({ matching: block => ['dirt', 'grass_block', 'podzol'].includes(block.name) && isAir(bot.blockAt(block.position.offset(0, 1, 0))), maxDistance, count: Math.max(1, Math.min(64, Number(count))) }).map(position => ({ x: position.x, y: position.y + 1, z: position.z })); let planted = 0;
    for (const site of targets) { if (planted >= count) break; if (await this.#plantTreeSite(site)) planted++; } return { requested: count, planted };
  }
  async #plantTreeSite(site) {
    const bot = this.#ready('tree-planting'); const preferred = saplingForLog(site.log); const sapling = bot.inventory.items().find(item => item.name === preferred) ?? bot.inventory.items().find(item => item.name.endsWith('_sapling') || item.name.endsWith('_propagule')); if (!sapling) return false; const { Vec3 } = await import('vec3'); const plantPosition = new Vec3(Math.floor(site.x), Math.floor(site.y), Math.floor(site.z)); const target = bot.blockAt(plantPosition); const ground = bot.blockAt(plantPosition.offset(0, -1, 0)); if (!isAir(target) || !ground || !['dirt', 'grass_block', 'podzol', 'mud'].includes(ground.name)) return false; await bot.equip(sapling, 'hand'); await bot.placeBlock(ground, new Vec3(0, 1, 0)); return true;
  }
  async startCombat({ mode = 'guard', position, radius = 16 } = {}) {
    const bot = this.#ready('combat'); if (!bot.pathfinder || !this.pathfinderModule) throw new ValidationError('Pathfinder plugin is unavailable'); const normalized = String(mode).toLowerCase(); if (!['guard', 'full_combat', 'meat'].includes(normalized)) throw new ValidationError(`Unsupported combat mode '${mode}'`); await this.stopCombat(); const anchor = position ?? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }; this.combatAbort = new AbortController(); this.combatState = { mode: normalized.toUpperCase(), status: 'ACTIVE', anchor, radius: Math.max(4, Math.min(64, Number(radius) || 16)), startedAt: new Date().toISOString() }; void this.#combatLoop(this.combatAbort.signal).catch(error => { if (!this.combatAbort?.signal.aborted) this.emit('combatError', error); this.combatState = { ...this.combatState, status: 'FAILED', error: error.message }; }); return { ...this.combatState };
  }
  async #combatLoop(signal) {
    const bot = this.#ready('combat'); while (!signal.aborted) { if (bot.health < 6) { this.combatState.status = 'RETREATING'; bot.pathfinder?.setGoal(null); return; } const anchor = this.combatState.anchor; const allowed = this.combatState.mode === 'MEAT' ? MEAT_MOBS : HOSTILE_MOBS; const target = bot.nearestEntity(entity => entity.type === 'mob' && allowed.has(entity.name) && entity.position && (this.combatState.mode !== 'GUARD' || distance3(entity.position, anchor) <= this.combatState.radius));
      if (!target) { if (this.combatState.mode === 'GUARD' && distance3(bot.entity.position, anchor) > 3) await this.navigate({ ...anchor, range: 2 }, { signal }).catch(() => {}); await delay(300); continue; }
      this.combatState.target = { id: target.id, name: target.name }; await equipBestWeapon(bot); const goals = this.pathfinderModule.goals ?? this.pathfinderModule.default?.goals; bot.pathfinder?.setGoal(new goals.GoalFollow(target, 2), true); if (distance3(bot.entity.position, target.position) <= 4) { await bot.lookAt(target.position.offset(0, target.height ?? 1, 0), true); bot.attack(target); } await delay(650);
    }
  }
  async stopCombat() { this.combatAbort?.abort(); this.combatAbort = null; if (this.combatState.mode !== 'OFF') this.combatState = { mode: 'OFF', status: 'IDLE', stoppedAt: new Date().toISOString() }; return { ...this.combatState }; }
  async craftItem({ item, count = 1 } = {}) {
    const bot = this.#ready('crafting'); const amount = Number.parseInt(count, 10); if (!Number.isInteger(amount) || amount < 1 || amount > 10_000) throw new ValidationError('Crafting count must be an integer between 1 and 10000');
    while (inventoryCount(bot, item) < amount) { const targetCount = Math.min(amount, inventoryCount(bot, item) + 64); await this.#ensureCrafted(item, targetCount, new Set(), 0); }
    return { item, count: inventoryCount(bot, item), inventory: this.snapshot().inventorySummary };
  }
  async #ensureCrafted(name, requiredCount, visiting, depth) {
    const bot = this.#ready('crafting'); if (inventoryCount(bot, name) >= requiredCount) return;
    if (depth > 8 || visiting.has(name)) throw new ValidationError(`Cannot resolve crafting dependencies for '${name}'`);
    const definition = bot.registry?.itemsByName?.[name]; if (!definition) throw new ValidationError(`Unknown item '${name}'`); visiting.add(name);
    let table = bot.findBlock({ matching: bot.registry.blocksByName?.crafting_table?.id, maxDistance: 6 });
    const recipes = rankRecipes(bot, name, requiredCount, inventoryLedger(bot), visiting, depth, bot.recipesAll(definition.id, null, true)); let lastError;
    for (const recipe of recipes) {
      try {
        if (recipe.requiresTable && !table) { await this.#ensureCrafted('crafting_table', 1, new Set(visiting), depth + 1); await this.#placeCraftingTable(); table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 }); if (!table) throw new ValidationError('Could not place crafting table'); }
        const craftCount = Math.ceil((requiredCount - inventoryCount(bot, name)) / recipe.result.count); const ingredients = recipe.delta.filter(value => value.count < 0).map(ingredient => ({ name: bot.registry.items[ingredient.id]?.name, count: Math.abs(ingredient.count) * craftCount })).filter(ingredient => ingredient.name);
        for (let pass = 0; pass <= ingredients.length; pass++) { const missing = ingredients.filter(ingredient => inventoryCount(bot, ingredient.name) < ingredient.count); if (!missing.length) break; for (const ingredient of missing) await this.#ensureCrafted(ingredient.name, ingredient.count, new Set(visiting), depth + 1); if (pass === ingredients.length && ingredients.some(ingredient => inventoryCount(bot, ingredient.name) < ingredient.count)) throw new ValidationError(`Ingredients for '${name}' could not be prepared together`); }
        await bot.craft(recipe, craftCount, table ?? undefined); if (inventoryCount(bot, name) < requiredCount) throw new ValidationError(`Crafting '${name}' produced fewer items than required`); visiting.delete(name); return;
      } catch (error) { lastError = error; }
    }
    visiting.delete(name); throw new ValidationError(`Unable to craft '${name}': ${lastError?.message ?? 'no recipe or ingredients'}`);
  }
  async #placeCraftingTable() {
    return this.#placeUtilityBlock('crafting_table');
  }
  async #placeUtilityBlock(name) {
    const bot = this.#ready(`place-${name}`); const item = bot.inventory.items().find(value => value.name === name); if (!item) throw new ValidationError(`'${name}' is not available`);
    const { Vec3 } = await import('vec3'); const origin = bot.entity.position.floored();
    const reference = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, z]) => bot.blockAt(origin.offset(x, -1, z))).find(block => block && ['air', 'cave_air', 'void_air'].includes(bot.blockAt(block.position.offset(0, 1, 0))?.name));
    if (!reference) throw new ValidationError(`No safe adjacent space for '${name}'`);
    await bot.equip(item, 'hand'); await bot.placeBlock(reference, new Vec3(0, 1, 0));
  }
  async dropItem({ item, count = 1 }) { const bot = this.#ready('item-transfer'); const definition = bot.registry.itemsByName?.[item]; if (!definition || inventoryCount(bot, item) < count) throw new ValidationError(`Not enough '${item}' to transfer`); await bot.toss(definition.id, null, count); return { item, count, dropped: true }; }
  async pickupItem({ item, count = 1, timeout = 10_000 }, { signal } = {}) {
    const bot = this.#ready('item-pickup'); const started = Date.now(); const initialCount = inventoryCount(bot, item); const expected = initialCount + Math.max(1, Number.parseInt(count, 10) || 1);
    while (Date.now() - started < timeout) {
      if (signal?.aborted) throw signal.reason ?? new ValidationError('Item pickup cancelled');
      if (inventoryCount(bot, item) >= expected) return { item, count: inventoryCount(bot, item) - initialCount, collected: true };
      const entity = bot.nearestEntity(candidate => isDroppedItemEntity(candidate) && candidate.getDroppedItem?.()?.name === item);
      if (entity?.position) await this.navigate({ x: entity.position.x, y: entity.position.y, z: entity.position.z, range: 1 }, { signal });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const collected = inventoryCount(bot, item) - initialCount; throw new ValidationError(`Dropped item '${item}' pickup timed out: collected ${collected} of ${expected - initialCount}`, { item, expected: expected - initialCount, collected, timeoutMs: timeout });
  }
  findDroppedItems({ position, radius, names }) { const bot = this.#ready('death-recovery-search'); const target = validRecoveryPosition(position); const maximumDistance = boundedDistance(radius, 1, 64, 'Recovery search radius'); const acceptedNames = new Set(validateRecoveryNames(names)); return Object.values(bot.entities ?? {}).filter(entity => isDroppedItemEntity(entity) && entity.position && distance3(entity.position, target) <= maximumDistance).map(entity => { const dropped = entity.getDroppedItem(); return { entityId: String(entity.id), item: String(dropped.name), count: Number(dropped.count ?? 1), position: validRecoveryPosition(entity.position), distance: distance3(entity.position, target) }; }).filter(entity => !acceptedNames.size || acceptedNames.has(entity.item)).sort((left, right) => left.distance - right.distance || left.entityId.localeCompare(right.entityId)); }
  async collectDroppedItem({ entityId, item, count, timeoutMs, position, radius }, { signal } = {}) { const bot = this.#ready('death-recovery-collection'); const requested = Math.max(1, Number.parseInt(count, 10) || 1); const timeout = boundedTimeout(timeoutMs, 250, 60_000, 'Recovery pickup timeout'); const target = validRecoveryPosition(position); const maximumDistance = boundedDistance(radius, 1, 64, 'Recovery search radius'); const before = inventoryCount(bot, item); const started = Date.now(); while (Date.now() - started < timeout) { if (signal?.aborted) throw signal.reason ?? new ValidationError('Recovery pickup cancelled'); const delta = inventoryCount(bot, item) - before; if (delta >= requested) return { item, requested, collected: delta, verified: true }; const candidates = this.findDroppedItems({ position: target, radius: maximumDistance, names: [item] }); const entity = candidates.find(candidate => candidate.entityId === String(entityId)) ?? candidates[0]; if (!entity) { await delay(100); continue; } await this.navigate({ ...entity.position, range: 1 }, { signal }); await delay(100); } const collected = inventoryCount(bot, item) - before; throw new ValidationError(`Recovery pickup timed out for '${item}': collected ${collected} of ${requested}`, { item, requested, collected, timeoutMs: timeout, position: target }); }
  recoveryContext({ position }) { const bot = this.#ready('death-recovery-context'); const target = validRecoveryPosition(position); const chunkActive = Boolean(bot.world?.getColumnAt?.(target) ?? bot.blockAt?.(target)); const hostile = Object.values(bot.entities ?? {}).filter(entity => entity.type === 'mob' && HOSTILE_MOBS.has(entity.name) && entity.position && distance3(entity.position, target) <= 24).length; const danger = Math.min(1, hostile / 8); const occupiedSlots = bot.inventory?.items?.().length ?? 0; return { chunkActive, danger, freeSlots: Math.max(0, 36 - occupiedSlots), keepInventory: keepInventoryState(bot), serverAgeTicks: Number(bot.time?.age ?? 0), position: target }; }
  async equipItem(input) {
    const bot = this.#ready('equip-item'); const itemName = validItemName(input?.item, 'Equip item'); const destination = validEquipmentDestination(input?.destination); const item = bot.inventory?.items?.().find(entry => entry.name === itemName);
    if (!item) throw survivalError('ITEM_REQUIRED', `Item '${itemName}' is required before equipping`, 'minecraft.equip', { item: itemName, destination });
    const before = equipmentView(bot, destination); await bot.equip(item, destination); const after = equipmentView(bot, destination);
    if (after?.name !== itemName) throw survivalError('CAPABILITY_UNAVAILABLE', `Equip verification failed for '${itemName}' in '${destination}'`, 'minecraft.equip', { before, after, destination });
    return { item: itemName, destination, before, after, verified: true };
  }
  async unequipItem(input) {
    const bot = this.#ready('unequip-item'); const destination = validEquipmentDestination(input?.destination); const before = equipmentView(bot, destination); if (!before) return { destination, before: null, after: null, verified: true };
    await bot.unequip(destination); const after = equipmentView(bot, destination); if (after) throw survivalError('CAPABILITY_UNAVAILABLE', `Unequip verification failed for '${destination}'`, 'minecraft.unequip', { before, after, destination });
    return { destination, before, after: null, verified: true };
  }
  async useItem(input, { signal } = {}) {
    const bot = this.#ready('use-item'); const item = validItemName(input?.item, 'Use item'); if (signal?.aborted) throw signal.reason ?? survivalError('INTERACTION_TIMEOUT', 'Item use was cancelled', 'minecraft.use-item', { item });
    if (typeof bot.activateItem !== 'function') throw survivalError('CAPABILITY_UNAVAILABLE', 'Mineflayer item activation is unavailable', 'minecraft.use-item', { item }); await this.equipItem({ item, destination: 'hand' }); const before = inventoryCount(bot, item); bot.activateItem(); await delay(100); bot.deactivateItem?.(); const held = equipmentView(bot, 'hand');
    if (held?.name !== item) throw survivalError('CAPABILITY_UNAVAILABLE', `Item '${item}' was not held during use`, 'minecraft.use-item', { item, held });
    return { item, beforeCount: before, afterCount: inventoryCount(bot, item), activated: true, verified: true };
  }
  findNearestEntity(input) {
    const bot = this.#ready('entity-search'); const maxDistance = boundedDistance(input?.maxDistance, 1, 128, 'Entity search distance'); const expectedType = optionalSafeName(input?.type, 'Entity type'); const expectedName = optionalSafeName(input?.name, 'Entity name'); if (!expectedType && !expectedName) throw new ValidationError('Entity search requires type or name');
    const entity = findSurvivalEntity(bot, { expectedType, expectedName, maxDistance, excludeIds: new Set(), predicate: () => true }); if (!entity) throw survivalError('ENTITY_NOT_FOUND', `Entity '${expectedName ?? expectedType}' was not found within ${maxDistance} blocks`, 'minecraft.entity-search', { expectedType, expectedName, maxDistance });
    return entityView(entity, bot.entity.position);
  }
  async lookAtEntity(input) { const bot = this.#ready('look-at-entity'); const entity = requiredEntity(bot, input?.entityId, input?.entityType, 'minecraft.interact-entity'); await bot.lookAt(entity.position.offset ? entity.position.offset(0, Number(entity.height ?? 1) / 2, 0) : entity.position, true); return { entity: entityView(entity, bot.entity.position), verified: true }; }
  async activateEntity(input) { const bot = this.#ready('activate-entity'); if (typeof bot.activateEntity !== 'function') throw survivalError('CAPABILITY_UNAVAILABLE', 'Mineflayer entity activation is unavailable', 'minecraft.interact-entity', { entityId: String(input?.entityId ?? '') }); const entity = requiredEntity(bot, input?.entityId, input?.entityType, 'minecraft.interact-entity'); await bot.activateEntity(entity); return { entity: entityView(entity, bot.entity.position), activated: true, verified: true }; }
  async interactEntity(input, context = {}) {
    const action = String(input?.action ?? 'USE').toUpperCase(); if (action === 'SHEAR') return this.shearSheep({ entityId: input.entityId }, context); if (action === 'MILK') return this.milkCow({ entityId: input.entityId }, context); if (action === 'INSPECT') { const bot = this.#ready('inspect-entity'); return { action, entity: entityView(requiredEntity(bot, input.entityId, input.expectedType, 'minecraft.interact-entity'), bot.entity.position), verified: true }; }
    if (action !== 'USE') throw new ValidationError(`Unsupported entity interaction action '${action}'`); if (input.item) await this.equipItem({ item: input.item, destination: 'hand' }); const result = await this.activateEntity({ entityId: input.entityId, entityType: input.expectedType }); return { action, ...result };
  }
  async activateBlock(input) { return this.interactBlock({ ...input, action: 'ACTIVATE' }); }
  async interactBlock(input) {
    const bot = this.#ready('interact-block'); const position = validRecoveryPosition(input?.position); const action = String(input?.action ?? 'INSPECT').toUpperCase(); const block = bot.blockAt(await blockVector(position)); if (!block) throw survivalError('BLOCK_NOT_FOUND', `Block was not found at ${formatPosition(position)}`, 'minecraft.interact-block', { position });
    const expected = input.expectedBlock ?? input.block; if (expected && block.name !== expected) throw survivalError('BLOCK_STATE_MISMATCH', `Expected '${expected}' at ${formatPosition(position)}, found '${block.name}'`, 'minecraft.interact-block', { position, expected, actual: block.name });
    const before = blockState(block); if (action === 'INSPECT') return { block: block.name, position, action, before, after: before, verified: true };
    const desiredOpen = action === 'OPEN' ? true : action === 'CLOSE' ? false : null; if (desiredOpen !== null && before.open === desiredOpen) return { block: block.name, position, action, before, after: before, changed: false, verified: true };
    if (!['ACTIVATE', 'USE', 'TOGGLE', 'OPEN', 'CLOSE'].includes(action)) throw new ValidationError(`Unsupported block interaction action '${action}'`); if (typeof bot.activateBlock !== 'function') throw survivalError('CAPABILITY_UNAVAILABLE', 'Mineflayer block activation is unavailable', 'minecraft.interact-block', { position, block: block.name }); enforceInteractionCooldown(this.interactionCooldowns, block, input.cooldownMs ?? 500); await bot.activateBlock(block); await delay(100); const afterBlock = bot.blockAt(await blockVector(position)); const after = blockState(afterBlock);
    const verified = desiredOpen === null ? Boolean(afterBlock) : after.open === desiredOpen; if (!verified) throw survivalError('BLOCK_STATE_MISMATCH', `Block '${block.name}' did not reach requested state '${action}'`, 'minecraft.interact-block', { position, before, after, action });
    return { block: block.name, position, action, before, after, changed: true, verified };
  }
  inspectArmor() { const bot = this.#ready('armor-inspect'); return armorInspection(bot); }
  async equipArmor(input) { const bot = this.#ready('armor-equip'); const itemName = validItemName(input?.item, 'Armor item'); const destination = armorDestination(itemName); if (!destination) throw new ValidationError(`Item '${itemName}' is not wearable armor`); const policy = armorPolicyInput(input); const candidate = bot.inventory.items().find(item => item.name === itemName); if (!candidate) throw survivalError('ITEM_REQUIRED', `Armor '${itemName}' is required before equipping`, 'minecraft.armor.equip', { item: itemName, destination }); const current = equipmentItem(bot, destination); const currentScore = armorScore(bot, current, policy); const candidateScore = armorScore(bot, candidate, policy); if (current && hasBindingCurse(current)) throw survivalError('ARMOR_DOWNGRADE_REJECTED', `Equipped armor '${current.name}' has Curse of Binding`, 'minecraft.armor.equip', { item: itemName, destination, current: current.name }); if (policy.preserveDurability && durabilityPercent(bot, candidate) < policy.minimumDurability) throw survivalError('ARMOR_DOWNGRADE_REJECTED', `Armor '${itemName}' is below the minimum durability policy`, 'minecraft.armor.equip', { item: itemName, durabilityPercent: durabilityPercent(bot, candidate), minimumDurability: policy.minimumDurability }); if (!policy.allowBindingCurse && hasBindingCurse(candidate)) throw survivalError('ARMOR_DOWNGRADE_REJECTED', `Armor '${itemName}' has Curse of Binding`, 'minecraft.armor.equip', { item: itemName }); if (current && candidateScore <= currentScore) throw survivalError('ARMOR_DOWNGRADE_REJECTED', `Armor '${itemName}' would downgrade slot '${destination}'`, 'minecraft.armor.equip', { item: itemName, destination, current: current.name, currentScore, candidateScore }); const result = await this.equipItem({ item: itemName, destination }); return { ...result, slot: destination, upgraded: candidateScore > currentScore, previousScore: currentScore, score: candidateScore }; }
  async autoEquipArmor(input) {
    const bot = this.#ready('armor-auto-equip'); const policy = armorPolicyInput(input); const before = armorInspection(bot); const equipped = [];
    for (const destination of ['head', 'torso', 'legs', 'feet']) {
      const current = equipmentItem(bot, destination); if (current && hasBindingCurse(current)) continue; const candidates = bot.inventory.items().filter(item => armorDestination(item.name) === destination && (!policy.preserveDurability || durabilityPercent(bot, item) >= policy.minimumDurability) && (policy.allowBindingCurse || !hasBindingCurse(item))).sort((left, right) => compareArmor(bot, right, left, policy)); const candidate = candidates[0]; if (!candidate) continue;
      const currentScore = armorScore(bot, current, policy); const candidateScore = armorScore(bot, candidate, policy); if (current && candidateScore <= currentScore) continue; const result = await this.equipItem({ item: candidate.name, destination }); equipped.push({ ...result, previousScore: currentScore, score: candidateScore });
    }
    const after = armorInspection(bot); return { before, after, equipped, changed: equipped.length > 0, verified: equipped.every(entry => entry.after?.name === entry.item) };
  }
  findSheep(input) { const bot = this.#ready('sheep-search'); const maxDistance = boundedDistance(input?.maxDistance, 1, 128, 'Sheep search distance'); const color = normalizeWoolColor(input?.color ?? null); const entity = findSurvivalEntity(bot, { expectedType: 'mob', expectedName: 'sheep', maxDistance, excludeIds: new Set(), predicate: candidate => !sheepSheared(candidate) && (!color || sheepColor(candidate) === color) }); if (!entity) throw survivalError('ENTITY_NOT_FOUND', `Sheep${color ? ` with color '${color}'` : ''} was not found within ${maxDistance} blocks`, 'minecraft.sheep-search', { color, maxDistance }); return { ...entityView(entity, bot.entity.position), color: sheepColor(entity), sheared: sheepSheared(entity) }; }
  async shearSheep(input, { signal } = {}) {
    const bot = this.#ready('shear-sheep'); if (inventoryCount(bot, 'shears') < 1) throw survivalError('ITEM_REQUIRED', 'Shears are required to shear a sheep', 'minecraft.shear', { item: 'shears' }); const entity = requiredEntity(bot, input?.entityId, 'sheep', 'minecraft.shear'); if (sheepSheared(entity)) throw survivalError('CAPABILITY_UNAVAILABLE', `Sheep '${entity.id}' is already sheared`, 'minecraft.shear', { entityId: String(entity.id) });
    const color = sheepColor(entity) ?? 'white'; const item = `${color}_wool`; const before = inventoryCount(bot, item); await this.navigate({ x: entity.position.x, y: entity.position.y, z: entity.position.z, range: 2 }, { signal }); await this.equipItem({ item: 'shears', destination: 'hand' }); await bot.activateEntity(entity); await delay(150); await collectNearbyWool(this, bot, entity.position, item, signal); const after = inventoryCount(bot, item); if (after <= before) throw survivalError('INTERACTION_TIMEOUT', `Shearing sheep '${entity.id}' produced no verified '${item}'`, 'minecraft.shear', { entityId: String(entity.id), item, before, after }); return { entityId: String(entity.id), item, count: after - before, before, after, verified: true };
  }
  async acquireWool(input, { signal } = {}) {
    const bot = this.#ready('acquire-wool'); const color = normalizeWoolColor(input?.color ?? 'white'); const requested = positiveAmount(input?.count, 1, 64, 'Wool count'); const maxDistance = boundedDistance(input?.maxDistance, 1, 128, 'Wool search distance'); const reserve = nonNegativeAmount(input?.minimumSheepReserve, 0, 100, 'Minimum sheep reserve'); if (input?.allowAnimalKill === true) throw new ValidationError('Animal killing fallback is not implemented in survival Phase 1'); const item = `${color}_wool`; const before = inventoryCount(bot, item); const used = new Set();
    while (inventoryCount(bot, item) - before < requested) { if (signal?.aborted) throw signal.reason ?? survivalError('INTERACTION_TIMEOUT', 'Wool acquisition was cancelled', 'minecraft.acquire-wool', { item, requested }); const sheep = findSurvivalEntity(bot, { expectedType: 'mob', expectedName: 'sheep', maxDistance, excludeIds: used, predicate: candidate => !sheepSheared(candidate) && sheepColor(candidate) === color }); if (!sheep) throw survivalError('ENTITY_NOT_FOUND', `Not enough unsheared '${color}' sheep to acquire ${requested} wool`, 'minecraft.acquire-wool', { item, requested, acquired: inventoryCount(bot, item) - before, minimumSheepReserve: reserve }); used.add(String(sheep.id)); await this.shearSheep({ entityId: sheep.id }, { signal }); }
    return { item, requested, acquired: inventoryCount(bot, item) - before, sheepUsed: used.size, minimumSheepReserve: reserve, animalKilled: false, verified: true };
  }
  findCow(input) { const bot = this.#ready('cow-search'); const maxDistance = boundedDistance(input?.maxDistance, 1, 128, 'Cow search distance'); const entity = findSurvivalEntity(bot, { expectedType: 'mob', expectedName: 'cow', maxDistance, excludeIds: new Set(), predicate: candidate => !isBabyEntity(candidate) }); if (!entity) throw survivalError('ENTITY_NOT_FOUND', `Cow was not found within ${maxDistance} blocks`, 'minecraft.cow-search', { maxDistance }); return entityView(entity, bot.entity.position); }
  async milkCow(input, { signal } = {}) { const bot = this.#ready('milk-cow'); const availableBuckets = inventoryCount(bot, 'bucket'); if (availableBuckets < 1) throw survivalError('ITEM_REQUIRED', 'A bucket is required to milk a cow', 'minecraft.milk', { item: 'bucket' }); if (availableBuckets > 1 && bot.inventory?.emptySlotCount?.() === 0) throw survivalError('INVENTORY_FULL', 'An empty inventory slot is required to store the milk bucket', 'minecraft.milk', { item: 'milk_bucket', availableBuckets }); const entity = requiredEntity(bot, input?.entityId, 'cow', 'minecraft.milk'); const beforeBucket = availableBuckets; const beforeMilk = inventoryCount(bot, 'milk_bucket'); await this.navigate({ x: entity.position.x, y: entity.position.y, z: entity.position.z, range: 2 }, { signal }); const currentEntity = requiredEntity(bot, input?.entityId, 'cow', 'minecraft.milk'); await this.equipItem({ item: 'bucket', destination: 'hand' }); await bot.activateEntity(currentEntity); await delay(100); const afterBucket = inventoryCount(bot, 'bucket'); const afterMilk = inventoryCount(bot, 'milk_bucket'); if (beforeBucket - afterBucket !== 1 || afterMilk - beforeMilk !== 1) throw survivalError('INTERACTION_TIMEOUT', `Milking cow '${currentEntity.id}' failed inventory verification`, 'minecraft.milk', { entityId: String(currentEntity.id), beforeBucket, afterBucket, beforeMilk, afterMilk }); return { entityId: String(currentEntity.id), bucketDelta: afterBucket - beforeBucket, milkBucketDelta: afterMilk - beforeMilk, verified: true }; }
  async acquireMilk(input, { signal } = {}) { const bot = this.#ready('acquire-milk'); const requested = positiveAmount(input?.count, 1, 64, 'Milk count'); const maxDistance = boundedDistance(input?.maxDistance, 1, 128, 'Cow search distance'); const before = inventoryCount(bot, 'milk_bucket'); for (let index = 0; index < requested; index++) { if (signal?.aborted) throw signal.reason ?? survivalError('INTERACTION_TIMEOUT', 'Milk acquisition was cancelled', 'minecraft.acquire-milk', { requested }); const cow = this.findCow({ maxDistance }); await this.milkCow({ entityId: cow.entityId }, { signal }); } const acquired = inventoryCount(bot, 'milk_bucket') - before; if (acquired !== requested) throw survivalError('INTERACTION_TIMEOUT', `Milk acquisition verified ${acquired}, expected ${requested}`, 'minecraft.acquire-milk', { acquired, requested }); return { item: 'milk_bucket', requested, acquired, verified: true }; }
  findBed(input) { const bot = this.#ready('bed-search'); const maxDistance = boundedDistance(input?.maxDistance, 1, 128, 'Bed search distance'); const positions = bot.findBlocks?.({ matching: block => block?.name?.endsWith('_bed'), maxDistance, count: 64 }) ?? []; const beds = positions.map(position => bot.blockAt(position)).filter(block => block?.name?.endsWith('_bed')).map(block => ({ block, occupied: Boolean(blockState(block).occupied), distance: distance3(bot.entity.position, block.position) })).sort((left, right) => left.occupied - right.occupied || left.distance - right.distance); const selected = beds.find(entry => !entry.occupied); if (!selected) throw survivalError(beds.length ? 'BED_OCCUPIED' : 'BLOCK_NOT_FOUND', beds.length ? 'All nearby beds are occupied' : `Bed was not found within ${maxDistance} blocks`, 'minecraft.bed-search', { maxDistance, beds: beds.length }); return { block: selected.block.name, position: validRecoveryPosition(selected.block.position), occupied: false, distance: selected.distance, verified: true }; }
  async sleep(input, { signal } = {}) {
    const bot = this.#ready('sleep'); let bedPosition = null; let wakePromise = Promise.resolve();
    const wakeOnAbort = () => { if (bot.isSleeping) wakePromise = bot.wake(); };
    signal?.addEventListener('abort', wakeOnAbort, { once: true });
    try {
      if (signal?.aborted) throw signal.reason ?? survivalError('INTERACTION_TIMEOUT', 'Sleep was cancelled', 'minecraft.sleep', {});
      if (['the_nether', 'the_end', 'nether', 'end'].includes(String(bot.game?.dimension).toLowerCase())) throw survivalError('SLEEP_UNAVAILABLE', `Sleep is unavailable in dimension '${bot.game?.dimension}'`, 'minecraft.sleep', { dimension: bot.game?.dimension });
      if (!sleepTime(bot)) throw survivalError('SLEEP_UNAVAILABLE', 'Sleep is unavailable at the current time', 'minecraft.sleep', { timeOfDay: bot.time?.timeOfDay });
      const bed = input?.position ? { position: validRecoveryPosition(input.position) } : this.findBed({ maxDistance: input?.maxDistance ?? 32 }); bedPosition = bed.position;
      this.currentSleepState = { state: 'MOVING_TO_BED', bed: bedPosition, error: null }; await this.navigate({ ...bedPosition, range: 2 }, { signal });
      if (signal?.aborted) throw signal.reason ?? survivalError('INTERACTION_TIMEOUT', 'Sleep was cancelled', 'minecraft.sleep', { position: bedPosition });
      const block = bot.blockAt(await blockVector(bedPosition)); if (!block?.name?.endsWith('_bed')) throw survivalError('BLOCK_NOT_FOUND', `Bed disappeared at ${formatPosition(bedPosition)}`, 'minecraft.sleep', { position: bedPosition }); if (blockState(block).occupied) throw survivalError('BED_OCCUPIED', `Bed at ${formatPosition(bedPosition)} is occupied`, 'minecraft.sleep', { position: bedPosition });
      this.currentSleepState = { state: 'READY', bed: bedPosition, error: null }; await bot.sleep(block);
      if (signal?.aborted) { await wakePromise; if (bot.isSleeping) await bot.wake(); throw signal.reason ?? survivalError('INTERACTION_TIMEOUT', 'Sleep was cancelled', 'minecraft.sleep', { position: bedPosition }); }
      if (!bot.isSleeping) throw survivalError('SLEEP_UNAVAILABLE', 'Minecraft rejected the sleep request', 'minecraft.sleep', { position: bedPosition });
      this.currentSleepState = { state: 'SLEEPING', bed: bedPosition, error: null }; return { ...this.currentSleepState, verified: true };
    } catch (error) {
      try { await wakePromise; if (bot.isSleeping) await bot.wake(); }
      catch (wakeError) { const failure = survivalError('SLEEP_UNAVAILABLE', `Sleep failed and the bot could not wake: ${wakeError.message}`, 'minecraft.sleep', { position: bedPosition, originalError: error.message }); this.currentSleepState = { state: 'FAILED', bed: bedPosition, error: { code: failure.code, message: failure.message } }; throw failure; }
      this.currentSleepState = { state: 'FAILED', bed: bedPosition, error: { code: error.code ?? 'SLEEP_UNAVAILABLE', message: error.message } }; throw error;
    } finally { signal?.removeEventListener('abort', wakeOnAbort); }
  }
  async wake() { const bot = this.#ready('wake'); if (bot.isSleeping) await bot.wake(); if (bot.isSleeping) throw survivalError('SLEEP_UNAVAILABLE', 'Bot remained asleep after wake request', 'minecraft.wake', { bed: this.currentSleepState.bed }); this.currentSleepState = { state: 'AWAKE', bed: this.currentSleepState.bed, error: null }; return { ...this.currentSleepState, verified: true }; }
  sleepStatus() { const bot = this.#ready('sleep-status'); return { ...this.currentSleepState, sleeping: Boolean(bot.isSleeping) }; }
  async openDoor(input) { return setOpenableState(this, input, true, 'door'); }
  async closeDoor(input) { return setOpenableState(this, input, false, 'door'); }
  async openTrapdoor(input) { return setOpenableState(this, input, true, 'trapdoor'); }
  async closeTrapdoor(input) { return setOpenableState(this, input, false, 'trapdoor'); }
  async stopActions() { const bot = this.client; if (!bot) return; await this.stopCombat(); bot.pathfinder?.setGoal(null); await bot.collectBlock?.cancelTask?.(); bot.autoEat?.cancelEat?.(); bot.clearControlStates?.(); }

  async startViewer({ port = 3100, firstPerson = true, viewDistance = 6, mode = 'first_person' } = {}) {
    const bot = this.#ready('camera'); if (bot.viewer) return { port: this.viewerPort, active: true, mode: this.viewerMode };
    await validateCanvas();
    const module = await import('prismarine-viewer'); const viewer = module.mineflayer ?? module.default?.mineflayer;
    if (typeof viewer !== 'function') throw new ValidationError('Prismarine viewer is unavailable');
    const supportedVersions = module.supportedVersions ?? module.default?.supportedVersions ?? []; const renderVersion = compatibleViewerVersion(bot.version, supportedVersions);
    const viewerBot = renderVersion === bot.version ? bot : new Proxy(bot, { get: (target, property, receiver) => property === 'version' ? renderVersion : Reflect.get(target, property, receiver) });
    viewer(viewerBot, { port, firstPerson, viewDistance }); this.viewerPort = port; this.viewerMode = mode; this.viewerRenderVersion = renderVersion;
    try { await waitForViewer(port); } catch (error) { await this.stopViewer(); throw error; }
    this.viewerVersionSupported = supportedVersions.includes(bot.version); return { port, active: true, mode, version: bot.version, renderVersion, versionSupported: this.viewerVersionSupported };
  }

  async stopViewer() { if (this.client?.viewer) { this.client.viewer.close(); delete this.client.viewer; } this.viewerPort = null; this.viewerMode = null; this.viewerVersionSupported = null; this.viewerRenderVersion = null; return { active: false }; }

  snapshot() {
    const bot = this.client;
    const inventory = (bot?.inventory?.items?.() ?? []).reduce((result, item) => {
      if (!item || !item.name) return result;
      const name = String(item.name).toLowerCase();
      const existing = result.get(name);
      result.set(name, { name, count: (existing?.count ?? 0) + Number(item.count) });
      return result;
    }, new Map());
    const slots = Array.isArray(bot?.inventory?.slots) ? bot.inventory.slots.slice(9, 45) : []; const inventorySlotsUsed = slots.filter(Boolean).length; const inventorySlotsFree = Math.max(0, 36 - inventorySlotsUsed); const freeItemCapacity = slots.reduce((total, item) => total + (item ? Math.max(0, Number(item.stackSize ?? 64) - Number(item.count ?? 0)) : 64), 0); const inventorySlots = slots.map(item => item ? { name: String(item.name).toLowerCase(), count: Number(item.count), stackSize: Number(item.stackSize ?? 64) } : null);
    return { connection: this.status, position: bot?.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null,
      health: bot?.health ?? null, food: bot?.food ?? null, alive: this.alive, dimension: bot?.game?.dimension ?? null,
      inventorySummary: [...inventory.values()], inventorySlots, inventorySlotsUsed, inventorySlotsFree, freeItemCapacity, plugins: { ...this.pluginStatus },
      camera: { active: Boolean(bot?.viewer), port: this.viewerPort ?? null, mode: this.viewerMode ?? null, version: bot?.version ?? null, renderVersion: this.viewerRenderVersion ?? null, versionSupported: this.viewerVersionSupported ?? null }, combat: { ...this.combatState }, timestamp: new Date().toISOString() };
  }

  async disconnect(reason = 'MineHive shutdown') { if (!this.client) return; this.alive = false; await this.stopViewer(); await this.stopActions(); this.client.quit?.(reason); }
  raw() { throw new ValidationError('Raw Mineflayer client access is forbidden outside adapter capabilities'); }
}

function inventoryCount(bot, name) { return bot.inventory?.items?.().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0) ?? 0; }
function toolTier(name) { return { wooden: 1, golden: 2, stone: 3, iron: 4, diamond: 5, netherite: 6 }[String(name).split('_', 1)[0]] ?? 0; }
function recoveryState(bot) { const position = bot.entity?.position; return { position: position ? { x: Number(position.x), y: Number(position.y), z: Number(position.z) } : null, dimension: String(bot.game?.dimension ?? 'overworld'), inventory: (bot.inventory?.items?.() ?? []).filter(item => Number(item.count) > 0).map(item => ({ name: String(item.name), count: Number(item.count), customName: recoveryCustomName(item), enchanted: recoveryEnchanted(item) })), health: Number(bot.health ?? 0), food: Number(bot.food ?? 0), capturedAt: new Date().toISOString() }; }
function recoveryCustomName(item) { const value = item.customName ?? item.nbt?.value?.display?.value?.Name?.value; return value ? String(value).slice(0, 160) : null; }
function recoveryEnchanted(item) { return Boolean(item.enchants?.length || item.nbt?.value?.Enchantments?.value?.value?.length || item.nbt?.value?.ench?.value?.value?.length); }
function keepInventoryState(bot) { const value = bot.game?.gameRules?.keepInventory ?? bot.game?.gamerules?.keepInventory; if (value === undefined || value === null) return 'UNKNOWN'; return value === true || String(value).toLowerCase() === 'true' ? 'ENABLED' : 'DISABLED'; }
function deathCause(bot) { const value = bot.lastDamageCause ?? bot.entity?.lastDamageCause ?? 'unknown'; return String(value).slice(0, 80); }
function validRecoveryPosition(position) { if (!position || ![position.x, position.y, position.z].every(value => Number.isFinite(Number(value)))) throw new ValidationError('Recovery context requires a finite position'); return { x: Number(position.x), y: Number(position.y), z: Number(position.z) }; }
function validateRecoveryNames(names) { if (names === undefined) return []; if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !/^[a-z0-9_.:-]{1,128}$/.test(name))) throw new ValidationError('Recovery item names must be an array of valid registry names'); return [...new Set(names)]; }
function isDroppedItemEntity(entity) { return (entity?.name === 'item' || entity?.name === 'item_stack') && typeof entity.getDroppedItem === 'function'; }
function survivalError(code, message, capability, context) { return new SurvivalCapabilityError(code, message, { capability, context }); }
function validItemName(value, label) { const name = String(value ?? '').trim().toLowerCase(); if (!/^[a-z0-9_.:-]{1,128}$/.test(name)) throw new ValidationError(`${label} requires a valid item registry name`); return name; }
function optionalSafeName(value, label) { if (value === undefined || value === null || value === '') return null; const name = String(value).trim().toLowerCase(); if (!/^[a-z0-9_.:-]{1,128}$/.test(name)) throw new ValidationError(`${label} must be a valid registry name`); return name; }
function validEquipmentDestination(value) { const destination = String(value ?? '').trim().toLowerCase(); if (!['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'].includes(destination)) throw new ValidationError(`Equipment destination must be one of: hand, off-hand, head, torso, legs, feet`); return destination; }
function equipmentItem(bot, destination) { const direct = bot.equipment?.[destination]; const slot = bot.getEquipmentDestSlot?.(destination); return direct ?? (Number.isInteger(slot) ? bot.inventory?.slots?.[slot] : null) ?? (destination === 'hand' ? bot.heldItem : null); }
function equipmentView(bot, destination) { const item = equipmentItem(bot, destination); return item ? { name: String(item.name), count: Number(item.count ?? 1), durabilityPercent: durabilityPercent(bot, item), enchanted: recoveryEnchanted(item), enchantmentProtection: enchantmentLevel(item, /protection/i), bindingCurse: hasBindingCurse(item) } : null; }
function findSurvivalEntity(bot, input) { return Object.values(bot.entities ?? {}).filter(entity => entity?.position && (!input.expectedType || entity.type === input.expectedType || entity.name === input.expectedType) && (!input.expectedName || entity.name === input.expectedName) && !input.excludeIds.has(String(entity.id)) && input.predicate(entity) && distance3(bot.entity.position, entity.position) <= input.maxDistance).sort((left, right) => distance3(bot.entity.position, left.position) - distance3(bot.entity.position, right.position) || String(left.id).localeCompare(String(right.id)))[0] ?? null; }
function entityView(entity, origin) { return { entityId: String(entity.id), type: String(entity.type ?? 'unknown'), name: String(entity.name ?? 'unknown'), position: validRecoveryPosition(entity.position), distance: distance3(origin, entity.position) }; }
function requiredEntity(bot, entityId, expectedType, capability) { const entity = bot.entities?.[entityId] ?? bot.entities?.[String(entityId)]; if (!entity) throw survivalError('ENTITY_NOT_FOUND', `Entity '${entityId}' was not found`, capability, { entityId: String(entityId), expectedType }); if (expectedType && entity.type !== expectedType && entity.name !== expectedType) throw survivalError('ENTITY_NOT_FOUND', `Entity '${entityId}' is '${entity.name ?? entity.type}', expected '${expectedType}'`, capability, { entityId: String(entityId), expectedType }); return entity; }
async function blockVector(position) { const { Vec3 } = await import('vec3'); return new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)); }
function blockState(block) { const properties = block?.getProperties?.() ?? block?.properties ?? {}; return { open: typeof properties.open === 'boolean' ? properties.open : null, occupied: typeof properties.occupied === 'boolean' ? properties.occupied : false, half: properties.half ?? null, facing: properties.facing ?? null }; }
function enforceInteractionCooldown(cooldowns, block, milliseconds) { const cooldown = boundedTimeout(Number(milliseconds), 100, 10_000, 'Interaction cooldown'); const key = `${block.name}:${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`; const previous = cooldowns.get(key) ?? 0; if (Date.now() - previous < cooldown) throw survivalError('INTERACTION_TIMEOUT', `Interaction cooldown is active for '${block.name}'`, 'minecraft.interact-block', { key, cooldownMs: cooldown }); cooldowns.set(key, Date.now()); }
function armorDestination(name) { if (/_(helmet|cap)$/.test(name) || name === 'turtle_helmet') return 'head'; if (/_(chestplate|tunic)$/.test(name) || name === 'elytra') return 'torso'; if (/_(leggings|pants)$/.test(name)) return 'legs'; if (/_(boots)$/.test(name)) return 'feet'; return null; }
function armorMaterialTier(name) { if (name === 'elytra') return 3; const material = String(name ?? '').split('_')[0]; return { leather: 1, golden: 2, gold: 2, chainmail: 3, iron: 4, turtle: 4, diamond: 5, netherite: 6 }[material] ?? 0; }
function armorBaseProtection(name) { const slot = armorDestination(name); const tier = armorMaterialTier(name); const slotWeight = { head: 2, torso: 4, legs: 3, feet: 1 }[slot] ?? 0; return tier * 10 + slotWeight; }
function durabilityPercent(bot, item) { if (!item) return 0; const maximum = Number(item.maxDurability ?? bot.registry?.itemsByName?.[item.name]?.maxDurability ?? 0); if (!maximum) return 100; return Math.max(0, Math.min(100, ((maximum - Number(item.durabilityUsed ?? 0)) / maximum) * 100)); }
function enchantmentLevel(item, pattern) { return (item.enchants ?? []).filter(enchantment => pattern.test(String(enchantment.name ?? enchantment.id ?? ''))).reduce((sum, enchantment) => sum + Number(enchantment.lvl ?? enchantment.level ?? 1), 0); }
function hasBindingCurse(item) { return enchantmentLevel(item ?? {}, /binding_curse|curse_of_binding/i) > 0 || JSON.stringify(item?.nbt ?? '').toLowerCase().includes('binding_curse'); }
function armorPolicyInput(input) { const source = input ?? {}; return { preserveDurability: source.preserveDurability !== false, minimumDurability: nonNegativeAmount(source.minimumDurability ?? 10, 0, 100, 'Armor minimum durability'), preferProtection: source.preferProtection !== false, preferDurability: source.preferDurability === true, allowBindingCurse: source.allowBindingCurse === true }; }
function armorScore(bot, item, policy = armorPolicyInput({})) { if (!item) return 0; const protection = armorBaseProtection(item.name) + enchantmentLevel(item, /protection/i) * 5; const durability = durabilityPercent(bot, item); return (policy.preferProtection ? protection * 10 : protection * 5) + (policy.preferDurability ? durability : durability / 10) + armorMaterialTier(item.name); }
function compareArmor(bot, left, right, policy) { return armorScore(bot, left, policy) - armorScore(bot, right, policy) || left.name.localeCompare(right.name); }
function armorInspection(bot) { const equipped = Object.fromEntries(['head', 'torso', 'legs', 'feet'].map(destination => [destination, equipmentView(bot, destination)])); const available = bot.inventory.items().filter(item => armorDestination(item.name)).map(item => ({ name: item.name, slot: armorDestination(item.name), score: armorScore(bot, item), durabilityPercent: durabilityPercent(bot, item), bindingCurse: hasBindingCurse(item) })).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)); return { equipped, available, verified: true }; }
const WOOL_COLORS = Object.freeze(['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']);
function normalizeWoolColor(value) { if (value === null) return null; const color = String(value).toLowerCase(); if (!WOOL_COLORS.includes(color)) throw new ValidationError(`Unsupported wool color '${color}'`); return color; }
function sheepMetadataByte(entity) { for (const index of [17, 16]) if (Number.isInteger(entity.metadata?.[index])) return entity.metadata[index]; return null; }
function sheepColor(entity) { if (typeof entity.color === 'string' && WOOL_COLORS.includes(entity.color)) return entity.color; const value = sheepMetadataByte(entity); return value === null ? 'white' : WOOL_COLORS[value & 15] ?? 'white'; }
function sheepSheared(entity) { if (typeof entity.sheared === 'boolean') return entity.sheared; const value = sheepMetadataByte(entity); return value === null ? false : Boolean(value & 16); }
function isBabyEntity(entity) { return entity.isBaby === true || entity.metadata?.some?.(value => value === -1) === true; }
async function collectNearbyWool(adapter, bot, position, item, signal) { for (const dropped of adapter.findDroppedItems({ position, radius: 6, names: [item] })) await adapter.collectDroppedItem({ entityId: dropped.entityId, item, count: dropped.count, timeoutMs: 3000, position, radius: 6 }, { signal }); }
function sleepTime(bot) { if (bot.time?.isNight === true) return true; const time = Number(bot.time?.timeOfDay); return Number.isFinite(time) && time >= 12_542 && time <= 23_458; }
async function setOpenableState(adapter, input, open, kind) { const expected = input?.block; if (expected && !isOpenableKind(String(expected), kind)) throw new ValidationError(`Expected block '${expected}' is not a ${kind}`); const client = adapter.client; if (!client || adapter.status !== 'READY') throw new ValidationError(`Cannot use '${kind}' interaction while bot is ${adapter.status}`); const position = validRecoveryPosition(input?.position); const block = client.blockAt(await blockVector(position)); if (!block || !isOpenableKind(block.name, kind)) throw survivalError('BLOCK_NOT_FOUND', `${kind} was not found at ${formatPosition(position)}`, `minecraft.${open ? 'open' : 'close'}-${kind}`, { position, actual: block?.name ?? null }); if (block.name === `iron_${kind}`) throw survivalError('CAPABILITY_UNAVAILABLE', `Iron ${kind}s require a redstone mechanism and cannot be directly activated`, `minecraft.${open ? 'open' : 'close'}-${kind}`, { position, block: block.name }); return adapter.interactBlock({ position, expectedBlock: block.name, action: open ? 'OPEN' : 'CLOSE', cooldownMs: input?.cooldownMs ?? 500 }); }
function isOpenableKind(name, kind) { return kind === 'door' ? name.endsWith('_door') && !name.endsWith('_trapdoor') : name.endsWith('_trapdoor'); }
function configureDoorNavigation(movements, registry) { movements.canOpenDoors = true; if (!(movements.openable instanceof Set)) return; for (const block of registry?.blocksArray ?? Object.values(registry?.blocksByName ?? {})) if (block?.name && isOpenableKind(block.name, 'door') && block.name !== 'iron_door' && Number.isInteger(block.id)) movements.openable.add(block.id); }
function safeMovementPolicy() { return { allow1by1towers: false, allowBridge: false, allowParkour: false, allowSprinting: true, allowFreeMotion: false, maxDropDown: 3, placeCost: Number.POSITIVE_INFINITY, scaffoldItems: [] }; }
function positiveAmount(value, minimum, maximum, label) { const amount = Number(value); if (!Number.isInteger(amount) || amount < minimum || amount > maximum) throw new ValidationError(`${label} must be an integer between ${minimum} and ${maximum}`); return amount; }
function nonNegativeAmount(value, minimum, maximum, label) { return positiveAmount(value, minimum, maximum, label); }
function smeltingCount(value) { const count = Number(value); if (!Number.isInteger(count) || count < 1 || count > 64) throw new ValidationError('Smelting count must be an integer between 1 and 64'); return count; }
function selectSmeltingFuel(bot, amount, preferred) { if (preferred && !SMELTING_FUELS[preferred]) throw new ValidationError(`Unsupported smelting fuel '${preferred}'`); const fuels = preferred ? [preferred] : Object.keys(SMELTING_FUELS); const available = fuels.find(name => inventoryCount(bot, name) >= Math.ceil(amount / SMELTING_FUELS[name])); const name = available ?? preferred ?? 'coal'; return { name, count: Math.ceil(amount / SMELTING_FUELS[name]) }; }
function inventoryLedger(bot) { const ledger = new Map(); for (const item of bot.inventory?.items?.() ?? []) ledger.set(item.name, (ledger.get(item.name) ?? 0) + item.count); return ledger; }
function resolveCraftPlan(bot, name, requiredCount, ledger, visiting, depth) {
  if ((ledger.get(name) ?? 0) >= requiredCount) return { ledger, missing: new Map(), steps: [] };
  if (depth > 10 || visiting.has(name)) throw new ValidationError(`Cannot resolve crafting plan for '${name}'`);
  const definition = bot.registry?.itemsByName?.[name]; if (!definition) throw new ValidationError(`Unknown item '${name}'`);
  const recipes = bot.recipesAll(definition.id, null, true) ?? [];
  if (!recipes.length) { const missing = requiredCount - (ledger.get(name) ?? 0); ledger.set(name, requiredCount); return { ledger, missing: new Map([[name, missing]]), steps: [] }; }
  let best; const nextVisiting = new Set(visiting).add(name);
  for (const recipe of recipes) {
    try { const candidate = planSpecificRecipe(bot, name, requiredCount, recipe, ledger, nextVisiting, depth); if (!best || candidate.score < best.score) best = candidate; } catch {}
  }
  if (!best) throw new ValidationError(`No usable crafting plan for '${name}'`); return best;
}
function planSpecificRecipe(bot, name, requiredCount, recipe, ledger, visiting, depth) {
  let candidateLedger = new Map(ledger); const candidateMissing = new Map(); const candidateSteps = [];
  if (recipe.requiresTable && !bot.findBlock({ matching: bot.registry.blocksByName?.crafting_table?.id, maxDistance: 6 })) { const tablePlan = resolveCraftPlan(bot, 'crafting_table', 1, candidateLedger, visiting, depth + 1); candidateLedger = tablePlan.ledger; mergeMissing(candidateMissing, tablePlan.missing); candidateSteps.push(...tablePlan.steps); }
  const resultCount = Math.max(1, recipe.result?.count ?? 1); const crafts = Math.ceil((requiredCount - (candidateLedger.get(name) ?? 0)) / resultCount);
  for (const ingredient of recipe.delta.filter(value => value.count < 0)) { const ingredientName = bot.registry.items?.[ingredient.id]?.name; if (!ingredientName) continue; const needed = Math.abs(ingredient.count) * crafts; const ingredientPlan = resolveCraftPlan(bot, ingredientName, needed, candidateLedger, visiting, depth + 1); candidateLedger = ingredientPlan.ledger; mergeMissing(candidateMissing, ingredientPlan.missing); candidateSteps.push(...ingredientPlan.steps); candidateLedger.set(ingredientName, (candidateLedger.get(ingredientName) ?? 0) - needed); }
  candidateLedger.set(name, (candidateLedger.get(name) ?? 0) + resultCount * crafts); candidateSteps.push({ item: name, crafts, resultCount: resultCount * crafts }); return { ledger: candidateLedger, missing: candidateMissing, steps: candidateSteps, score: [...candidateMissing.values()].reduce((sum, value) => sum + value, 0), recipe };
}
function rankRecipes(bot, _name, _requiredCount, ledger, _visiting, _depth, recipes) { return [...recipes].map((recipe, index) => ({ recipe, index, score: recipeAffinity(bot, recipe, ledger) })).sort((left, right) => left.score - right.score || left.index - right.index).map(value => value.recipe); }
function inspectRecipeAlternatives(bot, name, requiredCount, ledger, selected) { const definition = bot.registry?.itemsByName?.[name]; if (!definition) return []; const recipes = rankRecipes(bot, name, requiredCount, ledger, new Set(), 0, bot.recipesAll(definition.id, null, true) ?? []); if (selected) recipes.sort((left, right) => Number(right === selected) - Number(left === selected)); return recipes.map((recipe, index) => ({ rank: index + 1, selected: recipe === selected, score: recipeAffinity(bot, recipe, ledger), requiresTable: recipe.requiresTable, ingredients: recipe.delta.filter(value => value.count < 0).map(value => ({ name: bot.registry.items?.[value.id]?.name, count: Math.abs(value.count) })).filter(value => value.name) })); }
function craftIngredients(bot, plan) { if (!plan.recipe) return []; const finalStep = plan.steps.at(-1); const crafts = Number(finalStep?.crafts ?? 0); if (!Number.isInteger(crafts) || crafts < 1) return []; return plan.recipe.delta.filter(value => value.count < 0).map(value => ({ item: bot.registry.items?.[value.id]?.name, count: Math.abs(value.count) * crafts })).filter(value => value.item); }
function recipeAffinity(bot, recipe, ledger) { let score = 0; for (const ingredient of recipe.delta.filter(value => value.count < 0)) { const name = bot.registry.items?.[ingredient.id]?.name; if (!name) continue; const required = Math.abs(ingredient.count); const direct = ledger.get(name) ?? 0; score += Math.max(0, required - direct) * 100; if (direct >= required) score -= 1000; else if (craftSourceAvailable(bot, name, ledger)) score -= 50; } return score; }
function craftSourceAvailable(bot, name, ledger) { const definition = bot.registry.itemsByName?.[name]; if (!definition) return false; return (bot.recipesAll(definition.id, null, true) ?? []).some(recipe => recipe.delta.some(ingredient => ingredient.count < 0 && (ledger.get(bot.registry.items?.[ingredient.id]?.name) ?? 0) > 0)); }
function missingList(missing) { return [...missing].map(([name, count]) => ({ name, count })); }
function mergeMissing(target, source) { for (const [name, count] of source) target.set(name, (target.get(name) ?? 0) + count); }
function isAir(block) { return ['air', 'cave_air', 'void_air'].includes(block?.name); }
function isLog(name = '') { return name.endsWith('_log') || name.endsWith('_stem') || name.endsWith('_hyphae'); }
function positionKey(position) { return `${position.x},${position.y},${position.z}`; }
function connectedTreeLogs(bot, start, visited, requestedLog) { const origin = bot.blockAt(start); if (!origin || !isLog(origin.name) || (requestedLog !== 'any' && origin.name !== requestedLog)) return []; const queue = [origin.position]; const found = []; while (queue.length && found.length < 256) { const position = queue.shift(); const key = positionKey(position); if (visited.has(key)) continue; visited.add(key); const block = bot.blockAt(position); if (!block || !isLog(block.name) || (requestedLog !== 'any' && block.name !== requestedLog) || Math.abs(position.x - start.x) > 5 || Math.abs(position.z - start.z) > 5 || Math.abs(position.y - start.y) > 32) continue; found.push(block); for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) queue.push(position.offset(x, y, z)); } return found; }
function saplingForLog(log = '') { return log.replace(/_(log|wood)$/, '_sapling').replace(/crimson_(stem|hyphae)$/, 'crimson_fungus').replace(/warped_(stem|hyphae)$/, 'warped_fungus').replace(/^mangrove_sapling$/, 'mangrove_propagule'); }
function bestItem(bot, predicate) { return bot.inventory.items().filter(predicate).sort((left, right) => equipmentRank(right.name) - equipmentRank(left.name))[0]; }
function equipmentRank(name) { return ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite'].findIndex(material => name.startsWith(`${material}_`)) + 1; }
async function equipBestWeapon(bot) { const weapon = bestItem(bot, item => item.name.endsWith('_sword') || item.name.endsWith('_axe')); if (weapon) await bot.equip(weapon, 'hand'); }
function distance3(left, right) { return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z); }
function boundedDistance(value, minimum, maximum, field) { const number = Number(value); if (!Number.isFinite(number)) throw new ValidationError(`${field} must be numeric`); return Math.max(minimum, Math.min(maximum, number)); }
function boundedTimeout(value, minimum, maximum, field) { const number = Number(value); if (!Number.isInteger(number) || number < minimum || number > maximum) throw new ValidationError(`${field} must be an integer between ${minimum} and ${maximum}`); return number; }
function navigationGuard(bot, destination, range, stagnationMs, scaffoldingAllowed) { let bestDistance = distance3(bot.entity.position, destination); let progressedAt = Date.now(); let stopped = false; let rejectGuard; const promise = new Promise((_resolve, reject) => { rejectGuard = reject; }); const onMove = () => { const current = distance3(bot.entity.position, destination); if (bestDistance - current >= 0.5) { bestDistance = current; progressedAt = Date.now(); } }; const onReset = reason => { if (['place_error', 'no_scaffolding_blocks'].includes(reason)) rejectGuard(new ValidationError(`Navigation route requires forbidden or failed block placement (${reason})`)); }; const onPath = result => { if (!scaffoldingAllowed && result.path?.some(node => node.toPlace?.some(block => !block.useOne))) rejectGuard(new ValidationError('Navigation route requires scaffolding, but automatic block placement is disabled')); }; const timer = setInterval(() => { if (distance3(bot.entity.position, destination) <= range + 1) return; if (Date.now() - progressedAt >= stagnationMs) rejectGuard(new ValidationError(`Navigation stalled for ${stagnationMs}ms at ${formatPosition(bot.entity.position)}`)); }, 1000); timer.unref?.(); bot.on('move', onMove); bot.on('path_reset', onReset); bot.on('path_update', onPath); return { promise, stop: () => { if (stopped) return; stopped = true; clearInterval(timer); bot.off('move', onMove); bot.off('path_reset', onReset); bot.off('path_update', onPath); } }; }
async function waitForVerticalPosition(bot, minimumY, signal) { const started = Date.now(); while (Date.now() - started < 1_500) { if (signal?.aborted) throw signal.reason ?? new ValidationError('Pillar step cancelled'); if (Number(bot.entity?.position?.y) >= minimumY) return; await delay(25); } throw new ValidationError(`PILLAR_POSITION_NOT_VERIFIED bot did not reach Y ${minimumY.toFixed(2)}`); }
async function cancellableDelay(durationMs, signal) { const started = Date.now(); while (Date.now() - started < durationMs) { if (signal?.aborted) throw signal.reason ?? new NavigationError('NAVIGATION_CANCELLED', 'Recovery action was cancelled', {}); await delay(Math.min(25, durationMs - (Date.now() - started))); } }
function formatPosition(position) { return position ? `${Number(position.x).toFixed(1)},${Number(position.y).toFixed(1)},${Number(position.z).toFixed(1)}` : 'unknown'; }
function uniqueDiscoveries(discoveries) { const seen = new Set(); return discoveries.filter(discovery => { const key = `${discovery.marker}:${discovery.position.x}:${discovery.position.y}:${discovery.position.z}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function isStorageBlock(name) { return STORAGE_BLOCKS.has(name) || /_shulker_box$/.test(String(name)); }
function storageSnapshot(container, position) { const inventory = summarizeItems(container.containerItems()); return { kind: String(container.type ?? 'storage'), position: { x: Number(position.x), y: Number(position.y), z: Number(position.z) }, inventory, capacitySlots: Number(container.inventoryStart ?? container.slots?.length ?? 0), occupiedSlots: container.containerItems().length }; }
function containerCount(container, name) { return itemCount(summarizeItems(container.containerItems()), name); }
function windowInventoryCount(container, bot, item) { const start = Number(container.inventoryStart); const end = Number(container.inventoryEnd); if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || !Array.isArray(container.slots)) return inventoryCount(bot, item); return container.slots.slice(start, end).filter(entry => entry?.name === item).reduce((sum, entry) => sum + entry.count, 0); }
async function waitForStorageState(bot, container, item, expected, timeoutMs, operation) { const started = Date.now(); let observed = { bot: windowInventoryCount(container, bot, item), storage: containerCount(container, item) }; while (Date.now() - started <= timeoutMs) { observed = { bot: windowInventoryCount(container, bot, item), storage: containerCount(container, item) }; if (observed.bot === expected.bot && observed.storage === expected.storage) return observed; await delay(50); } throw new ValidationError(`Storage ${operation} verification timed out for '${item}': expected bot=${expected.bot}, storage=${expected.storage}; observed bot=${observed.bot}, storage=${observed.storage}`); }
function itemCount(inventory, name) { return inventory.filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0); }
function summarizeItems(items) { const totals = new Map(); for (const item of items) totals.set(item.name, (totals.get(item.name) ?? 0) + item.count); return [...totals].map(([name, count]) => ({ name, count })).sort((left, right) => left.name.localeCompare(right.name)); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForViewer(port, timeoutMs = 5000) {
  const started = Date.now(); let lastError;
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(`http://127.0.0.1:${port}`); await response.body?.cancel(); if (response.ok) return; }
    catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new ValidationError(`Camera server on port ${port} did not become ready`, { cause: lastError });
}

function compatibleViewerVersion(version, supported) {
  if (supported.includes(version)) return version;
  const family = String(version).split('.').slice(0, 2).join('.'); const candidates = supported.filter(item => item === family || item.startsWith(`${family}.`));
  return candidates.at(-1) ?? supported.at(-1) ?? version;
}

async function validateCanvas() {
  try { const module = await import('canvas'); const canvas = module.createCanvas(1, 1); canvas.getContext('2d').fillRect(0, 0, 1, 1); }
  catch (error) { throw new ValidationError(`Canvas renderer is unavailable: ${error.message}`); }
}
