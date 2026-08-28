import { Container } from './container.js';
import { EventBus } from './event-bus.js';
import { Logger } from './logger.js';
import { ComponentRegistry, Registry } from './registry.js';
import { CommandBus, QueryBus } from './bus.js';
import { HealthManager, MetricsManager } from './health.js';
import { BotManager } from '../bots/bot-manager.js';
import { ApiServer } from '../api/server.js';
import { CapabilityRegistry } from '../bots/capabilities.js';
import { DeterministicPlanner } from '../goals/planner.js';
import { FleetScheduler } from '../fleet/scheduler.js';
import { TaskExecutor } from '../tasks/task-executor.js';
import { GoalService } from '../goals/goal-service.js';
import { CheckpointManager } from '../orchestration/checkpoints.js';
import { MINECRAFT_CAPABILITIES, registerMinecraftCapabilities } from '../bots/minecraft-capabilities.js';
import { ChatCommandController } from '../bots/chat-command-controller.js';
import { MineflayerAdapter } from '../plugins/minecraft/mineflayer-adapter.js';
import { JsonRepository } from '../persistence/json-repository.js';
import { MemoryRepository } from '../persistence/memory-repository.js';
import { AdminManager } from '../services/admin-manager.js';
import { BotProfileManager } from '../services/bot-profile-manager.js';
import { resolve, join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { LlmGateway } from '../ai/llm-gateway.js';
import { FleetCoordinator } from '../ai/fleet-coordinator.js';
import { WorldMemoryService } from '../memory/world-memory-service.js';
import { createHashEmbeddingProvider, createSemanticMemory } from '../memory/semantic-memory.js';
import { createAdaptiveModel } from '../ml/adaptive-model.js';
import { createHiveService } from '../hivemind/hive-service.js';
import { createAutonomyService } from '../autonomy/autonomy-service.js';
import { SqliteDatabase } from '../database/sqlite-database.js';
import { RotatingLogStore } from '../observability/rotating-log-store.js';
import { createDiscoveryService } from '../world/discovery-service.js';
import { createStructureObserver } from '../world/structure-observer.js';
import { createLogisticsService } from '../logistics/logistics-service.js';

export class Application {
  constructor(config, overrides = {}) {
    this.config = config; this.state = 'CREATED'; this.startedAt = null;
    this.cameraPorts = new Map();
    this.container = new Container(); this.events = overrides.eventBus ?? new EventBus(); this.logStore = config.profile === 'test' ? null : new RotatingLogStore({ directory: config.log.directory ?? join(resolve(config.dataPath), 'logs'), maxFiles: config.log.maxFiles }); this.logger = overrides.logger ?? new Logger({ ...config.log, store: this.logStore });
    this.modules = new ComponentRegistry('Module'); this.plugins = new ComponentRegistry('Plugin'); this.services = new Registry('Service');
    this.commands = new CommandBus(); this.queries = new QueryBus(); this.health = new HealthManager(); this.metrics = new MetricsManager();
    this.bots = new BotManager({ eventBus: this.events, logger: this.logger, adapterFactory: overrides.adapterFactory ?? (() => new MineflayerAdapter({ autoEat: config.bot.autoEat })), defaultCapabilities: MINECRAFT_CAPABILITIES, reconnect: config.bot.reconnect });
    this.capabilities = new CapabilityRegistry(); this.planner = new DeterministicPlanner();
    this.scheduler = new FleetScheduler({ botManager: this.bots }); this.checkpoints = new CheckpointManager();
    this.executor = new TaskExecutor({ capabilities: this.capabilities, scheduler: this.scheduler, eventBus: this.events, metrics: this.metrics, checkpointRepository: this.checkpoints });
    this.goals = new GoalService({ planner: this.planner, scheduler: this.scheduler, executor: this.executor, eventBus: this.events, metrics: this.metrics });
    this.database = config.profile !== 'test' && config.database.driver === 'sqlite' ? new SqliteDatabase({ file: config.database.file }) : null;
    const repository = name => config.profile === 'test' ? new MemoryRepository() : this.database ? this.database.repository(name) : new JsonRepository(join(resolve(config.dataPath), `${name}.json`));
    this.worldMemory = new WorldMemoryService({ repository: repository('world-memory'), events: this.events, logger: this.logger });
    this.semanticMemory = createSemanticMemory({ repository: repository('semantic-memory'), events: this.events, embeddingProvider: createHashEmbeddingProvider({ dimensions: config.semanticMemory.dimensions, version: '1' }), maxRecords: config.semanticMemory.maxRecords });
    this.discovery = createDiscoveryService({ worldMemory: this.worldMemory, semanticMemory: this.semanticMemory, events: this.events }); this.structureObserver = createStructureObserver({ discovery: this.discovery, logger: this.logger, intervalMs: 15_000, minimumDistance: 16, maxDistance: 64 });
    this.ml = createAdaptiveModel({ outcomeRepository: repository('ml-outcomes'), modelRepository: repository('ml-models'), events: this.events, minimumSamples: config.ml.minimumSamples });
    this.hive = createHiveService({ repositories: { messages: repository('hive-messages'), state: repository('hive-state'), locks: repository('hive-locks'), decisions: repository('hive-decisions') }, events: this.events, ml: this.ml, heartbeatTimeoutMs: config.hive.heartbeatTimeoutMs });
    this.logistics = createLogisticsService({ repositories: { storages: repository('logistics-storages'), reservations: repository('logistics-reservations'), transfers: repository('logistics-transfers') }, hive: this.hive, events: this.events });
    this.llm = new LlmGateway(config.llm ?? { provider: 'none' }, this.logger); this.coordinator = new FleetCoordinator({ gateway: this.llm, bots: this.bots, goals: this.goals, memory: this.worldMemory, semanticMemory: this.semanticMemory, discovery: this.discovery, logistics: this.logistics, ml: this.ml, hive: this.hive, events: this.events, logger: this.logger });
    this.autonomy = createAutonomyService({ repository: repository('autonomy-objectives'), coordinator: this.coordinator, hive: this.hive, bots: this.bots, health: this.health, events: this.events, logger: this.logger, enabled: config.autonomy.enabled, intervalMs: config.autonomy.intervalMs, maxActionsPerHour: config.autonomy.maxActionsPerHour });
    registerMinecraftCapabilities(this.capabilities, this.bots);
    this.admins = new AdminManager({ repository: repository('admins'), bootstrap: [...(config.commands?.admins ?? [])], target: config.commands?.admins ?? [] });
    this.botProfiles = new BotProfileManager({ repository: repository('bots'), botManager: this.bots });
    this.chatCommands = new ChatCommandController({ goalService: this.goals, executor: this.executor, capabilities: this.capabilities, coordinator: this.coordinator, config: config.commands ?? { enabled: false, admins: [] }, logger: this.logger });
    this.bots.onCreated(runtime => { this.chatCommands.attach(runtime); this.structureObserver.attach(runtime); });
    this.api = new ApiServer({ application: this, ...config.api, logger: this.logger });
    Object.entries({ config, logger: this.logger, logStore: this.logStore, eventBus: this.events, health: this.health, metrics: this.metrics, database: this.database, bots: this.bots, capabilities: this.capabilities, goals: this.goals, scheduler: this.scheduler, checkpoints: this.checkpoints, admins: this.admins, botProfiles: this.botProfiles, worldMemory: this.worldMemory, semanticMemory: this.semanticMemory, discovery: this.discovery, structureObserver: this.structureObserver, logistics: this.logistics, ml: this.ml, hive: this.hive, autonomy: this.autonomy, llm: this.llm, coordinator: this.coordinator }).filter(([, value]) => value !== null).forEach(([name, value]) => this.container.register(name, value));
    this.health.register('application', async () => ({ status: ['READY', 'RUNNING'].includes(this.state) ? 'HEALTHY' : 'DEGRADED' }), { critical: true });
    this.health.register('bots', async () => ({ status: this.bots.list().some(bot => ['FAILED', 'DEGRADED'].includes(bot.status)) ? 'DEGRADED' : 'HEALTHY' }));
    this.health.register('database', async () => this.database?.health() ?? { status: 'HEALTHY', driver: config.profile === 'test' ? 'memory' : 'json' }, { critical: true });
    this.health.register('memory', async () => this.semanticMemory.status());
    this.health.register('ml', async () => this.ml.status());
    this.health.register('hivemind', async () => this.hive.status());
    this.health.register('structureObserver', async () => this.structureObserver.status());
    this.health.register('logistics', async () => this.logistics.status());
  }

  context() { return Object.freeze({ container: this.container, events: this.events, logger: this.logger, config: this.config }); }
  async initialize() {
    if (this.state !== 'CREATED') return;
    this.state = 'BOOTSTRAPPING'; this.logger.info('application.bootstrapping'); this.state = 'INITIALIZING';
    await this.admins.initialize(); this.restoredProfiles = await this.botProfiles.initialize();
    await this.modules.run('initialize', this.context()); await this.plugins.run('initialize', this.context()); this.state = 'READY';
    await this.events.publish('application.ready', {}, { source: 'application' });
  }
  async start({ api = true } = {}) {
    await this.initialize(); if (this.state === 'RUNNING') return;
    await this.modules.run('start', this.context()); await this.plugins.run('start', this.context());
    if (api) await this.api.start(); this.state = 'RUNNING'; this.startedAt = Date.now(); this.autonomy.start();
    for (const profile of this.restoredProfiles.filter(item => item.autoConnect)) await this.bots.start(profile.id).catch(error => this.logger.error('bot.autostart.failed', { botId: profile.id, error: error.message }));
    if (this.config.bot.autoConnect && !this.bots.list().length) { const bot = await this.botProfiles.create({ name: this.config.bot.username, ...this.config.bot, autoConnect: true }); await this.bots.start(bot.id); }
    this.hive.syncMembers(this.bots.list()); await this.events.publish('application.started', this.status(), { source: 'application' }); this.logger.info('application.started', this.status());
  }
  async stop() {
    if (['STOPPED', 'CREATED'].includes(this.state)) { this.state = 'STOPPED'; await this.logStore?.flush(); return; }
    this.state = 'SHUTTING_DOWN'; this.autonomy.stop(); this.structureObserver.stop(); await this.api.stop(); await this.goals.stop(); await this.bots.stopAll();
    await this.plugins.run('stop', this.context(), { reverse: true }); await this.modules.run('stop', this.context(), { reverse: true });
    this.state = 'STOPPED'; await this.events.publish('application.stopped', {}, { source: 'application' }); this.events.clear(); this.database?.close(); this.logger.info('application.stopped'); await this.logStore?.flush();
  }
  async startCamera(botId) {
    const runtime = this.bots.get(botId); let port = this.cameraPorts.get(botId);
    if (!port) { port = this.config.viewer?.basePort ?? 3100; const used = new Set(this.cameraPorts.values()); while (used.has(port) || !await portAvailable(port)) port++; this.cameraPorts.set(botId, port); }
    const result = await runtime.adapter.startViewer({ port, firstPerson: true, viewDistance: this.config.viewer?.viewDistance ?? 6 }); return { ...result, botId };
  }
  async stopCamera(botId) { const result = await this.bots.get(botId).adapter.stopViewer(); this.cameraPorts.delete(botId); return { ...result, botId }; }
  status() { return { name: 'MineHive', version: '0.6.0', state: this.state, uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0, bots: this.bots.list(), goals: this.goals.list(), modules: this.modules.status(), plugins: this.plugins.status(), autonomy: this.autonomy.status() }; }
}

function portAvailable(port) {
  return new Promise(resolvePort => {
    const server = createNetServer(); server.unref(); server.once('error', () => resolvePort(false));
    server.listen(port, '0.0.0.0', () => server.close(() => resolvePort(true)));
  });
}
