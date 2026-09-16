import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '../core/errors.js';

export const COMBAT_ROLES = Object.freeze(['UNASSIGNED', 'TANK', 'FLANKER', 'RANGED', 'SUPPORT', 'SCOUT']);
export const COMBAT_RANKS = Object.freeze([
  ['Recruit', 0], ['Guard', 250], ['Veteran', 1_000], ['Elite', 3_000], ['Commander', 8_000]
]);
const ROLE_ACTIONS = Object.freeze({
  TANK: ['INTERCEPT', 'RAISE_SHIELD', 'MELEE_PRESSURE', 'RETREAT'],
  FLANKER: ['FLANK_PATH', 'MELEE_PRESSURE', 'RETREAT'],
  RANGED: ['FIND_LINE_OF_SIGHT', 'RANGED_AIM', 'RANGED_FIRE', 'REPOSITION', 'RETREAT'],
  SUPPORT: ['HEAL_ALLY', 'SUPPLY', 'ESCORT', 'RETREAT'],
  SCOUT: ['SCAN', 'MARK_TARGET', 'REPOSITION', 'RETREAT'],
  UNASSIGNED: ['SAFE_ORBIT', 'RETREAT']
});
const MOB_PROFILES = Object.freeze({
  creeper: { substate: 'HIT_RETREAT_FUSE', desiredDistance: 4.5, retreatOnFuse: true },
  skeleton: { substate: 'DIAGONAL_STRAFE', desiredDistance: 7, strafe: true },
  zombie: { substate: 'KNOCKBACK_LOOP', desiredDistance: 3.5 },
  husk: { substate: 'KNOCKBACK_LOOP', desiredDistance: 3.5 },
  witch: { substate: 'POTION_DODGE', desiredDistance: 8, strafe: true },
  spider: { substate: 'VERTICAL_AWARE', desiredDistance: 4 },
  default: { substate: 'SAFE_ORBIT', desiredDistance: 4 }
});

export function createCombatService({ repositories, events, bots, ml, logger } = {}) {
  if (!repositories?.profiles || !repositories?.events || !repositories?.policies) throw new ValidationError('Combat repositories are required');
  const profileCache = new Map(); const squadTargets = new Map(); const bindings = new Map(); let queue = Promise.resolve();
  const mutate = operation => { const result = queue.then(operation); queue = result.then(() => undefined, () => undefined); return result; };
  const emit = (type, payload) => events?.publish(type, payload, { source: 'combat-superior', correlationId: payload.botId ?? payload.squadId ?? randomUUID() });

  async function profile(botId) {
    botId = String(botId ?? ''); if (!botId) throw new ValidationError('Combat botId is required');
    if (profileCache.has(botId)) return structuredClone(profileCache.get(botId));
    const found = (await repositories.profiles.list()).find(item => item.botId === botId);
    const value = found ?? await repositories.profiles.create(defaultProfile(botId));
    profileCache.set(botId, value); return structuredClone(value);
  }
  async function update(botId, patch) {
    return mutate(async () => {
      const current = await profile(botId); const next = normalizeProfile({ ...current, ...patch, id: current.id, botId: current.botId, updatedAt: new Date().toISOString() });
      const saved = await repositories.profiles.update(current.id, next); profileCache.set(botId, saved); await emit('combat.profile.updated', saved); return structuredClone(saved);
    });
  }
  async function setRole(botId, role) {
    role = normalizeRole(role); return update(botId, { combatRole: role, assignedRole: role, allowedActions: ROLE_ACTIONS[role] });
  }
  async function transition(botId, mainState, sideState = null, combatSubstate = null, context = {}) {
    const current = await profile(botId); const history = [...(current.stateHistory ?? []), { mainState, sideState, combatSubstate, at: new Date().toISOString(), context: compact(context) }].slice(-80);
    return update(botId, { mainState: validState(mainState), sideState: sideState ? validState(sideState) : null, combatSubstate: combatSubstate ? validState(combatSubstate) : null, stateHistory: history });
  }
  async function record(input) {
    return mutate(async () => {
      const botId = String(input.botId ?? ''); if (!botId) throw new ValidationError('Combat event requires botId');
      const type = String(input.type ?? 'UNKNOWN').toUpperCase(); const delta = scoreDelta(type, input);
      const event = await repositories.events.create({ id: randomUUID(), botId, type, delta, reward: Number(input.reward ?? delta), state: compact(input.state ?? {}), action: String(input.action ?? 'NONE'), outcome: String(input.outcome ?? 'UNKNOWN'), createdAt: new Date().toISOString(), schemaVersion: 1 });
      const current = await profile(botId); const points = Math.max(0, Number(current.combatPoints ?? 0) + delta);
      const saved = await repositories.profiles.update(current.id, normalizeProfile({ ...current, combatPoints: points, combatRank: rankFor(points), updatedAt: new Date().toISOString() }));
      profileCache.set(botId, saved);
      await ml?.recordOutcome?.({ botId, intent: 'combat', success: delta >= 0, durationMs: Number(input.durationMs ?? 0), features: mlFeatures(event), source: 'combat-superior' }).catch(error => logger?.warn?.('combat.ml.record.failed', { botId, error: error.message }));
      await emit('combat.event.recorded', { event, profile: saved }); return { event, profile: structuredClone(saved) };
    });
  }
  async function decide(input) {
    const role = (await profile(input.botId)).combatRole; const mob = String(input.target?.name ?? input.mob ?? 'default').toLowerCase(); const p = MOB_PROFILES[mob] ?? MOB_PROFILES.default;
    const health = Number(input.self?.health ?? 20); const distance = Number(input.target?.distance ?? 99); const inventory = new Set((input.inventory ?? []).map(item => typeof item === 'string' ? item : item.name));
    let action = p.substate;
    if (Boolean(input.self?.onFire) && inventory.has('water_bucket')) action = 'EXTINGUISH';
    else if (health <= 8 && (inventory.has('golden_apple') || inventory.has('splash_potion_of_healing'))) action = 'SURVIVE_HEAL';
    else if (Boolean(input.target?.usingShield) && inventoryHasAxe(inventory)) action = 'SHIELD_BREAK_WITH_AXE';
    else if (distance > 8 && (inventory.has('bow') || inventory.has('crossbow'))) action = 'RANGED_AIM';
    else if (distance > 16 && inventory.has('ender_pearl') && input.world?.pearlSafe === true) action = 'PEARL_CHASE';
    else if (!ROLE_ACTIONS[role].includes(action)) action = ROLE_ACTIONS[role][0];
    return { action, role, mobProfile: mob, desiredDistance: p.desiredDistance, sideState: action === 'SURVIVE_HEAL' || action === 'EXTINGUISH' ? 'SURVIVAL' : 'COMBAT', combatSubstate: action, deterministic: ['EXTINGUISH', 'SURVIVE_HEAL', 'SHIELD_BREAK_WITH_AXE'].includes(action), safety: { avoidFriendlyFire: true, avoidProtectedBuild: true, pearlSafeRequired: true } };
  }
  async function assignFocus({ squadId = 'default', target, botIds = [] }) {
    if (!target?.id) throw new ValidationError('Focus target requires target.id');
    const assignment = { squadId: String(squadId), target: compact(target), botIds: [...new Set(botIds.map(String))].slice(0, 16), assignedAt: new Date().toISOString() };
    squadTargets.set(assignment.squadId, assignment); await emit('combat.focus.assigned', assignment); return assignment;
  }
  async function requestDefense({ botId, attacker, position, radius = 24, maxDefenders = 3 }) {
    const requester = String(botId); const candidates = bots.list().filter(item => item.id !== requester && ['READY', 'ACTIVE'].includes(item.status)).map(item => ({ item, score: defenderScore(profileCache.get(item.id), item, position) })).sort((a,b) => b.score - a.score).slice(0, Math.max(1, Math.min(5, maxDefenders)));
    const defenders = [];
    for (const candidate of candidates) { const p = await profile(candidate.item.id); await transition(candidate.item.id, p.mainState, 'COMBAT_GUARD', 'INTERCEPT', { protect: requester, attacker }); defenders.push({ botId: candidate.item.id, role: p.combatRole }); }
    await emit('combat.defense.requested', { botId: requester, attacker: compact(attacker), position: compact(position), radius, defenders }); return { defenders };
  }
  async function bind(runtime) {
    const botId = runtime.bot.id; if (bindings.has(botId)) return;
    await profile(botId);
    const onHurt = entity => {
      const snapshot = runtime.adapter.snapshot(); if (String(entity?.id) !== String(snapshot.entityId)) return;
      void transition(botId, (profileCache.get(botId)?.mainState ?? 'IDLE'), 'COMBAT', 'UNDER_ATTACK', { entityId: entity.id });
      void requestDefense({ botId, position: snapshot.position, attacker: null }).catch(error => logger?.warn?.('combat.defense.failed', { botId, error: error.message }));
      void record({ botId, type: 'DAMAGE_TAKEN', state: { health: snapshot.health }, action: 'UNDER_ATTACK' });
    };
    const onDeath = () => void record({ botId, type: 'DEATH', action: 'DEATH', outcome: 'FAILED' });
    runtime.adapter.on('entityHurt', onHurt); runtime.adapter.on('death', onDeath);
    bindings.set(botId, () => { runtime.adapter.off('entityHurt', onHurt); runtime.adapter.off('death', onDeath); });
  }
  async function status() {
    const profiles = await Promise.all(bots.list().map(item => profile(item.id))); const eventsLog = await repositories.events.list(); const policies = await repositories.policies.list();
    return { version: '1.1.0', profiles, squadTargets: [...squadTargets.values()], events: eventsLog.slice(-100), policy: policies.find(p => p.status === 'PRODUCTION') ?? { version: 'combat-rules-v1', status: 'SAFE_FALLBACK' }, rl: { mode: 'offline-experience', pythonBridge: 'ml/combat_trainer.py', records: eventsLog.length } };
  }
  async function trainingBatch(limit = 2048) { const records = await repositories.events.list(); return records.slice(-Math.max(1, Math.min(4096, Number(limit) || 2048))).map(item => ({ state: item.state, action: item.action, reward: item.reward, outcome: item.outcome, botId: item.botId, timestamp: item.createdAt })); }
  async function promotePolicy(policy) { if (!policy?.version) throw new ValidationError('Policy version is required'); const row = { id: String(policy.version), version: String(policy.version), status: 'PRODUCTION', metrics: compact(policy.metrics ?? {}), promotedAt: new Date().toISOString(), source: String(policy.source ?? 'python') }; const existing = (await repositories.policies.list()).find(x => x.id === row.id); const saved = existing ? await repositories.policies.update(existing.id, row) : await repositories.policies.create(row); await emit('combat.policy.promoted', saved); return saved; }
  return Object.freeze({ profile, setRole, transition, record, decide, assignFocus, requestDefense, bind, status, trainingBatch, promotePolicy });
}
function defaultProfile(botId) { return normalizeProfile({ id: 'combat:' + botId, botId, combatRole: 'UNASSIGNED', assignedRole: 'UNASSIGNED', combatPoints: 0, combatRank: 'Recruit', mainState: 'IDLE', sideState: null, combatSubstate: null, stateHistory: [], allowedActions: ROLE_ACTIONS.UNASSIGNED, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }
function normalizeProfile(value) { const points = Math.max(0, Number(value.combatPoints ?? 0)); const role = normalizeRole(value.combatRole ?? 'UNASSIGNED'); return { ...value, combatRole: role, assignedRole: normalizeRole(value.assignedRole ?? role), combatPoints: points, combatRank: rankFor(points), mainState: validState(value.mainState ?? 'IDLE'), sideState: value.sideState ? validState(value.sideState) : null, combatSubstate: value.combatSubstate ? validState(value.combatSubstate) : null, allowedActions: ROLE_ACTIONS[role] }; }
function normalizeRole(value) { const role = String(value ?? '').toUpperCase(); if (!COMBAT_ROLES.includes(role)) throw new ValidationError('Combat role must be one of: ' + COMBAT_ROLES.join(', ')); return role; }
function validState(value) { const state = String(value ?? '').toUpperCase(); if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(state)) throw new ValidationError('Combat state is invalid'); return state; }
function rankFor(points) { return [...COMBAT_RANKS].reverse().find(([, threshold]) => points >= threshold)[0]; }
function scoreDelta(type, input) { if (Number.isFinite(Number(input.delta))) return Math.trunc(Number(input.delta)); return ({ KILL:20, DAMAGE_DEALT:Math.max(1, Math.min(5, Number(input.damage ?? 1))), CRITICAL_HIT:5, ALLY_SAVED:10, HEAL_ALLY:12, SQUAD_WIN:25, LOOT_SECURED:2, DAMAGE_TAKEN:-2, FRIENDLY_FIRE:-30, DEATH:-15, RETREAT_IGNORED:-10 }[type] ?? 0); }
function compact(value) { if (!value || typeof value !== 'object') return value ?? null; return JSON.parse(JSON.stringify(value)); }
function inventoryHasAxe(items) { return [...items].some(name => String(name).endsWith('_axe')); }
function mlFeatures(event) { return { action: event.action, outcome: event.outcome, reward: Math.sign(event.reward), type: event.type }; }
function defenderScore(profile, runtime, position) { const role = profile?.combatRole ?? 'UNASSIGNED'; const roleScore = { TANK:100, FLANKER:80, RANGED:75, SUPPORT:55, SCOUT:45, UNASSIGNED:20 }[role]; const pointScore = Math.min(50, Number(profile?.combatPoints ?? 0) / 100); const current = runtime.runtime?.position; const distancePenalty = current && position ? Math.min(60, Math.hypot(current.x-position.x,current.y-position.y,current.z-position.z)) : 20; return roleScore + pointScore - distancePenalty; }