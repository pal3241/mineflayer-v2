import { EventEmitter } from 'node:events';
import { ValidationError } from '../../core/errors.js';

export class MineflayerAdapter extends EventEmitter {
  constructor({ factory, plugins = true, autoEat = {} } = {}) { super(); this.factory = factory; this.plugins = plugins; this.autoEatConfig = { enabled: true, minHunger: 15, ...autoEat }; this.client = null; this.status = 'DISCONNECTED'; this.pluginStatus = {}; this.homes = new Map(); }

  async connect(options) {
    if (this.client) return;
    const factory = this.factory ?? (await import('mineflayer')).createBot;
    this.status = 'CONNECTING';
    this.client = factory(options);
    if (this.plugins) await this.#loadPlugins();
    for (const name of ['login', 'spawn', 'end', 'kicked', 'error', 'health', 'move', 'death', 'chat', 'whisper']) this.client.on(name, (...args) => this.emit(name, ...args));
    this.client.once('spawn', async () => { this.status = 'READY'; await this.#configureMovement(); });
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
    if (Movements) { const movements = new Movements(this.client); movements.allow1by1towers = false; this.client.pathfinder.setMovements(movements); }
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
    const goals = this.pathfinderModule.goals ?? this.pathfinderModule.default?.goals; const goal = new goals.GoalNear(Number(x), Number(y), Number(z), Math.max(1, Number(range)));
    const cleanup = this.#abort(signal, () => bot.pathfinder.setGoal(null));
    try { await bot.pathfinder.goto(goal); return { position: this.snapshot().position }; } finally { cleanup(); }
  }
  async followPlayer({ username, range = 2 }, { signal } = {}) {
    const bot = this.#ready('follow-player'); const actualName = Object.keys(bot.players ?? {}).find(name => name.toLowerCase() === String(username).toLowerCase()); const entity = bot.players?.[actualName]?.entity;
    if (!entity) throw new ValidationError(`Player '${username}' is not visible`);
    if (!bot.pathfinder) throw new ValidationError('Pathfinder plugin is unavailable');
    const goals = this.pathfinderModule.goals ?? this.pathfinderModule.default?.goals; bot.pathfinder.setGoal(new goals.GoalFollow(entity, Math.max(1, Number(range))), true);
    this.#abort(signal, () => bot.pathfinder.setGoal(null)); return { following: actualName, range };
  }
  async setHome({ name = 'home' } = {}) { const position = this.#ready('set-home').entity.position; const home = { x: position.x, y: position.y, z: position.z, dimension: this.client.game?.dimension }; this.homes.set(name, home); return { name, ...home }; }
  async goHome({ name = 'home', range = 1 } = {}, context = {}) { const home = this.homes.get(name); if (!home) throw new ValidationError(`Home '${name}' has not been set`); if (home.dimension && this.client.game?.dimension !== home.dimension) throw new ValidationError(`Home '${name}' is in ${home.dimension}`); return this.navigate({ ...home, range }, context); }
  async smartMove(input, context = {}) {
    if (input.player) return this.followPlayer({ username: input.player, range: input.range ?? 2 }, context);
    if (input.home) return this.goHome({ name: input.home, range: input.range }, context);
    return this.navigate(input, context);
  }
  async collect({ block, count = 1, maxDistance = 64 }, { signal } = {}) {
    const bot = this.#ready('collection'); if (!bot.collectBlock) throw new ValidationError('CollectBlock plugin is unavailable');
    const definition = bot.registry?.blocksByName?.[block]; if (!definition) throw new ValidationError(`Unknown block '${block}'`);
    const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1));
    const positions = bot.findBlocks({ matching: definition.id, maxDistance: Math.max(1, Math.min(128, Number(maxDistance))), count: amount });
    const blocks = positions.map(position => bot.blockAt(position)).filter(Boolean); if (!blocks.length) throw new ValidationError(`No '${block}' found within ${maxDistance} blocks`);
    const cleanup = this.#abort(signal, () => { void bot.collectBlock.cancelTask(); });
    try { await bot.collectBlock.collect(blocks); return { block, requested: amount, collectedTargets: blocks.length, inventory: this.snapshot().inventorySummary }; } finally { cleanup(); }
  }
  async craftItem({ item, count = 1 } = {}) {
    const bot = this.#ready('crafting'); const amount = Math.max(1, Math.min(64, Number.parseInt(count, 10) || 1));
    await this.#ensureCrafted(item, amount, new Set(), 0); return { item, count: inventoryCount(bot, item), inventory: this.snapshot().inventorySummary };
  }
  async #ensureCrafted(name, requiredCount, visiting, depth) {
    const bot = this.#ready('crafting'); if (inventoryCount(bot, name) >= requiredCount) return;
    if (depth > 8 || visiting.has(name)) throw new ValidationError(`Cannot resolve crafting dependencies for '${name}'`);
    const definition = bot.registry?.itemsByName?.[name]; if (!definition) throw new ValidationError(`Unknown item '${name}'`); visiting.add(name);
    let table = bot.findBlock({ matching: bot.registry.blocksByName?.crafting_table?.id, maxDistance: 6 });
    const recipes = bot.recipesAll(definition.id, null, table || true); let lastError;
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
    const bot = this.#ready('crafting-table'); const table = bot.inventory.items().find(value => value.name === 'crafting_table'); if (!table) throw new ValidationError('Crafting table is not available');
    const { Vec3 } = await import('vec3'); const origin = bot.entity.position.floored();
    const reference = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, z]) => bot.blockAt(origin.offset(x, -1, z))).find(block => block && ['air', 'cave_air', 'void_air'].includes(bot.blockAt(block.position.offset(0, 1, 0))?.name));
    if (!reference) throw new ValidationError('No safe adjacent space for crafting table');
    await bot.equip(table, 'hand'); await bot.placeBlock(reference, new Vec3(0, 1, 0));
  }
  async dropItem({ item, count = 1 }) { const bot = this.#ready('item-transfer'); const definition = bot.registry.itemsByName?.[item]; if (!definition || inventoryCount(bot, item) < count) throw new ValidationError(`Not enough '${item}' to transfer`); await bot.toss(definition.id, null, count); return { item, count, dropped: true }; }
  async pickupItem({ item, timeout = 10_000 }, { signal } = {}) {
    const bot = this.#ready('item-pickup'); const started = Date.now(); const initialCount = inventoryCount(bot, item);
    while (Date.now() - started < timeout) {
      if (signal?.aborted) throw signal.reason ?? new ValidationError('Item pickup cancelled');
      if (inventoryCount(bot, item) > initialCount) return { item, collected: true };
      const entity = bot.nearestEntity(candidate => candidate.name === 'item' && candidate.getDroppedItem?.()?.name === item);
      if (entity?.position) await this.navigate({ x: entity.position.x, y: entity.position.y, z: entity.position.z, range: 1 }, { signal }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new ValidationError(`Dropped item '${item}' was not found`);
  }
  async stopActions() { const bot = this.client; if (!bot) return; bot.pathfinder?.setGoal(null); await bot.collectBlock?.cancelTask?.(); bot.autoEat?.cancelEat?.(); bot.clearControlStates?.(); }

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
      camera: { active: Boolean(bot?.viewer), port: this.viewerPort ?? null, version: bot?.version ?? null, renderVersion: this.viewerRenderVersion ?? null, versionSupported: this.viewerVersionSupported ?? null }, timestamp: new Date().toISOString() };
  }

  async disconnect(reason = 'MineHive shutdown') { if (!this.client) return; await this.stopViewer(); await this.stopActions(); this.client.quit?.(reason); }
  raw() { throw new ValidationError('Raw Mineflayer client access is forbidden outside adapter capabilities'); }
}

function inventoryCount(bot, name) { return bot.inventory?.items?.().filter(item => item.name === name).reduce((sum, item) => sum + item.count, 0) ?? 0; }

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
