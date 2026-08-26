import { EventEmitter } from 'node:events';
import { ValidationError } from '../../core/errors.js';

export class MineflayerAdapter extends EventEmitter {
  constructor({ factory, plugins = true, autoEat = {} } = {}) { super(); this.factory = factory; this.plugins = plugins; this.autoEatConfig = { enabled: true, minHunger: 15, ...autoEat }; this.client = null; this.status = 'DISCONNECTED'; this.pluginStatus = {}; }

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
    const bot = this.#ready('follow-player'); const entity = bot.players?.[username]?.entity;
    if (!entity) throw new ValidationError(`Player '${username}' is not visible`);
    return this.navigate({ x: entity.position.x, y: entity.position.y, z: entity.position.z, range }, { signal });
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
  async stopActions() { const bot = this.client; if (!bot) return; bot.pathfinder?.setGoal(null); await bot.collectBlock?.cancelTask?.(); bot.autoEat?.cancelEat?.(); bot.clearControlStates?.(); }

  async startViewer({ port = 3100, firstPerson = true, viewDistance = 6 } = {}) {
    const bot = this.#ready('camera'); if (bot.viewer) return { port: this.viewerPort, active: true };
    const module = await import('prismarine-viewer'); const viewer = module.mineflayer ?? module.default?.mineflayer;
    if (typeof viewer !== 'function') throw new ValidationError('Prismarine viewer is unavailable');
    viewer(bot, { port, firstPerson, viewDistance }); this.viewerPort = port; return { port, active: true };
  }

  async stopViewer() { if (!this.client?.viewer) return { active: false }; this.client.viewer.close(); delete this.client.viewer; this.viewerPort = null; return { active: false }; }

  snapshot() {
    const bot = this.client;
    return { connection: this.status, position: bot?.entity?.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null,
      health: bot?.health ?? null, food: bot?.food ?? null, dimension: bot?.game?.dimension ?? null,
      inventorySummary: bot?.inventory?.items?.().map(item => ({ name: item.name, count: item.count })) ?? [], plugins: { ...this.pluginStatus },
      camera: { active: Boolean(bot?.viewer), port: this.viewerPort ?? null }, timestamp: new Date().toISOString() };
  }

  async disconnect(reason = 'MineHive shutdown') { if (!this.client) return; await this.stopViewer(); await this.stopActions(); this.client.quit?.(reason); }
  raw() { throw new ValidationError('Raw Mineflayer client access is forbidden outside adapter capabilities'); }
}
