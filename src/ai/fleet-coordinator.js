import { ConflictError, ValidationError } from '../core/errors.js';

const PICKAXES = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'];
const LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'];

export class FleetCoordinator {
  #recent = new Map();
  constructor({ gateway, bots, goals, events, logger }) { this.gateway = gateway; this.bots = bots; this.goals = goals; this.events = events; this.logger = logger; }
  status() { return { llm: this.gateway.status(), bots: this.bots.list().length }; }
  shouldHandle(botId, selector) { return this.#select(selector).map(bot => bot.id).sort()[0] === botId; }
  coordinateOnce(key, request) { const recent = this.#recent.get(key); if (recent && Date.now() - recent.createdAt < 3000) return recent.promise; const promise = this.coordinate(request).finally(() => setTimeout(() => this.#recent.delete(key), 3000)); this.#recent.set(key, { createdAt: Date.now(), promise }); return promise; }
  async coordinate({ text, selector, actor = 'api' }) {
    if (typeof text !== 'string' || !text.trim()) throw new ValidationError('Coordinator request text is required');
    const intent = await this.gateway.interpret(text, { selector, bots: this.bots.list().map(bot => ({ alias: bot.metadata.commandAlias ?? bot.name, class: bot.metadata.className ?? 'worker', status: bot.status, inventory: bot.runtime.inventorySummary })) });
    const selected = this.#select(intent.selector); if (!selected.length) throw new ConflictError(`No available bots match '${intent.selector}'`);
    const targets = ['collect', 'craft'].includes(intent.intent) ? selected.slice(0, Math.min(selected.length, intent.count)) : selected;
    const counts = distribute(intent.count, targets.length);
    await this.events.publish('coordinator.requested', { actor, text, intent, targets: targets.map(bot => bot.id) }, { source: 'fleet-coordinator' });
    const results = await Promise.allSettled(targets.map((bot, index) => this.#execute(bot.id, { ...intent, count: counts[index] })));
    const response = { intent, results: results.map((result, index) => ({ botId: targets[index].id, status: result.status === 'fulfilled' ? 'COMPLETED' : 'FAILED', result: result.value, error: result.reason?.message })) };
    await this.events.publish('coordinator.completed', response, { source: 'fleet-coordinator' }); return response;
  }
  #select(selector = 'auto') {
    const available = this.bots.list().filter(bot => ['READY', 'ACTIVE', 'PAUSED'].includes(bot.status));
    if (selector === 'global') return available;
    if (selector.startsWith('bot:')) { const name = selector.slice(4).toLowerCase(); return available.filter(bot => bot.id === name || String(bot.metadata.commandAlias ?? bot.name).toLowerCase() === name); }
    if (selector.startsWith('class:')) { const name = selector.slice(6).toLowerCase(); return available.filter(bot => String(bot.metadata.className ?? 'worker').toLowerCase() === name); }
    return available.slice(0, 1);
  }
  async #execute(botId, intent) {
    const runtime = this.bots.get(botId); const adapter = runtime.adapter;
    if (intent.intent === 'status') return runtime.snapshot();
    if (intent.intent === 'follow') return adapter.followPlayer({ username: intent.player });
    if (intent.intent === 'move') return adapter.smartMove({ x: intent.x, y: intent.y, z: intent.z });
    if (intent.intent === 'set_home') return adapter.setHome({ name: intent.home });
    if (intent.intent === 'home') return adapter.goHome({ name: intent.home });
    if (intent.intent === 'craft') return adapter.craftItem({ item: intent.item, count: intent.count });
    if (intent.intent === 'collect') {
      if (requiresPickaxe(intent.block)) await this.#ensurePickaxe(botId);
      const goal = this.goals.create({ description: `Coordinator collect ${intent.count} ${intent.block}`, priority: 70, constraints: { preferredBot: botId }, steps: [{ type: 'collect', input: { block: intent.block, count: intent.count }, requiredCapabilities: ['minecraft.collection'], timeout: 300_000, retries: 1 }] });
      return this.goals.run(goal.id);
    }
    throw new ValidationError(`Unsupported coordinator intent '${intent.intent}'`);
  }
  async #ensurePickaxe(botId) {
    const target = this.bots.get(botId); if (findPickaxe(target.adapter.snapshot())) return;
    const activeBots = new Set(this.goals.allTasks().filter(task => task.status === 'RUNNING').map(task => task.assignedBot));
    const targetSnapshot = target.adapter.snapshot();
    const donor = this.bots.list().find(bot => bot.id !== botId && !activeBots.has(bot.id) && bot.runtime.position && findPickaxe(bot.runtime) && bot.runtime.dimension === targetSnapshot.dimension && sameServer(this.bots.get(bot.id).options, target.options));
    if (donor) {
      const tool = findPickaxe(donor.runtime); const donorRuntime = this.bots.get(donor.id); const position = donorRuntime.adapter.snapshot().position;
      if (position) await target.adapter.smartMove({ ...position, range: 2 }); await donorRuntime.adapter.dropItem({ item: tool, count: 1 }); await target.adapter.pickupItem({ item: tool });
      if (findPickaxe(target.adapter.snapshot())) return;
    }
    try { await target.adapter.craftItem({ item: 'wooden_pickaxe', count: 1 }); }
    catch {
      let gathered = false;
      for (const block of LOGS) { try { await target.adapter.collect({ block, count: 3, maxDistance: 64 }); gathered = true; break; } catch {} }
      if (!gathered) throw new ConflictError('No pickaxe is available and no craftable wood was found'); await target.adapter.craftItem({ item: 'wooden_pickaxe', count: 1 });
    }
    if (!findPickaxe(target.adapter.snapshot())) throw new ConflictError('Pickaxe preparation could not be verified');
  }
}

function findPickaxe(snapshot) { return PICKAXES.find(name => snapshot.inventorySummary?.some(item => item.name === name && item.count > 0)); }
function requiresPickaxe(block) { return /stone|ore|deepslate|obsidian|cobblestone/.test(block); }
function sameServer(left = {}, right = {}) { return String(left.host ?? 'localhost').toLowerCase() === String(right.host ?? 'localhost').toLowerCase() && Number(left.port ?? 25565) === Number(right.port ?? 25565); }
function distribute(total, slots) { const base = Math.floor(total / slots); const remainder = total % slots; return Array.from({ length: slots }, (_, index) => base + (index < remainder ? 1 : 0)); }
