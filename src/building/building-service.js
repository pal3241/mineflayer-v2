import { ConflictError, ValidationError } from '../core/errors.js';
import { blueprintPreview, importBlueprint } from './blueprint.js';

const DEFAULTS = { approvalRequired: true, maxBots: 4, placementDelayMs: 150, maxAttempts: 3, replaceExisting: false, allowScaffolding: false, maxBlocks: 100000, maxDimension: 256 };
const ACTIVE = new Set(['BUILDING', 'PAUSING']); const TERMINAL = new Set(['COMPLETED', 'CANCELLED']);
export function createBuildingService(options) { return new BuildingService(options); }

class BuildingService {
  constructor({ repository, settingsRepository, events, bots, capabilities, memory, acquisition = null, logistics = null, fleetTransfer = null, workshops = null, settings = {} }) { this.repository = repository; this.settingsRepository = settingsRepository; this.events = events; this.bots = bots; this.capabilities = capabilities; this.memory = memory; this.acquisition = acquisition; this.logistics = logistics; this.fleetTransfer = fleetTransfer; this.workshops = workshops; this.config = normalizeSettings({ ...DEFAULTS, ...settings }); this.controllers = new Map(); }
  async initialize() { const saved = (await this.settingsRepository.list())[0]; if (saved) this.config = normalizeSettings({ ...this.config, ...saved }); for (const project of await this.repository.list()) if (ACTIVE.has(project.status)) await this.repository.update(project.id, { status: 'PAUSED', pauseReason: 'APPLICATION_RESTART', activeBots: [] }); await this.syncProtection(); }
  settings() { return structuredClone(this.config); }
  async configure(input) { this.config = normalizeSettings({ ...this.config, ...(input ?? {}) }); const current = (await this.settingsRepository.list())[0]; if (current) await this.settingsRepository.update(current.id, this.config); else await this.settingsRepository.create({ id: 'global', ...this.config }); await this.emit('building.settings.updated', { settings: this.settings() }); return this.settings(); }
  protocol() { return { protocol: 'minehive.building', version: '1.0', apiVersion: 'v1', transports: ['http-poll'], synchronization: { snapshot: true, delta: true, revisionField: 'revision' }, commands: ['approve', 'build', 'pause', 'resume', 'cancel'], formats: [{ id: 'minehive-json', mode: 'native' }, { id: 'schem', mode: 'decoder-adapter' }, { id: 'litematic', mode: 'decoder-adapter' }] }; }
  async import(input) { const base = importBlueprint(input, this.config); const now = iso(); const project = { ...base, revision: 0, status: this.config.approvalRequired ? 'PENDING_APPROVAL' : 'READY', target: input.target ? target(input.target) : null, protection: { enabled: true, bounds: input.target ? worldBounds(base, target(input.target)) : null }, activeBots: [], progress: { total: base.blocks.length, completed: 0, failed: 0, pending: base.blocks.length }, placements: Object.fromEntries(base.blocks.map(block => [block.key, { status: 'PENDING', attempts: 0, ownerBotId: null, verifiedAt: null, error: null }])), deltas: [], createdAt: now, updatedAt: now }; await this.repository.create(project); await this.record(project.id, 'IMPORTED', { status: project.status }); return this.get(project.id); }
  async list() { return (await this.repository.list()).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async get(id) { return this.repository.find(id); }
  async preview(id, layer) { return blueprintPreview(await this.get(id), layer); }
  async preview3d(id) { const project = await this.get(id); return { blueprintId: project.id, revision: project.revision, bounds: project.bounds, target: project.target, protection: project.protection ?? { enabled: false, bounds: null }, blocks: project.blocks.map(block => ({ x: block.x, y: block.y, z: block.z, name: block.name, properties: block.properties, status: project.placements[block.key]?.status ?? 'PENDING' })) }; }
  async materialStatus(id, botId = null) {
    const project = await this.get(id); const botSummary = this.bots.list().find(bot => bot.id === botId) ?? this.bots.list().find(bot => bot.status === 'READY');
    const inventory = new Map(); const storages = [];
    if (botSummary) {
      try {
        const runtime = this.bots.get(botSummary.id); const snapshot = runtime.adapter.snapshot();
        for (const entry of snapshot.inventorySummary ?? []) inventory.set(entry.name, (inventory.get(entry.name) ?? 0) + Number(entry.count ?? 0));
        if (this.logistics) for (const storage of await this.logistics.stock(this.scope(botSummary.id))) {
          storages.push({ id: storage.id, name: storage.name, position: storage.position });
          for (const entry of storage.availableInventory ?? []) inventory.set(entry.name, (inventory.get(entry.name) ?? 0) + Number(entry.available ?? 0));
        }
      } catch {}
    }
    return { blueprintId: id, botId: botSummary?.id ?? null, storages, materials: project.materials.map(material => {
      const available = inventory.get(material.name) ?? 0; const decision = project.materialDecisions?.[material.name] ?? null;
      return { ...material, available, missing: Math.max(0, material.count - available), ready: available >= material.count, decision };
    }) };
  }
  async resolveMaterial(id, input = {}) {
    const project = await this.get(id); const material = String(input.material ?? '').toLowerCase(); const action = String(input.action ?? '').toUpperCase();
    if (!project.materials.some(item => item.name === material)) throw new ValidationError(`Material '${material}' is not required by this blueprint`);
    if (action === 'CANCEL') return this.cancel(id);
    if (ACTIVE.has(project.status)) throw new ConflictError(`Material decisions cannot change while blueprint is ${project.status}`);
    if (['ACQUIRE', 'SEARCH_MAKE'].includes(action)) {
      const worker = this.workers(input.botId ? [String(input.botId)] : null)[0];
      if (!worker) throw new ValidationError('No READY builder bot is available to search this material');
      const requirement = project.materials.find(item => item.name === material);
      const supply = await this.prepareMaterials({ ...project, materials: [requirement] }, worker);
      if (!supply.ready) {
        const materialDecisions = { ...(project.materialDecisions ?? {}), [material]: { action: 'SEARCH_MAKE', status: 'FAILED', reason: supply.reason, requestedAt: iso() } };
        await this.repository.update(id, { materialDecisions, updatedAt: iso() }); await this.record(id, 'MATERIAL_ACQUIRE_FAILED', { material, reason: supply.reason });
        throw new ConflictError(`Could not acquire '${material}': ${supply.reason}`);
      }
      const materialDecisions = { ...(project.materialDecisions ?? {}), [material]: { action: 'SEARCH_MAKE', status: 'READY', botId: worker, supply, completedAt: iso() } };
      await this.repository.update(id, { materialDecisions, updatedAt: iso() }); await this.record(id, 'MATERIAL_ACQUIRED', { material, botId: worker, supply }); return this.get(id);
    }
    if (!['REPLACE', 'SKIP'].includes(action)) throw new ValidationError('Material action must be REPLACE, SKIP, SEARCH_MAKE, or CANCEL');
    const replacement = action === 'REPLACE' ? String(input.replacement ?? '').toLowerCase() : null;
    if (action === 'REPLACE' && !/^[a-z0-9_]{1,80}$/.test(replacement)) throw new ValidationError('Replacement must be a Minecraft block registry name');
    const blocks = action === 'SKIP' ? project.blocks.filter(block => block.name !== material) : project.blocks.map(block => block.name === material ? { ...block, name: replacement } : block);
    if (!blocks.length) throw new ValidationError('Skipping this material would leave an empty blueprint; cancel the project instead');
    const rebuilt = importBlueprint({ name: project.name, format: project.format, origin: project.origin, blocks, metadata: { ...project.metadata, materialDecision: { material, action, replacement } } }, this.config);
    const placements = Object.fromEntries(rebuilt.blocks.map(block => [block.key, { status: 'PENDING', attempts: 0, ownerBotId: null, verifiedAt: null, error: null }]));
    const materialDecisions = { ...(project.materialDecisions ?? {}), [material]: { action, replacement, decidedAt: iso() } };
    await this.repository.update(id, { blocks: rebuilt.blocks, bounds: rebuilt.bounds, materials: rebuilt.materials, checksum: rebuilt.checksum, placements, materialDecisions, progress: { total: rebuilt.blocks.length, completed: 0, failed: 0, pending: rebuilt.blocks.length }, updatedAt: iso() });
    await this.record(id, action === 'REPLACE' ? 'MATERIAL_REPLACED' : 'MATERIAL_SKIPPED', { material, replacement }); return this.get(id);
  }
  async transform(id, input = {}) { const project = await this.get(id); if (!['PENDING_APPROVAL', 'READY'].includes(project.status)) throw new ConflictError(`Blueprint transform requires PENDING_APPROVAL or READY, current ${project.status}`); const rotation = Number(input.rotation ?? 0); if (![0, 90, 180, 270].includes(rotation)) throw new ValidationError('rotation must be 0, 90, 180, or 270'); const mirrorX = Boolean(input.mirrorX); const mirrorZ = Boolean(input.mirrorZ); const blocks = project.blocks.map(block => transformBlock(block, project.origin, rotation, mirrorX, mirrorZ)); const transformed = importBlueprint({ name: project.name, format: project.format, origin: project.origin, blocks, metadata: { ...project.metadata, transform: { rotation, mirrorX, mirrorZ } } }, this.config); const placements = Object.fromEntries(transformed.blocks.map(block => [block.key, { status: 'PENDING', attempts: 0, ownerBotId: null, verifiedAt: null, error: null }])); await this.repository.update(id, { blocks: transformed.blocks, bounds: transformed.bounds, materials: transformed.materials, checksum: transformed.checksum, placements, progress: { total: transformed.blocks.length, completed: 0, failed: 0, pending: transformed.blocks.length }, transform: { rotation, mirrorX, mirrorZ }, updatedAt: iso() }); await this.record(id, 'TRANSFORMED', { rotation, mirrorX, mirrorZ }); return this.get(id); }
  async protection(id) { const project = await this.get(id); return project.protection ?? { enabled: false, bounds: null }; }
  async snapshot(id) { return { protocol: this.protocol().protocol, protocolVersion: this.protocol().version, project: await this.get(id) }; }
  async deltas(id, afterRevision = 0) { const project = await this.get(id); const after = Number(afterRevision); if (!Number.isInteger(after) || after < 0) throw new ValidationError('afterRevision must be a non-negative integer'); return { blueprintId: id, revision: project.revision, resetRequired: after > project.revision, deltas: project.deltas.filter(delta => delta.revision > after) }; }
  async approve(id, input = {}) { const project = await this.get(id); if (project.status !== 'PENDING_APPROVAL') throw new ConflictError(`Blueprint cannot be approved from ${project.status}`); await this.repository.update(id, { status: 'READY', approvedBy: String(input.actor ?? 'dashboard'), updatedAt: iso() }); await this.record(id, 'APPROVED', { actor: String(input.actor ?? 'dashboard') }); return this.get(id); }
  async build(id, input = {}) { const project = await this.get(id); if (!['READY', 'PAUSED', 'FAILED'].includes(project.status)) throw new ConflictError(`Blueprint cannot build from ${project.status}`); const destination = target(input.target ?? project.target); const workers = this.workers(input.botIds); if (!workers.length) throw new ValidationError('No READY bot supporting minecraft.blueprint-place is available'); const supply = await this.prepareMaterials(project, workers[0]); if (!supply.ready) { await this.repository.update(id, { status: 'FAILED', activeBots: [], materialSupply: supply, failure: { code: 'MATERIAL_UNAVAILABLE', message: supply.reason }, updatedAt: iso() }); await this.record(id, 'MATERIALS_UNAVAILABLE', supply); return this.get(id); } const controller = new AbortController(); this.controllers.get(id)?.abort(new Error('Superseded')); this.controllers.set(id, controller); await this.repository.update(id, { status: 'BUILDING', target: destination, supplyStorages: supply.storages, protection: { enabled: true, bounds: worldBounds(project, destination) }, activeBots: workers, pauseReason: null, materialSupply: supply, updatedAt: iso() }); await this.syncProtection(); await this.record(id, project.status === 'PAUSED' ? 'RESUMED' : 'BUILD_STARTED', { target: destination, botIds: workers, supplyStorages: supply.storages, supply }); void this.run(id, workers, controller.signal); return this.get(id); }
  async prepareMaterials(project, builderBotId) {
    if (!this.logistics && !this.acquisition) return { ready: true, mode: 'DIRECT_INVENTORY', storages: [], items: [] };
    const items = []; const storageIds = new Set();
    try {
      for (const material of project.materials) {
        let remaining = material.count; const logisticsBatches = [];
        if (this.logistics) {
          const runtime = this.bots.get(builderBotId);
          while (remaining > 0) {
            const count = Math.min(remaining, 2304);
            try {
              const result = await this.logistics.retrieve({ runtime, item: material.name, count });
              logisticsBatches.push({ count, reservationId: result.reservation.id, allocations: result.reservation.allocations });
              for (const allocation of result.reservation.allocations) storageIds.add(allocation.storageId);
              remaining -= count;
            } catch (error) {
              await this.emit('building.material.logistics-miss', { blueprintId: project.id, botId: builderBotId, item: material.name, requested: material.count, remaining, reason: error.message });
              break;
            }
          }
        }
        let acquired = null;
        if (remaining > 0) {
          if (!this.acquisition) throw new ValidationError(`No logistics stock or acquisition service can provide '${material.name}'`);
          const request = { ...material, count: remaining };
          try {
            acquired = await this.acquisition.acquire({ requesterBotId: builderBotId, type: 'ITEM', item: request.name, count: request.count, purpose: `blueprint ${project.id}`, priority: 90, consume: true });
          } catch (primaryError) {
            acquired = await this.helperAcquire(builderBotId, request, project, primaryError);
          }
        }
        const source = logisticsBatches.length && !acquired ? 'registered-storage' : logisticsBatches.length ? 'storage+acquisition' : acquired?.source;
        items.push({ ...material, status: 'READY', source, logisticsBatches, requestId: acquired?.requestId ?? null, helperBotId: acquired?.helperBotId ?? null });
      }
      return { ready: true, mode: this.logistics ? 'LOGISTICS_REGISTRY_FIRST' : 'ACQUISITION_CHAIN', storages: [...storageIds], items };
    } catch (error) {
      return { ready: false, storages: [...storageIds], items, reason: error.message, code: error.code ?? 'MATERIAL_UNAVAILABLE', preservedPlacements: Object.values(project.placements).filter(item => item.status === 'VERIFIED').length };
    }
  }
  async helperAcquire(builderBotId, material, project, primaryError) { const helper = this.bots.list().find(bot => bot.id !== builderBotId && bot.status === 'READY'); if (!helper || !this.fleetTransfer) throw primaryError; const result = await this.acquisition.acquire({ requesterBotId: helper.id, type: 'ITEM', item: material.name, count: material.count, purpose: `supply blueprint ${project.id} for ${builderBotId}`, priority: 90, consume: true }); const transfer = await this.fleetTransfer.transfer({ receiver: this.bots.get(builderBotId), donor: this.bots.get(helper.id), item: material.name, count: material.count }); await this.emit('building.material.helper-completed', { blueprintId: project.id, item: material.name, count: material.count, helperBotId: helper.id, transfer }); return { ...result, source: 'helper-acquisition', helperBotId: helper.id }; }
  async pause(id) { const project = await this.get(id); if (project.status !== 'BUILDING') throw new ConflictError(`Blueprint cannot pause from ${project.status}`); await this.repository.update(id, { status: 'PAUSING', updatedAt: iso() }); this.controllers.get(id)?.abort(new Error('Paused by operator')); await this.record(id, 'PAUSE_REQUESTED', {}); return this.get(id); }
  async cancel(id) { const project = await this.get(id); if (TERMINAL.has(project.status)) throw new ConflictError(`Blueprint is already ${project.status}`); this.controllers.get(id)?.abort(new Error('Cancelled by operator')); await this.repository.update(id, { status: 'CANCELLED', activeBots: [], updatedAt: iso() }); await this.record(id, 'CANCELLED', {}); return this.get(id); }
  async syncProtection() { const zones = (await this.repository.list()).filter(project => project.protection?.enabled && project.protection?.bounds && project.status !== 'CANCELLED').map(project => ({ id: project.id, bounds: project.protection.bounds })); for (const bot of this.bots.list()) { try { this.bots.get(bot.id).adapter.setProtectedZones?.(zones); } catch {} } return { zones: zones.length }; }
  async status() { await this.syncProtection(); const projects = await this.repository.list(); return { status: 'HEALTHY', projects: projects.length, active: projects.filter(item => ACTIVE.has(item.status)).length, pendingApproval: projects.filter(item => item.status === 'PENDING_APPROVAL').length, settings: this.settings() }; }
  workers(requested) { const wanted = Array.isArray(requested) && requested.length ? new Set(requested.map(String)) : null; return this.bots.list().filter(bot => bot.status === 'READY' && (!wanted || wanted.has(bot.id)) && (bot.capabilities ?? []).includes('minecraft.blueprint-place')).slice(0, this.config.maxBots).map(bot => bot.id); }
  async run(id, workers, signal) { try { await Promise.all(workers.map(botId => this.worker(id, botId, signal))); const project = await this.get(id); if (project.status === 'CANCELLED') return; const left = Object.values(project.placements).filter(item => item.status !== 'VERIFIED').length; await this.repository.update(id, { status: left ? 'FAILED' : 'COMPLETED', activeBots: [], updatedAt: iso() }); await this.record(id, left ? 'BUILD_FAILED' : 'BUILD_COMPLETED', { remaining: left }); } catch (error) { const project = await this.get(id); if (project.status === 'CANCELLED') return; const recoverable = ['BOT_NOT_READY', 'NAVIGATION_TIMEOUT', 'PATH_NOT_FOUND', 'NAVIGATION_FAILED', 'ARRIVAL_NOT_VERIFIED'].includes(error.code); const paused = signal.aborted || project.status === 'PAUSING' || recoverable; await this.repository.update(id, { status: paused ? 'PAUSED' : 'FAILED', pauseReason: paused ? String(signal.reason?.message ?? 'Paused') : null, activeBots: [], failure: paused ? null : { code: error.code ?? 'BUILD_FAILED', message: error.message }, updatedAt: iso() }); await this.record(id, paused ? 'PAUSED' : 'BUILD_FAILED', { error: error.message }); } finally { this.controllers.delete(id); } }
  async worker(id, botId, signal) { while (!signal.aborted) { const project = await this.get(id); const block = project.blocks.find(item => project.placements[item.key].status === 'PENDING' && item.dependencies.every(key => project.placements[key]?.status === 'VERIFIED')); if (!block) return; const state = project.placements[block.key]; const worldPosition = { x: project.target.x + block.x - project.origin.x, y: project.target.y + block.y - project.origin.y, z: project.target.z + block.z - project.origin.z }; const scope = this.scope(botId); const blueprintId = memoryProjectId(project); const remembered = scope && this.memory ? await this.memory.placement({ ...scope, blueprintId, blockKey: block.key }) : null; if (remembered) { await this.patch(id, block.key, { status: 'VERIFIED', ownerBotId: remembered.metadata.ownerBotId ?? 'memory', attempts: state.attempts, verifiedAt: remembered.updatedAt, error: null }, 'BLOCK_RESTORED_FROM_MEMORY'); continue; } await this.patch(id, block.key, { ...state, status: 'PLACING', ownerBotId: botId, attempts: state.attempts + 1 }, 'BLOCK_ASSIGNED'); try { const result = await this.capabilities.execute('minecraft.blueprint-place', { block: { ...block, position: worldPosition }, settings: this.config }, { botId, signal }); if (!result?.verified) throw new ValidationError(`Placement ${block.key} was not verified`); await this.patch(id, block.key, { status: 'VERIFIED', ownerBotId: botId, attempts: state.attempts + 1, verifiedAt: iso(), error: null }, 'BLOCK_VERIFIED'); if (scope && this.memory) await this.memory.recordPlacement({ ...scope, blueprintId, checksum: project.checksum, blockKey: block.key, block, position: worldPosition, ownerBotId: botId }); } catch (error) { if (signal.aborted) throw error; const retry = state.attempts + 1 < this.config.maxAttempts; await this.patch(id, block.key, { status: retry ? 'PENDING' : 'FAILED', ownerBotId: null, attempts: state.attempts + 1, verifiedAt: null, error: { code: error.code ?? 'PLACEMENT_FAILED', message: error.message } }, retry ? 'BLOCK_RETRY' : 'BLOCK_FAILED'); } if (this.config.placementDelayMs) await sleep(this.config.placementDelayMs, signal); } }
  scope(botId) { try { const runtime = this.bots.get(botId); const snapshot = runtime.adapter.snapshot(); return { worldKey: `${String(runtime.options?.host ?? 'localhost').toLowerCase()}:${Number(runtime.options?.port ?? 25565)}`, dimension: String(snapshot.dimension ?? 'overworld') }; } catch { return null; } }
  async patch(id, key, state, event) { const project = await this.get(id); const placements = { ...project.placements, [key]: state }; const values = Object.values(placements); const progress = { total: values.length, completed: values.filter(item => item.status === 'VERIFIED').length, failed: values.filter(item => item.status === 'FAILED').length, pending: values.filter(item => !['VERIFIED', 'FAILED'].includes(item.status)).length }; await this.repository.update(id, { placements, progress, updatedAt: iso() }); await this.record(id, event, { blockKey: key, state, progress }); }
  async record(id, type, payload) { const project = await this.get(id); const delta = { revision: project.revision + 1, type, at: iso(), payload }; await this.repository.update(id, { revision: delta.revision, deltas: [...project.deltas, delta].slice(-2000), updatedAt: delta.at }); await this.emit(`building.${type.toLowerCase()}`, { blueprintId: id, ...delta }); }
  async emit(type, payload) { await this.events?.publish(type, payload, { source: 'building', correlationId: payload.blueprintId }); }
}
function summary(project) { const { blocks, placements, deltas, ...result } = project; return result; }
function normalizeSettings(value) { return { approvalRequired: Boolean(value.approvalRequired), maxBots: number(value.maxBots, 1, 32, 'maxBots'), placementDelayMs: number(value.placementDelayMs, 0, 60000, 'placementDelayMs'), maxAttempts: number(value.maxAttempts, 1, 20, 'maxAttempts'), replaceExisting: Boolean(value.replaceExisting), allowScaffolding: Boolean(value.allowScaffolding), maxBlocks: number(value.maxBlocks, 1, 2000000, 'maxBlocks'), maxDimension: number(value.maxDimension, 1, 2048, 'maxDimension') }; }
function target(value) { if (!value || typeof value !== 'object') throw new ValidationError('Build target is required'); return Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, number(value[axis], -30000000, 30000000, `target.${axis}`)])); }
function number(value, min, max, label) { const result = Number(value); if (!Number.isInteger(result) || result < min || result > max) throw new ValidationError(`${label} must be an integer from ${min} to ${max}`); return result; }
function iso() { return new Date().toISOString(); }
function memoryProjectId(project) { return `${project.checksum}:${project.target.x},${project.target.y},${project.target.z}`; }
function sleep(ms, signal) { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new Error('Cancelled')); }, { once: true }); }); }

function worldBounds(project, destination) { const min = { x: destination.x + project.bounds.min.x - project.origin.x, y: destination.y + project.bounds.min.y - project.origin.y, z: destination.z + project.bounds.min.z - project.origin.z }; const max = { x: destination.x + project.bounds.max.x - project.origin.x, y: destination.y + project.bounds.max.y - project.origin.y, z: destination.z + project.bounds.max.z - project.origin.z }; return { min, max }; }
function transformBlock(block, origin, rotation, mirrorX, mirrorZ) { let x = block.x - origin.x; let z = block.z - origin.z; if (mirrorX) x = -x; if (mirrorZ) z = -z; const point = rotation === 90 ? { x: -z, z: x } : rotation === 180 ? { x: -x, z: -z } : rotation === 270 ? { x: z, z: -x } : { x, z }; const properties = structuredClone(block.properties ?? {}); if (['north','east','south','west'].includes(properties.facing)) { let index = ['north','east','south','west'].indexOf(properties.facing); index = (index + rotation / 90) % 4; let facing = ['north','east','south','west'][index]; if (mirrorX) facing = ({ east: 'west', west: 'east', north: 'north', south: 'south' })[facing]; if (mirrorZ) facing = ({ north: 'south', south: 'north', east: 'east', west: 'west' })[facing]; properties.facing = facing; } return { x: origin.x + point.x, y: block.y, z: origin.z + point.z, name: block.name, properties, blockEntity: block.blockEntity }; }
