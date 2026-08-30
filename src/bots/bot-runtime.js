import { StateMachine } from '../orchestration/state-machine.js';

export class BotRuntime {
  constructor({ bot, adapter, eventBus, logger, reconnect = {} }) {
    this.bot = bot; this.adapter = adapter; this.eventBus = eventBus; this.logger = logger;
    this.reconnect = { enabled: true, maxAttempts: 5, delayMs: 3000, ...reconnect }; this.reconnectAttempts = 0; this.stopping = false;
    this.transitionQueue = Promise.resolve();
    this.machine = new StateMachine({ initial: 'REGISTERED', eventBus, source: `bot:${bot.id}`, states: {
      REGISTERED: { on: { START: 'CONNECTING', STOP: 'OFFLINE' } },
      CONNECTING: { on: { CONNECTED: 'CONNECTED', FAIL: 'FAILED', STOP: 'STOPPING' } },
      CONNECTED: { on: { READY: 'READY', FAIL: 'DEGRADED', STOP: 'STOPPING' } },
      READY: { on: { ACTIVATE: 'ACTIVE', FAIL: 'DEGRADED', STOP: 'STOPPING' } },
      ACTIVE: { on: { PAUSE: 'PAUSED', FAIL: 'DEGRADED', STOP: 'STOPPING' } },
      PAUSED: { on: { RESUME: 'ACTIVE', STOP: 'STOPPING' } },
      DEGRADED: { on: { RECOVER: 'READY', RETRY: 'CONNECTING', FAIL: 'FAILED', STOP: 'STOPPING' } },
      FAILED: { on: { START: 'CONNECTING', STOP: 'OFFLINE' } },
      STOPPING: { on: { STOPPED: 'OFFLINE', FAIL: 'FAILED' } }, OFFLINE: { on: { START: 'CONNECTING' } }
    }});
    adapter.on('login', () => this.#enqueueTransition('CONNECTED'));
    adapter.on('spawn', () => { this.reconnectAttempts = 0; this.#enqueueTransition('READY'); });
    adapter.on('error', error => this.#fail(error));
    adapter.on('pluginError', failure => this.#fail(new Error(`Plugin '${failure.plugin}' failed: ${failure.error.message}`, { cause: failure.error })));
    adapter.on('combatError', error => this.#fail(error));
    adapter.on('death', death => void this.eventBus?.publish('bot.death', { botId: this.bot.id, ...death }, { source: `bot:${this.bot.id}`, correlationId: this.bot.id }));
    adapter.on('kicked', reason => this.#fail(new Error(String(reason))));
    adapter.on('end', reason => { if (this.stopping && this.machine.can('STOPPED')) this.#enqueueTransition('STOPPED'); else void this.#disconnected(reason); });
  }

  #enqueueTransition(event) {
    this.transitionQueue = this.transitionQueue.then(() => this.#safeTransition(event)).catch(error => this.#fail(error));
    return this.transitionQueue;
  }
  async #safeTransition(event) { if (this.machine.can(event)) { await this.machine.transition(event); this.bot.status = this.machine.state; } }
  async #fail(error) { this.logger?.error('bot.runtime.failure', { botId: this.bot.id, error: error.message }); await this.#safeTransition('FAIL'); }
  async #disconnected(reason) {
    await this.#fail(new Error(`Connection ended${reason ? `: ${reason}` : ''}`));
    if (!this.reconnect.enabled || this.reconnectAttempts >= this.reconnect.maxAttempts || this.stopping) return;
    const attempt = ++this.reconnectAttempts; const delay = Math.min(30_000, this.reconnect.delayMs * 2 ** (attempt - 1));
    this.logger?.warn('bot.runtime.reconnecting', { botId: this.bot.id, attempt, delay });
    clearTimeout(this.reconnectTimer); this.reconnectTimer = setTimeout(async () => {
      try { if (this.machine.can('RETRY')) await this.machine.transition('RETRY'); else if (this.machine.can('START')) await this.machine.transition('START'); this.bot.status = this.machine.state; await this.adapter.connect(this.options); }
      catch (error) { await this.#fail(error); }
    }, delay);
  }
  async start(options) { this.stopping = false; this.options = options; await this.machine.transition('START'); this.bot.status = this.machine.state; try { await this.adapter.connect(options); } catch (error) { await this.#fail(error); throw error; } }
  async stop() { this.stopping = true; clearTimeout(this.reconnectTimer); if (this.machine.can('STOP')) await this.machine.transition('STOP'); try { await this.adapter.disconnect(); } catch (error) { await this.#fail(error); throw error; } if (this.machine.can('STOPPED')) await this.machine.transition('STOPPED'); this.bot.status = this.machine.state; }
  snapshot() { return { ...this.bot.toDTO(), status: this.machine.state, runtime: this.adapter.snapshot() }; }
}
