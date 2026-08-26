const HELP = 'commands: status, come, goto <x> <y> <z>, collect <block> [count], sethome [name], home [name], craft <item> [count], ai <request>, inventory, stop';

export class ChatCommandController {
  constructor({ goalService, executor, capabilities, coordinator, config, logger }) {
    this.goals = goalService; this.executor = executor; this.capabilities = capabilities; this.coordinator = coordinator; this.config = config; this.logger = logger;
  }
  attach(runtime) {
    if (!this.config.enabled) return () => {};
    const handler = (username, message) => { void this.#handle(runtime, username, message); };
    runtime.adapter.on('chat', handler); return () => runtime.adapter.off('chat', handler);
  }
  async #reply(runtime, message) { try { await runtime.adapter.chat(`[MineHive] ${message}`); } catch (error) { this.logger.warn('chat.reply.failed', { botId: runtime.bot.id, error: error.message }); } }
  async #handle(runtime, username, message) {
    if (username === runtime.bot.name || !message.startsWith('!')) return;
    const [selectorToken, command = 'help', ...args] = message.trim().split(/\s+/); const selector = selectorToken.slice(1).toLowerCase();
    const alias = String(runtime.bot.metadata.commandAlias ?? runtime.bot.name).toLowerCase(); const className = String(runtime.bot.metadata.className ?? 'worker').toLowerCase();
    if (![alias, className, 'global'].includes(selector)) return;
    if (!this.config.admins.includes(username)) {
      this.logger.warn('chat.command.denied', { botId: runtime.bot.id, username });
      if (!this.config.admins.length) await this.#reply(runtime, 'commands disabled: configure MINEHIVE_ADMINS');
      return;
    }
    try {
      if (command === 'help') return this.#reply(runtime, `use !${alias} <command>, !${className || 'class'} <command>, or !global <command>. ${HELP}`);
      if (command === 'ai' || command === 'collect') {
        const targetSelector = selector === 'global' ? 'global' : selector === className ? `class:${className}` : `bot:${alias}`; const request = command === 'ai' ? args.join(' ') : `collect ${args.join(' ')}`;
        if (!this.coordinator.shouldHandle(runtime.bot.id, targetSelector)) return;
        const result = await this.coordinator.coordinateOnce(`${username}:${message}`, { text: request, selector: targetSelector, actor: username });
        return this.#reply(runtime, `coordinator completed ${result.results.filter(item => item.status === 'COMPLETED').length}/${result.results.length}`);
      }
      if (command === 'status') { const state = runtime.snapshot(); return this.#reply(runtime, `${state.status}, hp=${state.runtime.health}, food=${state.runtime.food}, pos=${formatPosition(state.runtime.position)}`); }
      if (command === 'inventory') { const items = runtime.adapter.snapshot().inventorySummary; return this.#reply(runtime, items.length ? items.map(item => `${item.name}:${item.count}`).join(', ').slice(0, 200) : 'inventory empty'); }
      if (command === 'sethome') { const result = await runtime.adapter.setHome({ name: args[0] ?? 'home' }); return this.#reply(runtime, `home ${result.name} saved`); }
      if (command === 'home') { await runtime.adapter.goHome({ name: args[0] ?? 'home' }); return this.#reply(runtime, 'going home'); }
      if (command === 'craft') { const result = await runtime.adapter.craftItem({ item: args[0], count: Number(args[1] ?? 1) }); return this.#reply(runtime, `crafted ${result.item}`); }
      if (command === 'stop') { await runtime.adapter.stopActions(); for (const task of this.goals.allTasks().filter(task => task.assignedBot === runtime.bot.id && task.status === 'RUNNING')) this.executor.cancel(task.id, `Stopped by ${username}`); return this.#reply(runtime, 'actions stopped'); }
      let step;
      if (command === 'come') step = { type: 'follow-player', input: { username }, requiredCapabilities: ['minecraft.follow-player'], timeout: 120_000 };
      else if (command === 'goto') step = { type: 'navigate', input: { x: Number(args[0]), y: Number(args[1]), z: Number(args[2]) }, requiredCapabilities: ['minecraft.navigation'], timeout: 120_000 };
      else return this.#reply(runtime, `unknown command. ${HELP}`);
      const goal = this.goals.create({ description: `${command} requested by ${username}`, priority: 60, constraints: { preferredBot: runtime.bot.id }, steps: [step] });
      await this.#reply(runtime, `goal ${goal.id.slice(0, 8)} started`);
      const result = await this.goals.run(goal.id);
      await this.#reply(runtime, `goal ${result.status.toLowerCase()}`);
    } catch (error) {
      this.logger.error('chat.command.failed', { botId: runtime.bot.id, username, command, error: error.message }); await this.#reply(runtime, `failed: ${error.message}`);
    }
  }
}

function formatPosition(position) { return position ? `${position.x.toFixed(1)},${position.y.toFixed(1)},${position.z.toFixed(1)}` : 'unknown'; }
