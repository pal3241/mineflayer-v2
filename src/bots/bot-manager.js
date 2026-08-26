import { randomUUID } from 'node:crypto';
import { Bot } from './bot.js';
import { BotRuntime } from './bot-runtime.js';
import { MineflayerAdapter } from '../plugins/minecraft/mineflayer-adapter.js';
import { ConflictError, NotFoundError } from '../core/errors.js';

export class BotManager {
  #runtimes = new Map();
  #createdHandlers = new Set();
  constructor({ eventBus, logger, adapterFactory = () => new MineflayerAdapter(), defaultCapabilities = [], reconnect = {} }) { this.eventBus = eventBus; this.logger = logger; this.adapterFactory = adapterFactory; this.defaultCapabilities = defaultCapabilities; this.reconnect = reconnect; }
  onCreated(handler) { this.#createdHandlers.add(handler); return () => this.#createdHandlers.delete(handler); }
  create(input) {
    const id = input.id ?? randomUUID();
    if (this.#runtimes.has(id)) throw new ConflictError(`Bot '${id}' already exists`);
    const bot = new Bot({ id, name: input.name ?? input.username ?? id, capabilities: input.capabilities ?? this.defaultCapabilities, metadata: input.metadata });
    const runtime = new BotRuntime({ bot, adapter: this.adapterFactory(input), eventBus: this.eventBus, logger: this.logger, reconnect: input.reconnect ?? this.reconnect });
    runtime.options = input.connection ?? input;
    this.#runtimes.set(id, runtime);
    for (const handler of this.#createdHandlers) handler(runtime);
    void this.eventBus?.publish('bot.created', runtime.snapshot(), { source: 'bot-manager' });
    return runtime.snapshot();
  }
  get(id) { const runtime = this.#runtimes.get(id); if (!runtime) throw new NotFoundError('Bot', id); return runtime; }
  list() { return [...this.#runtimes.values()].map(runtime => runtime.snapshot()); }
  start(id) { const runtime = this.get(id); return runtime.start(runtime.options); }
  stop(id) { return this.get(id).stop(); }
  async remove(id) { const runtime = this.get(id); await runtime.stop(); this.#runtimes.delete(id); return true; }
  async stopAll() { await Promise.allSettled([...this.#runtimes.values()].map(runtime => runtime.stop())); }
}
