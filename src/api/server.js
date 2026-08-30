import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { MineHiveError, NotFoundError, ValidationError } from '../core/errors.js';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DASHBOARD_FILES = Object.freeze({
  '/': [new URL('../dashboard/index.html', import.meta.url), 'text/html; charset=utf-8'],
  '/dashboard.js': [new URL('../dashboard/dashboard.js', import.meta.url), 'text/javascript; charset=utf-8'],
  '/dashboard.css': [new URL('../dashboard/dashboard.css', import.meta.url), 'text/css; charset=utf-8'],
  '/settings.css': [new URL('../dashboard/settings.css', import.meta.url), 'text/css; charset=utf-8'],
  '/camera.css': [new URL('../dashboard/camera.css', import.meta.url), 'text/css; charset=utf-8']
});

async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 1_000_000) throw new ValidationError('Request body too large'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new ValidationError('Request body must be valid JSON'); }
}

export class ApiServer {
  constructor({ application, host, port, logger, rateLimitPerMinute }) { this.application = application; this.host = host; this.port = port; this.logger = logger; this.rateLimitPerMinute = rateLimitPerMinute; this.clients = new Map(); this.lastRateLimitCleanup = 0; }
  async start() {
    if (this.server) return this.address();
    this.server = createServer(async (req, res) => {
      const requestId = req.headers['x-request-id'] ?? randomUUID(); const started = performance.now(); let quota = null;
      const quotaHeaders = () => quota ? { 'x-ratelimit-limit': String(quota.limit), 'x-ratelimit-remaining': String(quota.remaining), 'x-ratelimit-reset': String(Math.ceil(quota.resetAt / 1000)), ...(quota.allowed ? {} : { 'retry-after': String(Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000))) }) } : {};
      const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': requestId, ...quotaHeaders() }); res.end(JSON.stringify(value)); };
      const sendFile = async ([file, contentType]) => { res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache', ...quotaHeaders() }); res.end(await readFile(file)); };
      try {
        const url = new URL(req.url, 'http://localhost'); const parts = url.pathname.split('/').filter(Boolean);
        const unmetered = req.method === 'GET' && (url.pathname === '/health' || Boolean(DASHBOARD_FILES[url.pathname])); if (!unmetered) { this.lastRateLimitCleanup = cleanupClients(this.clients, this.lastRateLimitCleanup); quota = consumeRequest(this.clients, req.socket.remoteAddress ?? 'unknown', this.rateLimitPerMinute); if (!quota.allowed) return send(429, { error: { code: 'RATE_LIMITED', message: 'API request limit exceeded; retry after one minute', requestId } }); }
        if (req.method === 'GET' && DASHBOARD_FILES[url.pathname]) return await sendFile(DASHBOARD_FILES[url.pathname]);
        if (req.method === 'GET' && url.pathname === '/health') return send(200, await this.application.health.check());
        if (this.application.config.api.token && req.headers.authorization !== `Bearer ${this.application.config.api.token}`) return send(401, { error: { code: 'UNAUTHORIZED', message: 'Valid bearer token required', requestId } });
        if (req.method === 'GET' && url.pathname === '/api/v1/system/status') return send(200, this.application.status());
        if (req.method === 'GET' && url.pathname === '/api/v1/dashboard/snapshot') { const [health, autonomyObjectives, profiles, logistics] = await Promise.all([this.application.health.check(), this.application.autonomy.objectives(), this.application.botProfiles.list(), this.application.logistics.status()]); const bots = this.application.bots.list().map(bot => ({ ...bot, profile: profiles.find(profile => profile.id === bot.id) ?? null })); return send(200, { data: { health, bots, goals: this.application.goals.list(), admins: this.application.admins.list(), ai: this.application.coordinator.status(), taskQueue: this.application.executor.status(), logistics, diagnostics: processDiagnostics(), settings: { llm: { ...this.application.llm.settings(), status: this.application.llm.status() }, log: this.application.logger.status(), autonomy: this.application.autonomy.status(), acquisition: this.application.acquisition.settings(), survival: this.application.survival.settings(), memory: await this.application.memorySettings() }, autonomyObjectives } }); }
        if (req.method === 'GET' && url.pathname === '/api/v1/settings') return send(200, { data: { llm: { ...this.application.llm.settings(), status: this.application.llm.status() }, log: this.application.logger.status(), autonomy: this.application.autonomy.status(), acquisition: this.application.acquisition.settings(), survival: this.application.survival.settings(), memory: await this.application.memorySettings() } });
        if (req.method === 'PATCH' && url.pathname === '/api/v1/settings/llm') return send(200, { data: this.application.llm.configure(await body(req)) });
        if (req.method === 'PATCH' && url.pathname === '/api/v1/settings/log') return send(200, { data: this.application.logger.setLevel((await body(req)).level) });
        if (req.method === 'GET' && url.pathname === '/api/v1/settings/logs') return send(200, { data: this.application.logger.recent(Number(url.searchParams.get('limit') ?? 100)) });
        if (req.method === 'GET' && url.pathname === '/api/v1/settings/log-files') return send(200, { data: this.application.logStore?.list() ?? [] });
        if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'settings' && parts[3] === 'log-files' && parts[4]) { if (!this.application.logStore) throw new ValidationError('Saved logs are disabled in the test profile'); return send(200, { data: this.application.logStore.read(decodeURIComponent(parts[4]), Number(url.searchParams.get('limit') ?? 1000)) }); }
        if (req.method === 'PATCH' && url.pathname === '/api/v1/settings/autonomy') return send(200, { data: this.application.autonomy.configure(await body(req)) });
        if (req.method === 'PATCH' && url.pathname === '/api/v1/settings/acquisition') return send(200, { data: await this.application.configureAcquisition(await body(req)) });
        if (req.method === 'PATCH' && url.pathname === '/api/v1/settings/recovery') return send(200, { data: await this.application.configureRecovery(await body(req)) });
        if (req.method === 'PATCH' && url.pathname === '/api/v1/settings/survival') return send(200, { data: this.application.configureSurvival(await body(req)) });
        if (req.method === 'PATCH' && url.pathname === '/api/v1/settings/memory') return send(200, { data: await this.application.configureMemory(await body(req)) });
        if (req.method === 'POST' && url.pathname === '/api/v1/settings/reset') return send(200, { data: await this.application.resetRuntimeSettings() });
        if (req.method === 'GET' && url.pathname === '/api/v1/recovery/dashboard') return send(200, { data: await recoveryDashboard(this.application) });
        if (req.method === 'GET' && url.pathname === '/api/v1/metrics') return send(200, this.application.metrics.snapshot());
        if (req.method === 'GET' && url.pathname === '/api/v1/bots') return send(200, { data: this.application.bots.list() });
        if (req.method === 'POST' && url.pathname === '/api/v1/bots') return send(201, { data: await this.application.botProfiles.create(await body(req)) });
        if (req.method === 'GET' && url.pathname === '/api/v1/admins') return send(200, { data: this.application.admins.list() });
        if (req.method === 'POST' && url.pathname === '/api/v1/admins') return send(201, { data: await this.application.admins.add((await body(req)).username) });
        if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'admins' && parts[3]) return send(200, { data: await this.application.admins.remove(decodeURIComponent(parts[3])) });
        if (req.method === 'GET' && url.pathname === '/api/v1/goals') return send(200, { data: this.application.goals.list() });
        if (req.method === 'POST' && url.pathname === '/api/v1/goals') return send(201, { data: this.application.goals.create(await body(req)) });
        if (req.method === 'GET' && url.pathname === '/api/v1/tasks') return send(200, { data: this.application.goals.allTasks() });
        if (req.method === 'GET' && url.pathname === '/api/v1/tasks/queue') return send(200, { data: this.application.executor.status() });
        if (req.method === 'GET' && url.pathname === '/api/v1/ai/status') return send(200, { data: this.application.coordinator.status() });
        if (req.method === 'GET' && url.pathname === '/api/v1/ai/fleet') return send(200, { data: this.application.coordinator.fleetView() });
        if (req.method === 'POST' && url.pathname === '/api/v1/ai/command') { const input = await body(req); return send(200, { data: await this.application.coordinator.coordinate({ text: input.text, selector: input.selector, actor: 'api' }) }); }
        if (req.method === 'GET' && url.pathname === '/api/v1/memory/dashboard') return send(200, { data: await memoryDashboard(this.application, url.searchParams) });
        if (req.method === 'GET' && url.pathname === '/api/v1/memory/semantic') return send(200, { data: await this.application.semanticMemory.search({ text: url.searchParams.get('q') ?? '', worldKey: url.searchParams.get('worldKey') ?? undefined, dimension: url.searchParams.get('dimension') ?? undefined, type: url.searchParams.get('type') ?? undefined, limit: url.searchParams.get('limit') ?? 10 }) });
        if (req.method === 'POST' && url.pathname === '/api/v1/memory/semantic') return send(201, { data: await this.application.semanticMemory.remember(await body(req)) });
        if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'memory' && parts[3] === 'semantic' && parts[4] && parts.length === 5) return send(200, { data: await deleteMemory(this.application.semanticMemory, 'Semantic memory', decodeURIComponent(parts[4]), 'semantic') });
        if (req.method === 'GET' && url.pathname === '/api/v1/memory/short-term') return send(200, { data: await this.application.semanticMemory.search({ text: url.searchParams.get('q') ?? '', worldKey: url.searchParams.get('worldKey') ?? undefined, dimension: url.searchParams.get('dimension') ?? undefined, type: 'SHORT_TERM', limit: url.searchParams.get('limit') ?? 10 }) });
        if (req.method === 'POST' && url.pathname === '/api/v1/memory/short-term') return send(201, { data: await this.application.semanticMemory.rememberShortTerm(await body(req)) });
        if (req.method === 'GET' && url.pathname === '/api/v1/memory/long-term') return send(200, { data: await this.application.semanticMemory.search({ text: url.searchParams.get('q') ?? '', worldKey: url.searchParams.get('worldKey') ?? undefined, dimension: url.searchParams.get('dimension') ?? undefined, type: 'LONG_TERM', limit: url.searchParams.get('limit') ?? 10 }) });
        if (req.method === 'POST' && url.pathname === '/api/v1/memory/long-term') return send(201, { data: await this.application.semanticMemory.rememberLongTerm(await body(req)) });
        if (req.method === 'POST' && url.pathname === '/api/v1/memory/recall') return send(200, { data: await this.application.semanticMemory.recall(await body(req)) });
        if (req.method === 'POST' && url.pathname === '/api/v1/memory/consolidate') return send(200, { data: await this.application.memoryLifecycle.tick() });
        if (req.method === 'GET' && url.pathname === '/api/v1/ml/status') return send(200, { data: await this.application.ml.status() });
        if (req.method === 'GET' && url.pathname === '/api/v1/ml/models') return send(200, { data: await this.application.ml.models() });
        if (req.method === 'GET' && url.pathname === '/api/v1/hivemind/status') { this.application.hive.syncMembers(this.application.bots.list()); return send(200, { data: await this.application.hive.status() }); }
        if (req.method === 'GET' && url.pathname === '/api/v1/hivemind/locks') return send(200, { data: await this.application.hive.locks() });
        if (req.method === 'GET' && url.pathname === '/api/v1/hivemind/state') return send(200, { data: await this.application.hive.state() });
        if (req.method === 'GET' && url.pathname === '/api/v1/hivemind/decisions') return send(200, { data: await this.application.hive.decisions() });
        if (req.method === 'POST' && url.pathname === '/api/v1/hivemind/messages') return send(201, { data: await this.application.hive.publish(await body(req)) });
        if (req.method === 'POST' && url.pathname === '/api/v1/hivemind/state') return send(201, { data: await this.application.hive.setState(await body(req)) });
        if (req.method === 'POST' && url.pathname === '/api/v1/hivemind/proposals') { this.application.hive.syncMembers(this.application.bots.list()); return send(201, { data: await this.application.hive.propose(await body(req)) }); }
        if (req.method === 'GET' && url.pathname === '/api/v1/autonomy/status') return send(200, { data: this.application.autonomy.status() });
        if (req.method === 'GET' && url.pathname === '/api/v1/autonomy/objectives') return send(200, { data: await this.application.autonomy.objectives() });
        if (req.method === 'POST' && url.pathname === '/api/v1/autonomy/objectives') return send(201, { data: await this.application.autonomy.createObjective(await body(req)) });
        if (req.method === 'POST' && url.pathname === '/api/v1/autonomy/tick') return send(200, { data: await this.application.autonomy.tick() });
        if (req.method === 'POST' && url.pathname === '/api/v1/autonomy/enabled') return send(200, { data: this.application.autonomy.setEnabled(Boolean((await body(req)).enabled)) });
        if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'autonomy' && parts[3] === 'objectives' && parts[4]) return send(200, { data: { removed: await this.application.autonomy.removeObjective(parts[4]) } });
        if (req.method === 'GET' && url.pathname === '/api/v1/database/status') return send(200, { data: this.application.database?.health() ?? { status: 'HEALTHY', driver: this.application.config.profile === 'test' ? 'memory' : 'json' } });
        if (req.method === 'GET' && url.pathname === '/api/v1/logistics/status') return send(200, { data: await this.application.logistics.status() });
        if (req.method === 'GET' && url.pathname === '/api/v1/logistics/storages') return send(200, { data: await this.application.logistics.stock({ worldKey: url.searchParams.get('worldKey') ?? undefined, dimension: url.searchParams.get('dimension') ?? undefined }) });
        if (req.method === 'PATCH' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'logistics' && parts[3] === 'storages' && parts[4] && parts.length === 5) return send(200, { data: await this.application.logistics.renameStorage({ storageId: decodeURIComponent(parts[4]), name: (await body(req)).name }) });
        if (req.method === 'GET' && url.pathname === '/api/v1/logistics/reservations') return send(200, { data: await this.application.logistics.reservations() });
        if (req.method === 'GET' && url.pathname === '/api/v1/logistics/transfers') return send(200, { data: await this.application.logistics.transfers() });
        if (req.method === 'GET' && url.pathname === '/api/v1/logistics/timeline') return send(200, { data: await this.application.logistics.timeline({ limit: Number(url.searchParams.get('limit') ?? 100) }) });
        if (req.method === 'GET' && url.pathname === '/api/v1/logistics/locks') return send(200, { data: await this.application.logistics.locks() });
        if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'logistics' && parts[3] === 'reservations' && parts[4] && parts[5] === 'release') { const input = await body(req); return send(200, { data: await this.application.logistics.release({ reservationId: parts[4], requesterBotId: input.requesterBotId }) }); }
        if (req.method === 'POST' && url.pathname === '/api/v1/database/backup') { if (!this.application.database) throw new ValidationError('Database backup requires the sqlite driver'); const input = await body(req); const name = String(input.name ?? `minehive-${Date.now()}.sqlite`); if (!/^[A-Za-z0-9_.-]{1,100}\.sqlite$/.test(name)) throw new ValidationError('Backup name must be a safe .sqlite filename'); return send(201, { data: await this.application.database.backup(join(resolve(this.application.config.dataPath), 'backups', name)) }); }
        if (req.method === 'GET' && url.pathname === '/api/v1/memory') return send(200, { data: await this.application.worldMemory.search({ host: url.searchParams.get('host') || undefined, port: url.searchParams.get('port') || undefined, dimension: url.searchParams.get('dimension') || undefined, name: url.searchParams.get('name') || undefined, type: url.searchParams.get('type') || undefined }) });
        if (req.method === 'POST' && url.pathname === '/api/v1/memory') return send(201, { data: await this.application.worldMemory.remember(await body(req)) });
        if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'memory' && parts[3] && parts.length === 4) return send(200, { data: await deleteMemory(this.application.worldMemory, 'World memory', decodeURIComponent(parts[3]), 'world') });
        if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'goals' && parts[3]) {
          if (req.method === 'GET' && parts.length === 4) return send(200, { data: this.application.goals.get(parts[3]).toDTO(), tasks: this.application.goals.tasks(parts[3]) });
          if (req.method === 'POST' && parts[4] === 'run') return send(200, { data: await this.application.goals.run(parts[3]) });
          if (req.method === 'POST' && parts[4] === 'cancel') return send(200, { data: await this.application.goals.cancel(parts[3], (await body(req)).reason) });
        }
        if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'tasks' && parts[3]) {
          if (req.method === 'GET') return send(200, { data: this.application.goals.task(parts[3]).toDTO() });
          if (req.method === 'POST' && parts[4] === 'cancel') return send(this.application.executor.cancel(parts[3], (await body(req)).reason) ? 202 : 409, { data: this.application.goals.task(parts[3]).toDTO() });
        }
        if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'bots' && parts[3]) {
          if (req.method === 'GET' && parts.length === 4) return send(200, { data: this.application.bots.get(parts[3]).snapshot() });
          if (req.method === 'PATCH' && parts.length === 4) return send(200, { data: await this.application.botProfiles.update(parts[3], await body(req)) });
          if (req.method === 'POST' && parts[4] === 'start') { await this.application.bots.start(parts[3]); return send(202, { data: this.application.bots.get(parts[3]).snapshot() }); }
          if (req.method === 'POST' && parts[4] === 'stop') { await this.application.bots.stop(parts[3]); return send(200, { data: this.application.bots.get(parts[3]).snapshot() }); }
          if (req.method === 'DELETE' && parts.length === 4) { const runtime = this.application.bots.get(parts[3]); if (runtime.snapshot().runtime.camera.active) await this.application.stopCamera(parts[3]); await this.application.botProfiles.remove(parts[3]); return send(200, { data: { removed: true, id: parts[3] } }); }
          if (req.method === 'POST' && parts[4] === 'camera' && parts[5] === 'start') return send(200, { data: await this.application.startCamera(parts[3], (await body(req)).mode) });
          if (req.method === 'POST' && parts[4] === 'camera' && parts[5] === 'stop') return send(200, { data: await this.application.stopCamera(parts[3]) });
          if (req.method === 'POST' && parts[4] === 'memory') { const runtime = this.application.bots.get(parts[3]); const input = await body(req); const snapshot = runtime.adapter.snapshot(); return send(201, { data: await this.application.worldMemory.remember({ ...runtime.options, ...input, position: input.position ?? snapshot.position, dimension: input.dimension ?? snapshot.dimension, sourceBotId: parts[3] }) }); }
          if (req.method === 'POST' && parts[4] === 'actions' && parts[5]) {
            const input = await body(req); const capability = ({ navigate: 'minecraft.navigation', move: 'minecraft.smart-movement', collect: 'minecraft.collection', survey: 'minecraft.survey', follow: 'minecraft.follow-player', come: 'minecraft.come', farm: 'minecraft.farming', deforest: 'minecraft.deforestation', reforest: 'minecraft.reforestation', combat: 'minecraft.combat', sethome: 'minecraft.set-home', home: 'minecraft.home', craft: 'minecraft.crafting', smelt: 'minecraft.smelting', equip: 'minecraft.equip', unequip: 'minecraft.unequip', use_item: 'minecraft.use-item', interact_entity: 'minecraft.interact-entity', interact_block: 'minecraft.interact-block', armor: 'minecraft.armor.auto-equip', shear: 'minecraft.shear', wool: 'minecraft.acquire-wool', milk: 'minecraft.acquire-milk', sleep: 'minecraft.sleep', wake: 'minecraft.wake', open_door: 'minecraft.open-door', close_door: 'minecraft.close-door', open_trapdoor: 'minecraft.open-trapdoor', close_trapdoor: 'minecraft.close-trapdoor', chat: 'minecraft.chat', observe: 'minecraft.observation', stop: 'minecraft.stop' })[parts[5]];
            if (!capability) throw new ValidationError(`Unsupported action '${parts[5]}'`);
            if (['wool', 'milk'].includes(parts[5])) { const item = parts[5] === 'wool' ? String(input.item ?? 'white_wool').trim().toLowerCase() : 'milk_bucket'; const count = Number(input.count ?? 1); return send(200, { data: await this.application.acquisition.acquire({ requesterBotId: parts[3], type: 'ITEM', item, count, purpose: `API survival action ${parts[5]}` }) }); }
            if (parts[5] === 'stop') { const runtime = this.application.bots.get(parts[3]); await runtime.adapter.stopActions(); for (const task of this.application.goals.allTasks().filter(task => task.assignedBot === parts[3] && ['ASSIGNED', 'RUNNING'].includes(task.status))) this.application.executor.cancel(task.id, 'Stopped through API'); return send(200, { data: { stopped: true, botId: parts[3] } }); }
            if (['collect', 'craft', 'smelt', 'survey', 'farm', 'deforest', 'reforest', 'combat'].includes(parts[5])) { if (parts[5] === 'collect' && (typeof input.block !== 'string' || !input.block.trim())) throw new ValidationError('Collect action requires block'); if (['craft', 'smelt'].includes(parts[5]) && (typeof input.item !== 'string' || !input.item.trim())) throw new ValidationError(`${parts[5]} action requires item`); const bot = this.application.bots.get(parts[3]).snapshot(); const text = parts[5] === 'collect' ? `collect ${input.block} ${input.count ?? 1}` : parts[5] === 'craft' ? `craft ${input.item} ${input.count ?? 1}` : parts[5] === 'smelt' ? `smelt ${input.item} ${input.count ?? 1}` : parts[5] === 'survey' ? `survey ${input.radius ?? 64}` : parts[5] === 'farm' ? `farm ${input.crop ?? 'wheat'} ${input.count ?? 16}` : parts[5] === 'deforest' ? `deforest ${input.log ?? 'any'} ${input.count ?? 1}` : parts[5] === 'reforest' ? `reforest ${input.count ?? 8}` : `${input.mode ?? 'guard'} ${input.radius ?? 16}`; return send(200, { data: await this.application.coordinator.coordinate({ text, selector: `bot:${bot.metadata.commandAlias ?? bot.name}`, actor: 'api' }) }); }
            const goal = this.application.goals.create({ description: `${parts[5]} for bot ${parts[3]}`, priority: input.priority ?? 50, constraints: { preferredBot: parts[3] }, steps: [{ type: parts[5], input, requiredCapabilities: [capability], timeout: input.timeout ?? 120_000 }] });
            return send(200, { data: await this.application.goals.run(goal.id) });
          }
        }
        if (req.method === 'GET' && url.pathname === '/api/v1/modules') return send(200, { data: this.application.modules.status() });
        if (req.method === 'GET' && url.pathname === '/api/v1/plugins') return send(200, { data: this.application.plugins.status() });
        return send(404, { error: { code: 'NOT_FOUND', message: 'Route not found', requestId } });
      } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : error.code === 'VALIDATION_ERROR' ? 400 : error.code === 'CANCELLED' ? 409 : 500;
        const safe = error instanceof MineHiveError ? error.toJSON() : { code: 'INTERNAL_ERROR', message: 'Internal server error' };
        this.logger.error('api.request.failed', { requestId, error: error.message }); send(status, { error: { ...safe, requestId } });
      } finally { this.application.metrics.increment('api.requests'); this.application.metrics.gauge('api.last_latency_ms', performance.now() - started); }
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, this.host, resolve); });
    return this.address();
  }
  address() { return this.server?.address(); }
  async stop() { if (!this.server) return; await new Promise((resolve, reject) => this.server.close(error => error ? reject(error) : resolve())); this.server = null; }
}

function consumeRequest(clients, address, limit) { const now = Date.now(); const previous = clients.get(address); const current = !previous || previous.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { count: previous.count + 1, resetAt: previous.resetAt }; clients.set(address, current); return { allowed: current.count <= limit, limit, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt }; }
function cleanupClients(clients, lastCleanup) { const now = Date.now(); if (now - lastCleanup < 60_000) return lastCleanup; for (const [key, value] of clients) if (value.resetAt <= now) clients.delete(key); return now; }
function processDiagnostics() { const memory = process.memoryUsage(); return { uptimeSeconds: Math.floor(process.uptime()), rssMb: Math.round(memory.rss / 1_048_576), heapUsedMb: Math.round(memory.heapUsed / 1_048_576) }; }

async function recoveryDashboard(application) {
  const settings = application.recovery.settings();
  const jobs = await application.recovery.list({});
  const activeJobs = jobs.filter(job => !['RECOVERED', 'PARTIAL_RECONCILED', 'FAILED', 'EXPIRED_RECONCILED', 'CANCELLED', 'UNRECOVERABLE'].includes(job.status));
  const totalRecovered = jobs.filter(job => job.status === 'RECOVERED').reduce((sum, job) => sum + sumItemCounts(job.items), 0);
  const permanentLoss = jobs.filter(job => ['FAILED', 'UNRECOVERABLE', 'EXPIRED_RECONCILED'].includes(job.status)).reduce((sum, job) => sum + sumItemCounts(job.items), 0);
  const ignoredJunk = jobs.reduce((sum, job) => sum + job.items.filter(item => item.decision === 'IGNORE').reduce((total, item) => total + item.count, 0), 0);
  const successRate = jobs.length ? (jobs.filter(job => ['RECOVERED', 'PARTIAL_RECONCILED'].includes(job.status)).length / jobs.length) : 0;
  const timeline = jobs.flatMap(job => (job.lifecycle ?? []).map(entry => ({ ...entry, jobId: job.id, botId: job.deadBotId, event: entry.state, at: entry.at, item: job.items[0]?.name ?? null, count: job.items.reduce((total, item) => total + item.count, 0) })));
  return {
    metrics: {
      activeJobs: activeJobs.length,
      urgentRecoveries: activeJobs.filter(job => job.recoveryScore >= settings.urgentScore || job.despawn?.status === 'URGENT').length,
      recoveredItems: totalRecovered,
      permanentLoss,
      ignoredJunk,
      successRate
    },
    jobs: activeJobs.slice().sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    timeline: timeline.sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, 100),
    settings,
    status: activeJobs.length ? { status: 'ACTIVE', activeJobs: activeJobs.length } : 'IDLE'
  };
}

function sumItemCounts(items) {
  return Array.isArray(items) ? items.reduce((sum, item) => sum + (Number(item?.count ?? 0) || 0), 0) : 0;
}

async function memoryDashboard(application, searchParams) {
  const category = searchParams.get('category') ?? 'all'; if (!['all', 'world', 'semantic'].includes(category)) throw new ValidationError("Memory category must be 'all', 'world', or 'semantic'");
  const offset = queryInteger(searchParams.get('offset'), 'Memory offset', 0, 1_000_000, 0); const limit = queryInteger(searchParams.get('limit'), 'Memory limit', 1, 100, 50); const query = queryText(searchParams.get('q'), 'Memory search', 200).toLowerCase();
  const type = queryText(searchParams.get('type'), 'Memory type', 64).toLowerCase(); const worldKey = queryText(searchParams.get('worldKey'), 'Memory world', 300).toLowerCase(); const dimension = queryText(searchParams.get('dimension'), 'Memory dimension', 100).toLowerCase();
  const [worldRecords, semanticRecords, settings, lifecycle] = await Promise.all([application.worldMemory.all(), application.semanticMemory.all(), application.memorySettings(), Promise.resolve(application.memoryLifecycle.status())]);
  const world = worldRecords.map(record => ({ ...record, category: 'world', displayType: record.type })); const semantic = semanticRecords.map(record => ({ ...record, category: 'semantic', displayType: record.type })); const available = category === 'world' ? world : category === 'semantic' ? semantic : [...world, ...semantic];
  const filtered = available.filter(record => (!type || String(record.displayType).toLowerCase() === type) && (!worldKey || String(record.worldKey ?? '').toLowerCase() === worldKey) && (!dimension || String(record.dimension ?? '').toLowerCase() === dimension) && (!query || memorySearchText(record).includes(query))).sort((left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(String(left.updatedAt ?? left.createdAt)));
  const byType = Object.create(null); for (const record of [...world, ...semantic]) byType[record.displayType] = (byType[record.displayType] ?? 0) + 1;
  return { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit, hasMore: offset + limit < filtered.length, counts: { all: world.length + semantic.length, world: world.length, semantic: semantic.length, shortTerm: semantic.filter(record => record.type === 'SHORT_TERM').length, longTerm: semantic.filter(record => record.type === 'LONG_TERM').length, byType }, settings, lifecycle };
}

function queryInteger(value, name, minimum, maximum, fallback) { if (value === null || value === '') return fallback; const number = Number(value); if (!Number.isInteger(number) || number < minimum || number > maximum) throw new ValidationError(`${name} must be an integer between ${minimum} and ${maximum}`); return number; }
function queryText(value, name, maximum) { const text = String(value ?? '').trim(); if (text.length > maximum || /[\r\n\0]/.test(text)) throw new ValidationError(`${name} must contain at most ${maximum} safe characters`); return text; }
function memorySearchText(record) { return [record.name, record.content, record.displayType, record.worldKey, record.dimension, record.source, record.sourceBotId, ...(record.tags ?? [])].filter(value => value !== null && value !== undefined).join(' ').toLowerCase(); }
async function deleteMemory(service, resource, id, category) { if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw new ValidationError('Memory id must contain 1-128 safe characters'); const removed = await service.forget(id); if (!removed) throw new NotFoundError(resource, id); return { removed: true, id, category }; }
