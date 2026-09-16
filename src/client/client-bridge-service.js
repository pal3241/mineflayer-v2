import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.js';

const READY = new Set(['READY', 'ACTIVE', 'PAUSED']);
export function createClientBridgeService(options) { return new ClientBridgeService(options); }

export class ClientBridgeService {
  constructor({ bots, navigation, building, events, logger, leaseTtlMs = 15_000 }) {
    this.bots = bots; this.navigation = navigation; this.building = building; this.events = events; this.logger = logger;
    this.leaseTtlMs = Math.max(1_000, Number(leaseTtlMs) || 15_000); this.sessions = new Map(); this.botLeases = new Map();
    this.timer = setInterval(() => void this.cleanup(), Math.min(5_000, Math.max(500, Math.floor(this.leaseTtlMs / 2)))); this.timer.unref?.();
  }
  protocol() { return { protocol: 'minehive.client', version: '1.0', apiVersion: 'v1', transports: ['http-json'], leaseTtlMs: this.leaseTtlMs, heartbeatMs: Math.max(500, Math.floor(this.leaseTtlMs / 3)), features: ['body-switch-by-look', 'direct-control', 'rts-multi-move', 'blueprint-preview3d', 'fleet-hud'] }; }
  async open(input = {}) {
    await this.cleanup();
    const session = { id: randomUUID(), clientName: shortText(input.clientName ?? 'MineHive Fabric Client', 'clientName', 80), playerName: optionalText(input.playerName, 'playerName', 64), controlledBotId: null, lastSequence: -1, createdAt: new Date().toISOString(), lastSeenAt: Date.now(), expiresAt: Date.now() + this.leaseTtlMs };
    this.sessions.set(session.id, session); await this.publish('client.session.opened', { sessionId: session.id, playerName: session.playerName }); return this.sessionView(session);
  }
  async state(sessionId) {
    const session = await this.touch(sessionId); const blueprints = await (this.building?.list?.() ?? []);
    return { protocol: this.protocol(), session: this.sessionView(session), bots: this.bots.list().map(bot => this.botView(bot)), blueprints: blueprints.map(item => ({ id: item.id, name: item.name, status: item.status, revision: item.revision, progress: item.progress, bounds: item.bounds, target: item.target })) };
  }
  async switchBody(input = {}) {
    const session = await this.touch(input.sessionId); const botId = shortText(input.botId, 'botId', 128); const runtime = this.readyRuntime(botId); const owner = this.botLeases.get(botId);
    if (owner && owner !== session.id) throw new ConflictError(`Bot '${botId}' is controlled by another client session`);
    if (session.controlledBotId && session.controlledBotId !== botId) await this.release({ sessionId: session.id, reason: 'SWITCH_BODY' });
    await runtime.adapter.beginClientControl({ sessionId: session.id, playerName: session.playerName }); session.controlledBotId = botId; session.lastSequence = -1; this.botLeases.set(botId, session.id); this.refresh(session);
    await this.publish('client.body.switched', { sessionId: session.id, botId, playerName: session.playerName }); return { session: this.sessionView(session), bot: this.botView(runtime.snapshot()) };
  }
  async control(input = {}) {
    const session = await this.touch(input.sessionId); if (!session.controlledBotId) throw new ConflictError('Client session does not control a bot');
    const sequence = integer(input.sequence, 'sequence', 0, Number.MAX_SAFE_INTEGER); if (sequence <= session.lastSequence) return { accepted: false, stale: true, sequence: session.lastSequence, botId: session.controlledBotId };
    const runtime = this.readyRuntime(session.controlledBotId); const result = await runtime.adapter.applyClientControl({ ...input, sessionId: session.id }); session.lastSequence = sequence; this.refresh(session);
    return { accepted: true, stale: false, sequence, botId: session.controlledBotId, runtime: result };
  }
  async release(input = {}) {
    const session = await this.touch(input.sessionId, false); const botId = session.controlledBotId;
    if (botId) {
      try { await this.bots.get(botId).adapter.releaseClientControl({ sessionId: session.id, force: true }); } catch (error) { this.logger?.warn?.('client.control.release.failed', { sessionId: session.id, botId, error: error.message }); }
      if (this.botLeases.get(botId) === session.id) this.botLeases.delete(botId); session.controlledBotId = null; session.lastSequence = -1;
      await this.publish('client.body.released', { sessionId: session.id, botId, reason: String(input.reason ?? 'CLIENT_RELEASE') });
    }
    this.refresh(session); return this.sessionView(session);
  }
  async rtsMove(input = {}) {
    const session = await this.touch(input.sessionId); const botIds = [...new Set((input.botIds ?? []).map(String))]; if (!botIds.length || botIds.length > 32) throw new ValidationError('RTS move requires 1 to 32 unique botIds');
    const target = point(input.target); const formation = String(input.formation ?? 'GRID').toUpperCase();
    const results = await Promise.allSettled(botIds.map((botId, index) => { this.readyRuntime(botId); const offset = formationOffset(index, botIds.length, formation); return this.navigation.moveTo({ botId, target: { x: target.x + offset.x, y: target.y, z: target.z + offset.z }, source: 'GROUP', mode: 'SAFE', tolerance: 1.5 }); }));
    const commands = results.map((result, index) => result.status === 'fulfilled' ? { botId: botIds[index], status: 'ARRIVED', result: result.value } : { botId: botIds[index], status: 'FAILED', error: { code: result.reason?.code ?? 'RTS_MOVE_FAILED', message: result.reason?.message ?? String(result.reason) } });
    await this.publish('client.rts.move.completed', { sessionId: session.id, target, formation, commands }); return { target, formation, commands, completed: commands.filter(item => item.status === 'ARRIVED').length, failed: commands.filter(item => item.status === 'FAILED').length };
  }
  async cleanup() {
    const expired = [...this.sessions.values()].filter(session => session.expiresAt <= Date.now());
    for (const session of expired) {
      if (session.controlledBotId) { try { await this.bots.get(session.controlledBotId).adapter.releaseClientControl({ sessionId: session.id, force: true }); } catch {} if (this.botLeases.get(session.controlledBotId) === session.id) this.botLeases.delete(session.controlledBotId); }
      this.sessions.delete(session.id); await this.publish('client.session.expired', { sessionId: session.id, botId: session.controlledBotId });
    }
    return expired.length;
  }
  async dispose() { clearInterval(this.timer); for (const session of [...this.sessions.values()]) await this.release({ sessionId: session.id, reason: 'APPLICATION_STOP' }); this.sessions.clear(); this.botLeases.clear(); }
  status() { return { sessions: this.sessions.size, controlledBots: this.botLeases.size, leaseTtlMs: this.leaseTtlMs }; }
  async touch(id, refresh = true) { await this.cleanup(); const session = this.sessions.get(String(id ?? '')); if (!session) throw new NotFoundError('Client session', id); if (refresh) this.refresh(session); return session; }
  refresh(session) { session.lastSeenAt = Date.now(); session.expiresAt = session.lastSeenAt + this.leaseTtlMs; }
  readyRuntime(botId) { const runtime = this.bots.get(botId); if (!READY.has(runtime.machine?.state ?? runtime.snapshot().status)) throw new ConflictError(`Bot '${botId}' is not ready for client control`); return runtime; }
  sessionView(session) { return { id: session.id, clientName: session.clientName, playerName: session.playerName, controlledBotId: session.controlledBotId, createdAt: session.createdAt, lastSeenAt: new Date(session.lastSeenAt).toISOString(), expiresAt: new Date(session.expiresAt).toISOString() }; }
  botView(bot) { const runtime = this.bots.get(bot.id); const snapshot = bot.runtime ?? runtime.adapter.snapshot(); return { id: bot.id, name: bot.name, username: runtime.options?.username ?? bot.name, status: bot.status, position: snapshot.position, dimension: snapshot.dimension, health: snapshot.health, food: snapshot.food, inventorySummary: snapshot.inventorySummary ?? [], controlledBy: this.botLeases.get(bot.id) ?? null }; }
  publish(type, payload) { return this.events?.publish?.(type, payload, { source: 'client-bridge', correlationId: payload.sessionId }) ?? Promise.resolve(); }
}
function shortText(value, label, max) { const text = String(value ?? '').trim(); if (!text || text.length > max) throw new ValidationError(`${label} is required and must be at most ${max} characters`); return text; }
function optionalText(value, label, max) { if (value === undefined || value === null || value === '') return null; return shortText(value, label, max); }
function integer(value, label, min, max) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new ValidationError(`${label} must be an integer from ${min} to ${max}`); return number; }
function point(value) { const result = { x: Number(value?.x), y: Number(value?.y), z: Number(value?.z) }; if (!Object.values(result).every(Number.isFinite)) throw new ValidationError('RTS target requires finite x, y, z'); return result; }
function formationOffset(index, count, formation) { if (formation === 'LINE') return { x: index - (count - 1) / 2, z: 0 }; const width = Math.ceil(Math.sqrt(count)); return { x: index % width - (width - 1) / 2, z: Math.floor(index / width) - (Math.ceil(count / width) - 1) / 2 }; }
