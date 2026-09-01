const HELP = 'commands: help <owner>, add helper <bot...>, stop help, helpers, help status, status, come, follow [player], goto <x> <y> <z>, collect, craft, smelt, shear, milk, sleep, survey [radius], register_chest, store, retrieve, stock, farm, deforest, reforest, guard, combat, meat, remember, place, natural language, inventory, stop';

export class ChatCommandController {
  constructor({ goalService, executor, capabilities, coordinator, helpCommands, navigation, config, logger }) {
    this.goals = goalService; this.executor = executor; this.capabilities = capabilities; this.coordinator = coordinator; this.helpCommands = helpCommands; this.navigation = navigation; this.config = config; this.logger = logger;
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
      if (command === 'help' && args[0] === 'status') return this.#reply(runtime, await this.helpCommands.status({ botId: runtime.bot.id }));
      if (command === 'help' && args[0]) { await this.helpCommands.requestHelp({ helperBotId: runtime.bot.id, ownerBotId: args[0] }); return this.#reply(runtime, await this.helpCommands.helpers({ ownerBotId: args[0] })); }
      if (command === 'help') return this.#reply(runtime, `use !${alias} <command>, !${className || 'class'} <command>, or !global <command>. ${HELP}`);
      if (command === 'add' && args[0] === 'helper') { await this.helpCommands.addHelpers({ ownerBotId: runtime.bot.id, helperBotIds: args.slice(1) }); return this.#reply(runtime, await this.helpCommands.helpers({ ownerBotId: runtime.bot.id })); }
      if (command === 'remove' && args[0] === 'helper') { await this.helpCommands.removeHelper({ ownerBotId: runtime.bot.id, helperBotId: args[1] }); return this.#reply(runtime, await this.helpCommands.helpers({ ownerBotId: runtime.bot.id })); }
      if (command === 'stop' && args[0] === 'help') { await this.helpCommands.stopHelping({ botId: runtime.bot.id }); return this.#reply(runtime, 'help stopped'); }
      if (command === 'pause' && args[0] === 'help') { await this.helpCommands.pause({ botId: runtime.bot.id }); return this.#reply(runtime, 'help paused'); }
      if (command === 'resume' && args[0] === 'help') { await this.helpCommands.resume({ botId: runtime.bot.id }); return this.#reply(runtime, 'help resumed'); }
      if (command === 'helpers') return this.#reply(runtime, await this.helpCommands.helpers({ ownerBotId: runtime.bot.id }));
      if (command === 'goto') { const result = await this.navigation.moveTo({ botId: runtime.bot.id, target: { type: 'POSITION', x: Number(args[0]), y: Number(args[1]), z: Number(args[2]) }, mode: 'SAFE', tolerance: 2, timeout: 120_000, source: 'CHAT_COMMAND' }); return this.#reply(runtime, `arrived in ${result.durationMs}ms`); }
      if (command === 'come') { const result = await this.navigation.moveTo({ botId: runtime.bot.id, target: { type: 'PLAYER', username }, mode: 'FAST', tolerance: 2, timeout: 120_000, source: 'CHAT_COMMAND' }); return this.#reply(runtime, `arrived near ${username} in ${result.durationMs}ms`); }
      if (['ai', 'collect', 'craft', 'smelt', 'cook', 'masak', 'lebur', 'survey', 'scan', 'jelajah', 'register_chest', 'daftar_chest', 'store', 'simpan', 'retrieve', 'withdraw', 'ambil_chest', 'stock', 'stok', 'farm', 'farming', 'deforest', 'reforest', 'guard', 'combat', 'meat', 'remember', 'place'].includes(command)) {
        const targetSelector = selector === 'global' ? 'global' : selector === className ? `class:${className}` : `bot:${alias}`; const request = command === 'ai' ? args.join(' ') : [command, ...args].join(' ');
        if (!this.coordinator.shouldHandle(runtime.bot.id, targetSelector)) return;
        const result = await this.coordinator.coordinateOnce(`${username}:${message}`, { text: request, selector: targetSelector, actor: username });
        const reply = result.results.find(item => item.status === 'COMPLETED')?.result?.reply; if (reply) return this.#reply(runtime, reply);
        return this.#reply(runtime, `coordinator completed ${result.results.filter(item => item.status === 'COMPLETED').length}/${result.results.length}`);
      }
      if (command === 'status') { const state = runtime.snapshot(); return this.#reply(runtime, `${state.status}, hp=${state.runtime.health}, food=${state.runtime.food}, pos=${formatPosition(state.runtime.position)}`); }
      if (command === 'inventory') { const items = runtime.adapter.snapshot().inventorySummary; return this.#reply(runtime, items.length ? items.map(item => `${item.name}:${item.count}`).join(', ').slice(0, 200) : 'inventory empty'); }
      if (command === 'sethome') { const result = await runtime.adapter.setHome({ name: args[0] ?? 'home' }); return this.#reply(runtime, `home ${result.name} saved`); }
      if (command === 'home') { await runtime.adapter.goHome({ name: args[0] ?? 'home' }); return this.#reply(runtime, 'going home'); }
      if (command === 'stop') { await runtime.adapter.stopActions(); for (const task of this.goals.allTasks().filter(task => task.assignedBot === runtime.bot.id && ['ASSIGNED', 'RUNNING'].includes(task.status))) this.executor.cancel(task.id, `Stopped by ${username}`); return this.#reply(runtime, 'running and queued actions stopped'); }
      let step;
      if (command === 'follow') step = { type: 'follow-player', input: { username: args[0] ?? username, movement: this.navigation.policyForBot(runtime.bot.id) }, requiredCapabilities: ['minecraft.follow-player'], timeout: 120_000 };
      else if (command === 'shear') step = { type: 'shear-nearest', input: {}, requiredCapabilities: ['minecraft.shear-nearest'], timeout: 120_000 };
      else if (command === 'milk') step = { type: 'milk-nearest', input: {}, requiredCapabilities: ['minecraft.milk-nearest'], timeout: 120_000 };
      else if (command === 'sleep') step = { type: 'sleep', input: {}, requiredCapabilities: ['minecraft.sleep'], timeout: 120_000 };
      else {
        const targetSelector = selector === 'global' ? 'global' : selector === className ? `class:${className}` : `bot:${alias}`; if (!this.coordinator.shouldHandle(runtime.bot.id, targetSelector)) return; const result = await this.coordinator.coordinateOnce(`${username}:${message}`, { text: [command, ...args].join(' '), selector: targetSelector, actor: username }); const reply = result.results.find(item => item.status === 'COMPLETED')?.result?.reply; return this.#reply(runtime, reply ?? `coordinator completed ${result.results.filter(item => item.status === 'COMPLETED').length}/${result.results.length}`);
      }
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
