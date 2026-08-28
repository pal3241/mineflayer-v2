import { EventEmitter } from 'node:events';
import { ValidationError } from '../../core/errors.js';

const SMELTING_RECIPES = Object.freeze({ iron_ingot: 'raw_iron', gold_ingot: 'raw_gold', copper_ingot: 'raw_copper' });
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
  constructor({ factory, plugins = true, autoEat = {} } = {}) { super(); this.factory = factory; this.plugins = plugins; this.autoEatConfig = { enabled: true, minHunger: 15, ...autoEat }; this.client = null; this.status = 'DISCONNECTED'; this.pluginStatus = {}; this.homes = new Map(); this.combatState = { mode: 'OFF', status: 'IDLE' }; }

  async connect(options) {
    if (this.client) return;
    const factory = this.factory ?? (await import('mineflayer')).createBot;
    this.status = 'CONNECTING';
    this.client = factory(options);
    if (this.plugins) await this.#loadPlugins();
    for (const name of ['login', 'spawn', 'end', 'kicked', 'error', 'health', 'move', 'death', 'chat', 'whisper']) this.client.on(name, (...args) => this.emit(name, ...args));
    this.client.once('spawn', () => { this.status = 'READY'; void this.#configureMovement().catch(error => { this.status = 'DEGRADED'; this.emit('pluginError', { plugin: 'movement', error }); }); });
    this.client.once('end', () => { this.status = 'DISCONNECTED'; this.client = null; });
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
    if (Movements) { const movements = new Movements(this.client); movements.allow1by1towers = false; movements.allowParkour = false; movements.allowFreeMotion = false; movements.scafoldingBlocks = []; movements.placeCost = Number.POSITIVE_INFINITY; movements.maxDropDown = Math.min(3, movements.maxDropDown); this.client.pathfinder.setMovements(movements); }
    if (this.autoEatLoader && !this.client.autoEat) {
      this.client.loadPlugin(this.autoEatLoader); this.client.autoEat.setOpts({ minHunger: this.autoEatConfig.minHunger }); this.client.autoEat.enableAuto(); this.pluginStatus.autoEat = 'HEALTHY';
    }
  }

  #ready(capability) { if (!this.client || this.status !== 'READY') throw new ValidationError(`Cannot use '${capability}' while bot is ${this.status}`); return this.client; }
  #abort(signal, action) { if (!signal) return () => {}; const handler = () => action(); if (signal.aborted) handler(); else signal.addEventListener('abort', handler, { once: true }); return () => signal.removeEventListener('abort', handler); }

  async chat(message) { const bot = this.#ready('chat'); bot.chat(String(message).slice(0, 240)); return { sent: true }; }
  async navigate({ x, y, z, range = 1 }, { signal } = {}) {
    const bot = this.#ready('navigation'); if (!bot.pathfinder) throw new ValidationError('Pathfinder plugin is unavailable');
    for (const value of [x, y, z]) if (!Number.isFinite(Number(value))) throw new ValidationError('Navigation requires numeric x, y, z');
    const destination = { x: Number(x), y: Number(y), z: Number(z) }; const acceptedRange = boundedDistance(range, 1, 64, 'Navigation range'); const goals = this.pathfinderModule.goals ?? this.pathfinderModule.default?.goals; const goal = new goals.GoalNear(destination.x, destination.y, destination.z, acceptedRange);
    const cleanupAbort = this.#abort(signal, () => bot.pathfinder.setGoal(null)); const guard = navigationGuard(bot, destination, acceptedRange, 10_000);
    try { await Promise.race([bot.pathfinder.goto(goal), guard.promise]); const position = this.snapshot().position; if (!position || distance3(position, destination) > acceptedRange + 1) throw new ValidationError(`Navigation ended outside target range: target ${destination.x},${destination.y},${destination.z}, actual ${formatPosition(position)}`); return { position }; }
    catch (error) { bot.pathfinder.setGoal(null); throw error; } finally { guard.stop(); cleanupAbort(); }
  }
  async followPlayer({ username, range = 2 }, { signal } = {}) {
    const bot = this.#ready('follow-player'); const actualName = Object.keys(bot.players ?? {}).find(name => name.toLowerCase() === String(username).toLowerCase()); const entity = bot.players?.[actualName]?.entity;
    if (!entity) throw new ValidationError(`Player '${username}' is not visible`);
    if (!bot.pathfinder) throw new ValidationError('Pathfinder plugin is unavailable');
    const acceptedRange = boundedDistance(range, 1, 64, 'Follow range'); const goals = this.pathfinderModule.goals ?? this.pathfinderModule.default?.goals; bot.pathfinder.setGoal(new goals.GoalFollow(entity, acceptedRange), true);
    this.#abort(signal, () => bot.pathfinder.setGoal(null)); return { following: actualName, range };
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
  async craftRequirements({ item, count = 1 }) {
    const bot = this.#ready('craft-planning'); const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1)); const inventory = inventoryLedger(bot);
    const plan = resolveCraftPlan(bot, item, amount, inventory, new Set(), 0); const alternatives = inspectRecipeAlternatives(bot, item, amount, inventory, plan.recipe);
    return { item, count: amount, missing: missingList(plan.missing), steps: plan.steps, selectedRecipe: alternatives[0] ?? null, alternatives };
  }
  async findSourceBlocks({ item }) {
    const bot = this.#ready('resource-analysis'); const definition = bot.registry?.itemsByName?.[item]; if (!definition) return [];
    return (bot.registry.blocksArray ?? Object.values(bot.registry.blocksByName ?? {})).filter(block => block?.diggable !== false && block.drops?.includes(definition.id)).sort((left, right) => Number(right.name === item) - Number(left.name === item)).map(block => block.name);
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
    return this.#withStorage(position, 'storage-deposit', async container => { const beforeStorage = containerCount(container, item); await container.deposit(definition.id, null, amount); const afterBot = inventoryCount(bot, item); const storage = storageSnapshot(container, position); const afterStorage = itemCount(storage.inventory, item); if (beforeBot - afterBot !== amount || afterStorage - beforeStorage !== amount) throw new ValidationError(`Deposit verification failed for ${amount} '${item}': bot ${beforeBot}->${afterBot}, storage ${beforeStorage}->${afterStorage}`); return { item, transferred: amount, storage, verification: { botBefore: beforeBot, botAfter: afterBot, storageBefore: beforeStorage, storageAfter: afterStorage } }; });
  }
  async withdrawStorage({ position, item, count }) {
    const bot = this.#ready('storage-withdraw'); const definition = bot.registry?.itemsByName?.[item]; const amount = Math.max(1, Math.min(2304, Number(count))); if (!definition || !Number.isInteger(amount)) throw new ValidationError(`Invalid withdrawal item or count for '${item}'`);
    return this.#withStorage(position, 'storage-withdraw', async container => { const beforeBot = inventoryCount(bot, item); const beforeStorage = containerCount(container, item); if (beforeStorage < amount) throw new ValidationError(`Storage only has ${beforeStorage} '${item}', cannot withdraw ${amount}`); await container.withdraw(definition.id, null, amount); const afterBot = inventoryCount(bot, item); const storage = storageSnapshot(container, position); const afterStorage = itemCount(storage.inventory, item); if (afterBot - beforeBot !== amount || beforeStorage - afterStorage !== amount) throw new ValidationError(`Withdrawal verification failed for ${amount} '${item}': bot ${beforeBot}->${afterBot}, storage ${beforeStorage}->${afterStorage}`); return { item, transferred: amount, storage, verification: { botBefore: beforeBot, botAfter: afterBot, storageBefore: beforeStorage, storageAfter: afterStorage } }; });
  }
  async smeltRequirements({ item, count = 1 }) {
    const bot = this.#ready('smelting-plan'); const input = SMELTING_RECIPES[item]; if (!input) return null; const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1));
    return { item, count: amount, input: { name: input, count: amount }, fuel: { name: 'coal', count: Math.ceil(amount / 8) }, furnace: Boolean(bot.findBlock({ matching: bot.registry.blocksByName?.furnace?.id, maxDistance: 6 })) };
  }
  async smeltItem({ item, count = 1 }, { signal } = {}) {
    const bot = this.#ready('smelting'); const inputName = SMELTING_RECIPES[item]; if (!inputName) throw new ValidationError(`No supported smelting recipe for '${item}'`); const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1));
    let furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName?.furnace?.id, maxDistance: 6 });
    if (!furnaceBlock) { await this.#ensureCrafted('furnace', 1, new Set(), 0); await this.#placeUtilityBlock('furnace'); furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName.furnace.id, maxDistance: 6 }); }
    if (!furnaceBlock) throw new ValidationError('Could not place furnace');
    const input = bot.registry.itemsByName[inputName]; const fuel = bot.registry.itemsByName.coal; if (!input || inventoryCount(bot, inputName) < amount) throw new ValidationError(`Not enough '${inputName}' to smelt`);
    const fuelCount = Math.ceil(amount / 8); if (!fuel || inventoryCount(bot, 'coal') < fuelCount) throw new ValidationError('Not enough coal for smelting');
    const furnace = await bot.openFurnace(furnaceBlock); const started = Date.now(); const timeout = Math.max(20_000, amount * 12_000);
    try {
      await furnace.putInput(input.id, null, amount); await furnace.putFuel(fuel.id, null, fuelCount);
      while (furnace.outputItem()?.name !== item || (furnace.outputItem()?.count ?? 0) < amount) { if (signal?.aborted) throw signal.reason ?? new ValidationError('Smelting cancelled'); if (Date.now() - started > timeout) throw new ValidationError(`Smelting '${item}' timed out`); await new Promise(resolve => setTimeout(resolve, 250)); }
      await furnace.takeOutput(); return { item, count: amount, inventory: this.snapshot().inventorySummary };
    } finally { furnace.close(); }
  }
  async collect({ block, count = 1, maxDistance = 64 }, { signal } = {}) {
    const bot = this.#ready('collection'); if (!bot.collectBlock) throw new ValidationError('CollectBlock plugin is unavailable');
    const definition = bot.registry?.blocksByName?.[block]; if (!definition) throw new ValidationError(`Unknown block '${block}'`);
    const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1));
    const radius = boundedDistance(maxDistance, 1, 128, 'Collection distance'); const positions = bot.findBlocks({ matching: definition.id, maxDistance: radius, count: amount });
    const blocks = positions.map(position => bot.blockAt(position)).filter(Boolean); if (!blocks.length) throw new ValidationError(`No '${block}' found within ${maxDistance} blocks`);
    const cleanup = this.#abort(signal, () => { void bot.collectBlock.cancelTask(); });
    try { await bot.collectBlock.collect(blocks); return { block, requested: amount, collectedTargets: blocks.length, inventory: this.snapshot().inventorySummary }; } finally { cleanup(); }
  }
  async #withStorage(position, capability, operation) { const bot = this.#ready(capability); const { Vec3 } = await import('vec3'); const target = new Vec3(Number(position.x), Number(position.y), Number(position.z)); await this.smartMove({ x: target.x, y: target.y, z: target.z, range: 2 }); const block = bot.blockAt(target); if (!block || !isStorageBlock(block.name)) throw new ValidationError(`Storage block was not found at ${target.x},${target.y},${target.z}`); const container = await bot.openContainer(block); try { return await operation(container); } finally { container.close(); } }
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
    const bot = this.#ready('crafting'); const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1));
    await this.#ensureCrafted(item, amount, new Set(), 0); return { item, count: inventoryCount(bot, item), inventory: this.snapshot().inventorySummary };
  }
  async #ensureCrafted(name, requiredCount, visiting, depth) {
    const bot = this.#ready('crafting'); if (inventoryCount(bot, name) >= requiredCount) return;
    if (depth > 8 || visiting.has(name)) throw new ValidationError(`Cannot resolve crafting dependencies for '${name}'`);
    const definition = bot.registry?.itemsByName?.[name]; if (!definition) throw new ValidationError(`Unknown item '${name}'`); visiting.add(name);
    let table = bot.findBlock({ matching: bot.registry.blocksByName?.crafting_table?.id, maxDistance: 6 });
    const recipes = rankRecipes(bot, name, requiredCount, inventoryLedger(bot), visiting, depth, bot.recipesAll(definition.id, null, table || true)); let lastError;
    for (const recipe of recipes) {
      try {
        for (const ingredient of recipe.delta.filter(value => value.count < 0)) {
          const ingredientName = bot.registry.items[ingredient.id]?.name; if (!ingredientName) continue;
          const crafts = Math.ceil((requiredCount - inventoryCount(bot, name)) / recipe.result.count); await this.#ensureCrafted(ingredientName, Math.abs(ingredient.count) * crafts, new Set(visiting), depth + 1);
        }
        if (recipe.requiresTable && !table) { await this.#ensureCrafted('crafting_table', 1, new Set(visiting), depth + 1); await this.#placeCraftingTable(); table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 6 }); if (!table) throw new ValidationError('Could not place crafting table'); }
        const ready = bot.recipesFor(definition.id, null, requiredCount - inventoryCount(bot, name), table)[0]; if (!ready) throw new ValidationError(`Ingredients for '${name}' are incomplete`);
        const craftCount = Math.ceil((requiredCount - inventoryCount(bot, name)) / ready.result.count); await bot.craft(ready, craftCount, table ?? undefined); visiting.delete(name); return;
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
      const entity = bot.nearestEntity(candidate => candidate.name === 'item' && candidate.getDroppedItem?.()?.name === item);
      if (entity?.position) await this.navigate({ x: entity.position.x, y: entity.position.y, z: entity.position.z, range: 1 }, { signal }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new ValidationError(`Dropped item '${item}' was not found`);
  }
  async stopActions() { const bot = this.client; if (!bot) return; await this.stopCombat(); bot.pathfinder?.setGoal(null); await bot.collectBlock?.cancelTask?.(); bot.autoEat?.cancelEat?.(); bot.clearControlStates?.(); }

  async startViewer({ port = 3100, firstPerson = true, viewDistance = 6 } = {}) {
    const bot = this.#ready('camera'); if (bot.viewer) return { port: this.viewerPort, active: true };
    await validateCanvas();
    const module = await import('prismarine-viewer'); const viewer = module.mineflayer ?? module.default?.mineflayer;
    if (typeof viewer !== 'function') throw new ValidationError('Prismarine viewer is unavailable');
    const supportedVersions = module.supportedVersions ?? module.default?.supportedVersions ?? []; const renderVersion = compatibleViewerVersion(bot.version, supportedVersions);
    const viewerBot = renderVersion === bot.version ? bot : new Proxy(bot, { get: (target, property, receiver) => property === 'version' ? renderVersion : Reflect.get(target, property, receiver) });
    viewer(viewerBot, { port, firstPerson, viewDistance }); this.viewerPort = port; this.viewerRenderVersion = renderVersion;
    try { await waitForViewer(port); } catch (error) { await this.stopViewer(); throw error; }
    this.viewerVersionSupported = supportedVersions.includes(bot.version); return { port, active: true, version: bot.version, renderVersion, versionSupported: this.viewerVersionSupported };
  }

  async stopViewer() { if (!this.client?.viewer) return { active: false }; this.client.viewer.close(); delete this.client.viewer; this.viewerPort = null; this.viewerVersionSupported = null; this.viewerRenderVersion = null; return { active: false }; }

  snapshot() {
    const bot = this.client;
    return { connection: this.status, position: bot?.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null,
      health: bot?.health ?? null, food: bot?.food ?? null, dimension: bot?.game?.dimension ?? null,
      inventorySummary: bot?.inventory?.items?.().map(item => ({ name: item.name, count: item.count })) ?? [], plugins: { ...this.pluginStatus },
      camera: { active: Boolean(bot?.viewer), port: this.viewerPort ?? null, version: bot?.version ?? null, renderVersion: this.viewerRenderVersion ?? null, versionSupported: this.viewerVersionSupported ?? null }, combat: { ...this.combatState }, timestamp: new Date().toISOString() };
  }

  async disconnect(reason = 'MineHive shutdown') { if (!this.client) return; await this.stopViewer(); await this.stopActions(); this.client.quit?.(reason); }
  raw() { throw new ValidationError('Raw Mineflayer client access is forbidden outside adapter capabilities'); }
}

function inventoryCount(bot, name) { return bot.inventory?.items?.().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0) ?? 0; }
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
function recipeAffinity(bot, recipe, ledger) { let score = 0; for (const ingredient of recipe.delta.filter(value => value.count < 0)) { const name = bot.registry.items?.[ingredient.id]?.name; if (!name) continue; const required = Math.abs(ingredient.count); const direct = ledger.get(name) ?? 0; score += Math.max(0, required - direct) * 100; if (direct >= required) score -= 1000; else if (relatedMaterialAvailable(name, ledger)) score -= 50; } return score; }
function relatedMaterialAvailable(name, ledger) { const prefix = name.replace(/_(planks|log|wood|stem|hyphae|sapling)$/, ''); return [...ledger].some(([item, count]) => count > 0 && item.startsWith(`${prefix}_`) && /_(planks|log|wood|stem|hyphae)$/.test(item)); }
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
function navigationGuard(bot, destination, range, stagnationMs) { let bestDistance = distance3(bot.entity.position, destination); let progressedAt = Date.now(); let stopped = false; let rejectGuard; const promise = new Promise((_resolve, reject) => { rejectGuard = reject; }); const onMove = () => { const current = distance3(bot.entity.position, destination); if (bestDistance - current >= 0.5) { bestDistance = current; progressedAt = Date.now(); } }; const onReset = reason => { if (['place_error', 'no_scaffolding_blocks'].includes(reason)) rejectGuard(new ValidationError(`Navigation route requires forbidden or failed block placement (${reason})`)); }; const onPath = result => { if (result.path?.some(node => node.toPlace?.some(block => !block.useOne))) rejectGuard(new ValidationError('Navigation route requires scaffolding, but automatic block placement is disabled')); }; const timer = setInterval(() => { if (distance3(bot.entity.position, destination) <= range + 1) return; if (Date.now() - progressedAt >= stagnationMs) rejectGuard(new ValidationError(`Navigation stalled for ${stagnationMs}ms at ${formatPosition(bot.entity.position)}`)); }, 1000); timer.unref?.(); bot.on('move', onMove); bot.on('path_reset', onReset); bot.on('path_update', onPath); return { promise, stop: () => { if (stopped) return; stopped = true; clearInterval(timer); bot.off('move', onMove); bot.off('path_reset', onReset); bot.off('path_update', onPath); } }; }
function formatPosition(position) { return position ? `${Number(position.x).toFixed(1)},${Number(position.y).toFixed(1)},${Number(position.z).toFixed(1)}` : 'unknown'; }
function uniqueDiscoveries(discoveries) { const seen = new Set(); return discoveries.filter(discovery => { const key = `${discovery.marker}:${discovery.position.x}:${discovery.position.y}:${discovery.position.z}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function isStorageBlock(name) { return STORAGE_BLOCKS.has(name) || /_shulker_box$/.test(String(name)); }
function storageSnapshot(container, position) { const inventory = summarizeItems(container.containerItems()); return { kind: String(container.type ?? 'storage'), position: { x: Number(position.x), y: Number(position.y), z: Number(position.z) }, inventory, capacitySlots: Number(container.inventoryStart ?? container.slots?.length ?? 0), occupiedSlots: container.containerItems().length }; }
function containerCount(container, name) { return itemCount(summarizeItems(container.containerItems()), name); }
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
