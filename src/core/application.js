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
import { COLLABORATIVE_TAKEOVER_PREFIX, GoalService } from '../goals/goal-service.js';
import { CheckpointManager } from '../orchestration/checkpoints.js';
import { ValidationError } from './errors.js';
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
import { createMemoryLifecycle } from '../memory/memory-lifecycle.js';
import { createAdaptiveModel } from '../ml/adaptive-model.js';
import { createHiveService } from '../hivemind/hive-service.js';
import { createAutonomyService } from '../autonomy/autonomy-service.js';
import { SqliteDatabase } from '../database/sqlite-database.js';
import { RotatingLogStore } from '../observability/rotating-log-store.js';
import { createDiscoveryService } from '../world/discovery-service.js';
import { createStructureObserver } from '../world/structure-observer.js';
import { createLogisticsService } from '../logistics/logistics-service.js';
import { createAcquisitionService } from '../logistics/acquisition/acquisition-service.js';
import { createRecoveryJobService } from '../logistics/recovery/index.js';
import { calculateRecoveryCost, createDeathManifest, evaluateRecoveryItems, mergeDeathInventory, selectRecoveryBot, verifyRecovery } from '../logistics/recovery/index.js';
import { randomUUID } from 'node:crypto';
import { createFleetTransferService } from '../logistics/fleet-transfer-service.js';
import { createCoordinationMonitor, createHelpCommandService, createHelpService } from '../help/index.js';
import { createSurvivalService } from '../survival/index.js';
import { createTaskReporter } from '../tasks/task-reporter.js';
import { createNavigationService, createNavigationSettingsService, createResourceReservationService, createResourceReservationCoordinator } from '../navigation/index.js';

export class Application {
  constructor(config, overrides = {}) {
    this.config = config; this.state = 'CREATED'; this.startedAt = null;
    this.runtimeDefaults = structuredClone({ llm: config.llm ?? { provider: 'none' }, logLevel: config.log.level, autonomy: config.autonomy, acquisition: config.acquisition, recovery: config.recovery, survival: config.survival ?? defaultSurvivalSettings(), memory: defaultMemorySettings(config.semanticMemory) });
    this.cameraPorts = new Map();
    this.container = new Container(); this.events = overrides.eventBus ?? new EventBus(); this.logStore = config.profile === 'test' ? null : new RotatingLogStore({ directory: config.log.directory ?? join(resolve(config.dataPath), 'logs'), maxFiles: config.log.maxFiles }); this.logger = overrides.logger ?? new Logger({ ...config.log, store: this.logStore });
    this.modules = new ComponentRegistry('Module'); this.plugins = new ComponentRegistry('Plugin'); this.services = new Registry('Service');
    this.commands = new CommandBus(); this.queries = new QueryBus(); this.health = new HealthManager(); this.metrics = new MetricsManager();
    this.bots = new BotManager({ eventBus: this.events, logger: this.logger, adapterFactory: overrides.adapterFactory ?? (() => new MineflayerAdapter({ autoEat: config.bot.autoEat })), defaultCapabilities: MINECRAFT_CAPABILITIES, reconnect: config.bot.reconnect });
    this.capabilities = new CapabilityRegistry(); this.planner = new DeterministicPlanner();
    this.scheduler = new FleetScheduler({ botManager: this.bots }); this.checkpoints = new CheckpointManager(); this.resourceReservations = createResourceReservationService();
    this.executor = new TaskExecutor({ capabilities: this.capabilities, scheduler: this.scheduler, eventBus: this.events, metrics: this.metrics, checkpointRepository: this.checkpoints, maxQueuePerBot: config.tasks?.maxQueuePerBot ?? 100, bots: this.bots, resourceReservations: this.resourceReservations });
    this.goals = new GoalService({ planner: this.planner, scheduler: this.scheduler, executor: this.executor, eventBus: this.events, metrics: this.metrics });
    this.database = config.profile !== 'test' && config.database.driver === 'sqlite' ? new SqliteDatabase({ file: config.database.file }) : null;
    this._repositoryFactory = name => config.profile === 'test' ? new MemoryRepository() : this.database ? this.database.repository(name) : new JsonRepository(join(resolve(config.dataPath), `${name}.json`));
    const repository = name => this._repositoryFactory(name);
    this.navigationSettings = createNavigationSettingsService({ repository: repository('navigation-settings') });
    this.worldMemory = new WorldMemoryService({ repository: repository('world-memory'), events: this.events, logger: this.logger });
    this.semanticMemory = createSemanticMemory({ repository: repository('semantic-memory'), events: this.events, embeddingProvider: createHashEmbeddingProvider({ dimensions: config.semanticMemory.dimensions, version: '1' }), maxRecords: config.semanticMemory.maxRecords, shortTermMaxRecords: config.semanticMemory.shortTermMaxRecords, shortTermTtlMs: config.semanticMemory.shortTermTtlMs, promotionAccesses: config.semanticMemory.promotionAccesses, promotionImportance: config.semanticMemory.promotionImportance });
    this.memoryLifecycle = createMemoryLifecycle({ memory: this.semanticMemory, logger: this.logger, intervalMs: config.semanticMemory.consolidationIntervalMs ?? 60_000 });
    this.discovery = createDiscoveryService({ worldMemory: this.worldMemory, semanticMemory: this.semanticMemory, events: this.events }); this.structureObserver = createStructureObserver({ discovery: this.discovery, logger: this.logger, intervalMs: 15_000, minimumDistance: 16, maxDistance: 64 });
    this.ml = createAdaptiveModel({ outcomeRepository: repository('ml-outcomes'), modelRepository: repository('ml-models'), events: this.events, minimumSamples: config.ml.minimumSamples });
    this.hive = createHiveService({ repositories: { messages: repository('hive-messages'), state: repository('hive-state'), locks: repository('hive-locks'), decisions: repository('hive-decisions') }, events: this.events, ml: this.ml, heartbeatTimeoutMs: config.hive.heartbeatTimeoutMs });
    this.logistics = createLogisticsService({ repositories: { storages: repository('logistics-storages'), reservations: repository('logistics-reservations'), transfers: repository('logistics-transfers') }, hive: this.hive, events: this.events, resourceReservations: this.resourceReservations });
    this.fleetTransfer = createFleetTransferService({ events: this.events });
    this.acquisition = createAcquisitionService({ bots: this.bots, logistics: this.logistics, events: this.events, logger: this.logger, repository: repository('acquisition-requests'), fleetTransfer: this.fleetTransfer, config: config.acquisition ?? { enabled: true, maxDepth: 8, maxSubtasks: 32, maxAttempts: 3, maxDistance: 2000, storageFirst: true, allowFleet: true, allowCraft: true, allowSmelt: true, allowCollect: true, allowPartial: false, toolPreservation: true } });
    this.help = createHelpService({ repository: repository('help-sessions'), workShareRepository: repository('help-work-shares'), contributionRepository: repository('help-contributions'), bots: this.bots, fleetTransfer: this.fleetTransfer, logistics: this.logistics, goals: this.goals, executor: this.executor, events: this.events, metrics: this.metrics, maxHelpersPerSession: 4, minimumChunk: 4, coordination: { minRebalanceIntervalMs: 5000, minimumTransferUnits: 4, minimumBenefitRatio: 0.15, maxRebalancesPerSession: 20, progressStallThresholdMs: 30000 } });
    this.helpCommands = createHelpCommandService({ help: this.help, goals: this.goals, bots: this.bots, events: this.events, maxHelpersPerSession: 4, minimumChunk: 4 });
    this.coordination = createCoordinationMonitor({ help: this.help, events: this.events, intervalMs: 5000 });
    this.recovery = createRecoveryJobService({ repository: repository('recovery-jobs'), events: this.events, bots: this.bots, resourceReservations: this.resourceReservations, config: config.recovery ?? { enabled: true, maxAttempts: 3, minScore: 40, optionalScore: 20, urgentScore: 70, despawnTicks: 6000, safetyMarginTicks: 600, maxDistance: 2000, dangerLimit: 0.75 } });
    this.survival = createSurvivalService({ acquisition: this.acquisition, events: this.events, logger: this.logger, config: config.survival ?? defaultSurvivalSettings() });
    this.llm = new LlmGateway(config.llm ?? { provider: 'none' }, this.logger); this.coordinator = new FleetCoordinator({ gateway: this.llm, bots: this.bots, goals: this.goals, memory: this.worldMemory, semanticMemory: this.semanticMemory, discovery: this.discovery, logistics: this.logistics, acquisition: this.acquisition, ml: this.ml, hive: this.hive, events: this.events, logger: this.logger, maxQueuePerBot: config.tasks?.maxQueuePerBot ?? 100, navigationSettings: this.navigationSettings });
    this.acquisition.configureTaskRunner(async ({ runtime, capability, input, resources }) => { const goal = this.goals.create({ description: `Acquisition ${capability} for ${runtime.id}`, priority: input.priority ?? 70, constraints: { preferredBot: runtime.id }, steps: [{ type: 'acquisition', input, resources, requiredCapabilities: [capability], timeout: 300_000, retries: 1, reportLifecycle: false }] }); await this.goals.run(goal.id); const task = this.goals.tasks(goal.id)[0]; if (task.status !== 'COMPLETED') throw new ValidationError(task.error?.message ?? `Acquisition task '${capability}' failed`); return task.result; });
    this.autonomy = createAutonomyService({ repository: repository('autonomy-objectives'), coordinator: this.coordinator, hive: this.hive, bots: this.bots, health: this.health, events: this.events, logger: this.logger, enabled: config.autonomy.enabled, intervalMs: config.autonomy.intervalMs, maxActionsPerHour: config.autonomy.maxActionsPerHour });
    registerMinecraftCapabilities(this.capabilities, this.bots, this.survival);
    this.resourceReservationCoordinator = createResourceReservationCoordinator({ events: this.events, bots: this.bots, reservations: this.resourceReservations }); this.navigation = createNavigationService({ bots: this.bots, capabilities: this.capabilities, events: this.events, metrics: this.metrics, reservations: this.resourceReservations, settings: this.navigationSettings });
    this.admins = new AdminManager({ repository: repository('admins'), bootstrap: [...(config.commands?.admins ?? [])], target: config.commands?.admins ?? [] });
    this.botProfiles = new BotProfileManager({ repository: repository('bots'), botManager: this.bots });
    this.chatCommands = new ChatCommandController({ goalService: this.goals, executor: this.executor, capabilities: this.capabilities, coordinator: this.coordinator, helpCommands: this.helpCommands, navigation: this.navigation, config: config.commands ?? { enabled: false, admins: [] }, logger: this.logger });
    this.taskReporter = createTaskReporter({ events: this.events, bots: this.bots, logger: this.logger });
    this.events.subscribe('bot.death', async event => { const affected = await this.acquisition.handleBotDeath(event.payload.botId); const helpSessions = await this.help.handleBotDeath(event.payload.botId); if (affected.length) await this.events.publish('acquisition.recovery.required', { botId: event.payload.botId, requestIds: affected.map(request => request.id) }, { source: 'acquisition', correlationId: event.payload.botId }); if (helpSessions.length) await this.events.publish('help.recovery.required', { botId: event.payload.botId, sessionIds: helpSessions.map(session => session.id) }, { source: 'help', correlationId: event.payload.botId }); try { await runDeathRecovery(this, event.payload); } catch (error) { this.logger.error('death-recovery.failed', { botId: event.payload.botId, error: error.message }); await this.events.publish('logistics.recovery.failed', { botId: event.payload.botId, error: { code: error.code ?? 'DEATH_RECOVERY_FAILED', message: error.message } }, { source: 'death-recovery', correlationId: event.payload.botId }); } });
    this.events.subscribe('task.cancelled', async event => { const reason = event.payload.error?.message ?? 'Parent task cancelled'; if (reason.startsWith(COLLABORATIVE_TAKEOVER_PREFIX)) return; await this.help.cancelForParent(event.payload.id, reason); });
    this.bots.onCreated(runtime => { this.chatCommands.attach(runtime); this.structureObserver.attach(runtime); this.survival.attach(runtime); });
    this.api = new ApiServer({ application: this, ...config.api, logger: this.logger });
    Object.entries({ config, logger: this.logger, logStore: this.logStore, eventBus: this.events, health: this.health, metrics: this.metrics, database: this.database, bots: this.bots, capabilities: this.capabilities, goals: this.goals, scheduler: this.scheduler, checkpoints: this.checkpoints, admins: this.admins, botProfiles: this.botProfiles, worldMemory: this.worldMemory, semanticMemory: this.semanticMemory, memoryLifecycle: this.memoryLifecycle, discovery: this.discovery, structureObserver: this.structureObserver, logistics: this.logistics, fleetTransfer: this.fleetTransfer, acquisition: this.acquisition, help: this.help, helpCommands: this.helpCommands, coordination: this.coordination, navigation: this.navigation, resourceReservations: this.resourceReservations, resourceReservationCoordinator: this.resourceReservationCoordinator, recovery: this.recovery, survival: this.survival, ml: this.ml, hive: this.hive, autonomy: this.autonomy, llm: this.llm, coordinator: this.coordinator, taskReporter: this.taskReporter }).filter(([, value]) => value !== null).forEach(([name, value]) => this.container.register(name, value));
    this.health.register('application', async () => ({ status: ['READY', 'RUNNING'].includes(this.state) ? 'HEALTHY' : 'DEGRADED' }), { critical: true });
    this.health.register('bots', async () => ({ status: this.bots.list().some(bot => ['FAILED', 'DEGRADED'].includes(bot.status)) ? 'DEGRADED' : 'HEALTHY' }));
    this.health.register('database', async () => this.database?.health() ?? { status: 'HEALTHY', driver: config.profile === 'test' ? 'memory' : 'json' }, { critical: true });
    this.health.register('memory', async () => this.semanticMemory.status());
    this.health.register('memoryLifecycle', async () => this.memoryLifecycle.status());
    this.health.register('ml', async () => this.ml.status());
    this.health.register('hivemind', async () => this.hive.status());
    this.health.register('structureObserver', async () => this.structureObserver.status());
    this.health.register('logistics', async () => this.logistics.status());
    this.health.register('acquisition', async () => { const status = this.acquisition.status(); return { status: status.enabled ? 'HEALTHY' : 'DISABLED', activeRequests: status.activeRequests, maxDepth: status.maxDepth, maxSubtasks: status.maxSubtasks }; });
    this.health.register('recovery', async () => { const jobs = await this.recovery.list({ statuses: ['PENDING', 'EVALUATING', 'ASSIGNED', 'TRAVELLING', 'SEARCHING', 'COLLECTING', 'VERIFYING', 'REASSIGN_REQUIRED'] }); return { status: jobs.length ? 'DEGRADED' : 'HEALTHY', activeJobs: jobs.length, jobs }; });
    this.health.register('survival', async () => this.survival.status());
    this.health.register('help', async () => this.help.status());
    this.health.register('coordination', async () => this.coordination.status());
    this.health.register('navigation', async () => { const status = this.navigation.status(); return { status: 'HEALTHY', activeSessions: status.active, failedRecent: status.recent.filter(session => session.status === 'FAILED').length }; });
    this.health.register('taskQueue', async () => { const tasks = this.executor.status(); const coordinator = this.coordinator.status(); const saturation = Math.max(tasks.saturation, coordinator.saturation); return { status: saturation >= 0.8 ? 'DEGRADED' : 'HEALTHY', saturation, tasks, coordinator: { queuedOperations: coordinator.queuedOperations, maximumDepth: coordinator.maximumDepth, maxQueuePerBot: coordinator.maxQueuePerBot } }; });
  }

  context() { return Object.freeze({ container: this.container, events: this.events, logger: this.logger, config: this.config }); }
  async initialize() {
    if (this.state !== 'CREATED') return;
    this.state = 'BOOTSTRAPPING'; this.logger.info('application.bootstrapping'); this.state = 'INITIALIZING';
    await this.admins.initialize(); this.restoredProfiles = await this.botProfiles.initialize(); await this.navigationSettings.initialize(); await this.acquisition.initialize(); await this.help.initialize();
    await this.modules.run('initialize', this.context()); await this.plugins.run('initialize', this.context()); this.state = 'READY';
    await this.events.publish('application.ready', {}, { source: 'application' });
  }
  async start({ api = true } = {}) {
    await this.initialize(); if (this.state === 'RUNNING') return;
    await this.modules.run('start', this.context()); await this.plugins.run('start', this.context());
    if (api) await this.api.start(); this.state = 'RUNNING'; this.startedAt = Date.now(); await this.memoryLifecycle.tick(); this.memoryLifecycle.start(); this.autonomy.start(); this.coordination.start();
    try {
      for (const profile of this.restoredProfiles.filter(item => item.autoConnect)) await this.bots.start(profile.id).catch(error => this.logger.error('bot.autostart.failed', { botId: profile.id, error: error.message }));
      if (this.config.bot.autoConnect && !this.bots.list().length) { const bot = await this.botProfiles.create({ name: this.config.bot.username, ...this.config.bot, autoConnect: true }); await this.bots.start(bot.id); }
    } catch (error) {
      this.autonomy.stop(); this.memoryLifecycle.stop(); this.coordination.stop(); await this.api.stop(); this.startedAt = null; this.state = 'READY'; throw error;
    }
    this.hive.syncMembers(this.bots.list()); await this.events.publish('application.started', this.status(), { source: 'application' }); this.logger.info('application.started', this.status());
  }
  async stop() {
    if (['STOPPED', 'CREATED'].includes(this.state)) { this.state = 'STOPPED'; await this.logStore?.flush(); return; }
    this.state = 'SHUTTING_DOWN'; this.autonomy.stop(); this.memoryLifecycle.stop(); this.coordination.dispose(); this.structureObserver.stop(); this.survival.stop(); this.taskReporter.stop(); await this.navigation.stop(); await this.api.stop(); await this.goals.stop(); await this.bots.stopAll();
    await this.plugins.run('stop', this.context(), { reverse: true }); await this.modules.run('stop', this.context(), { reverse: true });
    this.state = 'STOPPED'; await this.events.publish('application.stopped', {}, { source: 'application' }); this.events.clear(); this.database?.close(); this.logger.info('application.stopped'); await this.logStore?.flush();
  }
  async startCamera(botId, mode) {
    const runtime = this.bots.get(botId); const viewMode = mode ?? 'surrounding'; if (!['first_person', 'surrounding'].includes(viewMode)) throw new ValidationError("Viewer mode must be 'first_person' or 'surrounding'"); const current = runtime.adapter.snapshot().camera; if (current.active && current.mode !== viewMode) await runtime.adapter.stopViewer(); let port = this.cameraPorts.get(botId);
    if (!port) { port = this.config.viewer?.basePort ?? 3100; const used = new Set(this.cameraPorts.values()); while (used.has(port) || !await portAvailable(port)) port++; this.cameraPorts.set(botId, port); }
    const result = await runtime.adapter.startViewer({ port, firstPerson: viewMode === 'first_person', viewDistance: this.config.viewer?.viewDistance ?? 6, mode: viewMode }); return { ...result, mode: viewMode, botId };
  }
  async stopCamera(botId) { const result = await this.bots.get(botId).adapter.stopViewer(); this.cameraPorts.delete(botId); return { ...result, botId }; }
  async memorySettings() { const semantic = await this.semanticMemory.status(); return { maxRecords: semantic.maxRecords, ...semantic.policy, consolidationIntervalMs: this.memoryLifecycle.status().intervalMs, embedding: semantic.embedding }; }
  async configureMemory(input) {
    const consolidationIntervalMs = Number(input?.consolidationIntervalMs); if (!Number.isInteger(consolidationIntervalMs) || consolidationIntervalMs < 5000) throw new ValidationError('Memory consolidation interval must be an integer of at least 5000ms');
    const semantic = await this.semanticMemory.configure(input); const lifecycle = this.memoryLifecycle.configure({ intervalMs: consolidationIntervalMs }); const settings = await this.memorySettings(); this.logger.info('memory.settings.configured', { maxRecords: settings.maxRecords, shortTermMaxRecords: settings.shortTermMaxRecords, shortTermTtlMs: settings.shortTermTtlMs, promotionAccesses: settings.promotionAccesses, promotionImportance: settings.promotionImportance, consolidationIntervalMs: settings.consolidationIntervalMs }); return { settings, semantic, lifecycle };
  }
  async resetRuntimeSettings() { const defaults = this.runtimeDefaults.llm; const openRouterKeys = [...new Set(defaults.openRouterApiKeys ?? [])]; const nvidiaKeys = [...new Set(defaults.nvidiaApiKeys ?? [])]; const llm = this.llm.configure({ provider: defaults.provider ?? 'none', openRouterEndpoint: defaults.openRouterEndpoint ?? 'https://openrouter.ai/api/v1', openRouterModel: defaults.openRouterModel ?? 'openrouter/auto', nvidiaEndpoint: defaults.nvidiaEndpoint ?? 'https://integrate.api.nvidia.com/v1', nvidiaModel: defaults.nvidiaModel ?? 'meta/llama-3.1-8b-instruct', ...(openRouterKeys.length ? { openRouterApiKeys: openRouterKeys } : { clearOpenRouterKeys: true }), ...(nvidiaKeys.length ? { nvidiaApiKeys: nvidiaKeys } : { clearNvidiaKeys: true }) }); const log = this.logger.setLevel(this.runtimeDefaults.logLevel); const autonomy = this.autonomy.configure({ enabled: this.runtimeDefaults.autonomy.enabled, intervalMs: this.runtimeDefaults.autonomy.intervalMs, maxActionsPerHour: this.runtimeDefaults.autonomy.maxActionsPerHour }); const acquisition = await this.configureAcquisition(this.runtimeDefaults.acquisition); const recovery = await this.configureRecovery(this.runtimeDefaults.recovery); const survival = this.configureSurvival(this.runtimeDefaults.survival); const memory = await this.configureMemory(this.runtimeDefaults.memory); this.logger.info('settings.runtime.reset', { provider: llm.provider, logLevel: log.level, autonomy: autonomy.status, acquisition, recovery, survival, memory: memory.settings }); return { llm, log, autonomy, acquisition, recovery, survival, memory, preserved: ['bot profiles', 'admins', 'memory records', 'database', 'API token'] }; }
  async configureAcquisition(input) {
    const next = this.acquisition?.settings ? this.acquisition.settings() : (this.config.acquisition ?? { enabled: true, maxDepth: 8, maxSubtasks: 32, maxAttempts: 3, maxDistance: 2000, storageFirst: true, allowFleet: true, allowCraft: true, allowSmelt: true, allowCollect: true, allowPartial: false, toolPreservation: true });
    const merged = { ...next, ...(input ?? {}) };
    if (!this.acquisition) {
      this.acquisition = createAcquisitionService({ bots: this.bots, logistics: this.logistics, events: this.events, logger: this.logger, config: merged });
      this.container.register('acquisition', this.acquisition, { replace: true });
      if (this.coordinator) this.coordinator.acquisition = this.acquisition;
      this.config.acquisition = this.acquisition.settings();
      return this.config.acquisition;
    }
    const normalized = this.acquisition.configure(merged);
    this.config.acquisition = normalized;
    if (this.coordinator) this.coordinator.acquisition = this.acquisition;
    this.container.register('acquisition', this.acquisition, { replace: true });
    return normalized;
  }
  async configureRecovery(input) {
    const next = this.recovery.settings ? this.recovery.settings() : this.config.recovery;
    const normalized = createRecoveryJobService({ repository: this._repositoryFactory('recovery-jobs'), events: this.events, config: input ?? next }).settings();
    this.config.recovery = normalized;
    this.recovery = createRecoveryJobService({ repository: this._repositoryFactory('recovery-jobs'), events: this.events, bots: this.bots, resourceReservations: this.resourceReservations, config: normalized });
    this.container.register('recovery', this.recovery, { replace: true });
    return normalized;
  }
  configureSurvival(input) { return this.survival.configure(input); }
  status() { return { name: 'MineHive', version: '0.7.4', phase: 'Stuck Recovery & Safe Scaffolding Phase 2', state: this.state, uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0, bots: this.bots.list(), goals: this.goals.list(), modules: this.modules.status(), plugins: this.plugins.status(), navigation: this.navigation.status(), autonomy: this.autonomy.status(), acquisition: this.acquisition.status(), survival: this.survival.status() }; }
}

function portAvailable(port) {
  return new Promise(resolvePort => {
    const server = createNetServer(); server.unref(); server.once('error', () => resolvePort(false));
    server.listen(port, '0.0.0.0', () => server.close(() => resolvePort(true)));
  });
}

function defaultMemorySettings(config) {
  const maxRecords = config.maxRecords; return { maxRecords, shortTermMaxRecords: config.shortTermMaxRecords ?? Math.min(1000, maxRecords), shortTermTtlMs: config.shortTermTtlMs ?? 86_400_000, promotionAccesses: config.promotionAccesses ?? 3, promotionImportance: config.promotionImportance ?? 0.8, consolidationIntervalMs: config.consolidationIntervalMs ?? 60_000 };
}

function defaultSurvivalSettings() { return { enabled: true, autoEquipArmor: true, minimumDurabilityPercent: 10, preferProtection: true, preferDurability: false, allowBindingCurse: false, allowAnimalKill: false, minimumSheepReserve: 2, minimumCowReserve: 2, interactionCooldownMs: 500, entitySearchDistance: 48 }; }

async function runDeathRecovery(application, death) {
  const dead = application.bots.get(death.botId); const settings = application.recovery.settings(); const position = death.position;
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) throw new ValidationError(`Death recovery requires a valid death position for '${death.botId}'`);
  const worldKey = serverKey(dead.options); const transfer = await application.logistics.deathContext({ botId: death.botId });
  const items = mergeDeathInventory({ lastKnownInventory: death.inventory ?? [], eventInventory: death.inventory ?? [], transferItems: transfer.cargo ?? [] });
  const manifest = createDeathManifest({ botId: death.botId, worldKey, dimension: String(death.dimension ?? dead.adapter.snapshot().dimension ?? 'overworld'), position, items, relatedTransferId: transfer.relatedTransferId, cause: death.cause ?? 'unknown', keepInventory: death.keepInventory ?? 'UNKNOWN' }, { id: randomUUID(), createdAt: death.detectedAt ?? new Date().toISOString() });
  await application.logistics.markDeathRecovery({ botId: death.botId, manifestId: manifest.id });
  await application.events.publish('logistics.recovery.death.recorded', manifest, { source: 'death-recovery', correlationId: manifest.id });
  const selection = selectRecoveryBot({ candidates: recoveryCandidates(application, manifest), death: { deadBotId: manifest.botId, worldKey: manifest.worldKey, dimension: manifest.dimension, position: manifest.position, danger: 0 }, requiredSlots: requiredSlots(items), config: settings });
  const cost = calculateRecoveryCost({ distance: selection.selected?.distance ?? settings.maxDistance, danger: 0, workload: 0, risk: 0, remainingDespawnTicks: settings.despawnTicks }, settings);
  const evaluation = evaluateRecoveryItems({ manifest, signals: [], cost, config: settings });
  if (!evaluation.shouldRecover) { await application.events.publish('logistics.recovery.skipped', { manifest, evaluation }, { source: 'death-recovery', correlationId: manifest.id }); return null; }
  if (!selection.selected) throw new ValidationError(`No eligible recovery bot for death manifest '${manifest.id}'`);
  let job = await application.recovery.create({ manifest, evaluation, chunkActive: true }); job = await application.recovery.assign({ jobId: job.id, botId: selection.selected.botId });
  const recoveryRuntime = application.bots.get(selection.selected.botId); const beforeInventory = recoveryRuntime.adapter.snapshot().inventorySummary;
  try {
    job = await application.recovery.transition({ jobId: job.id, status: 'TRAVELLING' }); await recoveryRuntime.adapter.smartMove({ x: manifest.position.x, y: manifest.position.y, z: manifest.position.z, range: 2 });
    job = await application.recovery.transition({ jobId: job.id, status: 'SEARCHING' }); const expected = job.items.filter(item => item.decision !== 'IGNORE'); const names = expected.map(item => item.name); const drops = recoveryRuntime.adapter.findDroppedItems({ position: manifest.position, radius: 12, names });
    job = await application.recovery.transition({ jobId: job.id, status: 'COLLECTING' }); for (const drop of drops) await recoveryRuntime.adapter.collectDroppedItem({ entityId: drop.entityId, item: drop.item, count: drop.count, timeoutMs: 15_000, position: manifest.position, radius: 12 });
    job = await application.recovery.transition({ jobId: job.id, status: 'VERIFYING' }); const verification = verifyRecovery({ expectedItems: job.items, beforeInventory, afterInventory: recoveryRuntime.adapter.snapshot().inventorySummary }); const completed = await application.recovery.complete({ jobId: job.id, verification }); await application.logistics.reconcileDeathRecovery({ manifestId: manifest.id, status: completed.status, recoveryBotId: selection.selected.botId, recoveredItems: verification.items.filter(item => item.recoveredCount > 0), lostItems: verification.items.filter(item => item.missingCount > 0) }); return completed;
  } catch (error) { await application.recovery.recordFailure({ jobId: job.id, code: recoveryFailureCode(error), message: error.message }); throw error; }
}

function recoveryCandidates(application, manifest) { return application.bots.list().filter(bot => bot.id !== manifest.botId).map(bot => ({ botId: bot.id, worldKey: serverKey(application.bots.get(bot.id).options), dimension: String(bot.runtime.dimension ?? 'overworld'), position: bot.runtime.position ?? { x: 0, y: 0, z: 0 }, alive: ['READY', 'ACTIVE'].includes(bot.status), available: ['READY', 'ACTIVE'].includes(bot.status), health: Number(bot.runtime.health ?? 0), food: Number(bot.runtime.food ?? 0), freeSlots: Math.max(0, 36 - (bot.runtime.inventorySummary?.length ?? 0)), equipmentScore: 0, workload: 0 })); }
function requiredSlots(items) { return Math.max(1, Math.ceil(items.reduce((sum, item) => sum + item.count, 0) / 64)); }
function serverKey(options) { return `${String(options?.host ?? 'localhost').toLowerCase()}:${Number(options?.port ?? 25565)}`; }
function recoveryFailureCode(error) { if (error?.code === 'ITEMS_DESPAWNED') return 'ITEMS_DESPAWNED'; if (/inventory|slot/i.test(error?.message ?? '')) return 'INVENTORY_FULL'; if (/path|route|navigate/i.test(error?.message ?? '')) return 'PATHFINDER_FAILED'; return 'ITEMS_MISSING'; }
