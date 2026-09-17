import { randomUUID } from 'node:crypto';
import { ValidationError, NotFoundError } from '../core/errors.js';
import { createCombatNeuralPolicy } from './combat-neural-policy.js';

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

export function createCombatService({ repositories, events, bots, ml, threats = null, logger } = {}) {
  if (!repositories?.profiles || !repositories?.events || !repositories?.policies) throw new ValidationError('Combat repositories are required');
  const doctrineRepository = repositories.doctrines ?? repositories.policies;
  const profileCache = new Map(); const squadTargets = new Map(); const bindings = new Map(); const runtimes = new Map(); const neural = createCombatNeuralPolicy(); let queue = Promise.resolve();
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
      neural.observe({ state: event.state, action: event.action, reward: event.reward });
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
    const doctrines = await doctrineRepository.list(); const guidance = doctrines.filter(item => item.status === 'APPROVED' && doctrineMatches(item, { mob, role, action })).sort((a, b) => Number(b.confidence) - Number(a.confidence)).slice(0, 3);
    const neuralAdvice = neural.recommend({ health, distance, mob, role, onFire: Boolean(input.self?.onFire), inventory: [...inventory] }, action);
    return { action, neuralAdvice, role, mobProfile: mob, desiredDistance: p.desiredDistance, sideState: action === 'SURVIVE_HEAL' || action === 'EXTINGUISH' ? 'SURVIVAL' : 'COMBAT', combatSubstate: action, deterministic: ['EXTINGUISH', 'SURVIVE_HEAL', 'SHIELD_BREAK_WITH_AXE'].includes(action), safety: { avoidFriendlyFire: true, avoidProtectedBuild: true, pearlSafeRequired: true }, doctrine: guidance.map(item => ({ id: item.id, title: item.title, techniques: item.techniques, confidence: item.confidence })) };
  }
  async function engage({ botId, mode = 'full_combat', position, radius = 16 } = {}) {
    const runtime = runtimes.get(String(botId)); if (!runtime?.adapter) throw new NotFoundError(`Combat runtime '${botId}' is not connected`);
    const snapshot = runtime.adapter.snapshot?.() ?? {}; const profileValue = await profile(botId);
    const anchor = position ?? snapshot.position; if (!anchor) throw new ValidationError('Combat engagement needs a known bot position');
    const started = await runtime.adapter.startCombat({ mode, position: anchor, radius, role: profileValue.combatRole });
    await transition(botId, profileValue.mainState, 'COMBAT', 'ENGAGED', { mode, anchor, radius });
    await record({ botId, type: 'ENGAGEMENT_STARTED', action: 'ENGAGE', outcome: 'ACTIVE', state: { health: snapshot.health ?? 20 } });
    return { ...started, botId: String(botId), mode: String(mode).toUpperCase(), anchor };
  }
  async function stopEngagement(botId) {
    const runtime = runtimes.get(String(botId)); if (!runtime?.adapter) throw new NotFoundError(`Combat runtime '${botId}' is not connected`);
    const result = await runtime.adapter.stopCombat(); const current = await profile(botId);
    await transition(botId, current.mainState, null, null, { reason: 'owner-stop' });
    return { ...result, botId: String(botId) };
  }
  async function protect({ protectorId, wardId, radius = 16 } = {}) {
    const wardRuntime = runtimes.get(String(wardId)); if (!wardRuntime?.adapter) throw new NotFoundError(`Protected bot '${wardId}' is not connected`);
    const wardSnapshot = wardRuntime.adapter.snapshot?.() ?? {}; if (!wardSnapshot.position) throw new ValidationError('Protected bot has no known position');
    const result = await engage({ botId: protectorId, mode: 'guard', position: wardSnapshot.position, radius });
    const protector = await profile(protectorId); const ward = await profile(wardId);
    await transition(protectorId, protector.mainState, 'COMBAT_GUARD', 'PROTECTING_ALLY', { wardId: String(wardId), radius });
    await transition(wardId, ward.mainState, 'PROTECTED', 'ESCORTED', { protectorId: String(protectorId) });
    await record({ botId: protectorId, type: 'ALLY_SAVED', action: 'PROTECT', outcome: 'ACTIVE', state: { wardId: String(wardId) } });
    return { protectorId: String(protectorId), wardId: String(wardId), radius: Number(radius), engagement: result };
  }
  async function assignFocus({ squadId = 'default', target, botIds = [] }) {
    if (!target?.id) throw new ValidationError('Focus target requires target.id');
    const assignment = { squadId: String(squadId), target: compact(target), botIds: [...new Set(botIds.map(String))].slice(0, 16), assignedAt: new Date().toISOString() };
    squadTargets.set(assignment.squadId, assignment); await emit('combat.focus.assigned', assignment); return assignment;
  }
  async function requestDefense({ botId, attacker, position, radius = 24, maxDefenders = 3 }) {
    const requester = String(botId); const candidates = bots.list().filter(item => item.id !== requester && ['READY', 'ACTIVE'].includes(item.status)).map(item => ({ item, score: defenderScore(profileCache.get(item.id), item, position) })).sort((a,b) => b.score - a.score).slice(0, Math.max(1, Math.min(5, maxDefenders)));
    const defenders = [];
    for (const candidate of candidates) {
      const p = await profile(candidate.item.id);
      await transition(candidate.item.id, p.mainState, 'COMBAT_GUARD', 'INTERCEPT', { protect: requester, attacker });
      try { await engage({ botId: candidate.item.id, mode: 'guard', position, radius }); defenders.push({ botId: candidate.item.id, role: p.combatRole, engaged: true }); }
      catch (error) { logger?.warn?.('combat.defender.engage.failed', { botId: candidate.item.id, error: error.message }); defenders.push({ botId: candidate.item.id, role: p.combatRole, engaged: false }); }
    }
    await emit('combat.defense.requested', { botId: requester, attacker: compact(attacker), position: compact(position), radius, defenders }); return { defenders };
  }
  async function bind(runtime) {
    const botId = runtime.bot.id; if (bindings.has(botId)) return;
    await profile(botId); runtimes.set(botId, runtime); let lastAutoDefenseAt = 0; let lastThreatAt = 0;
    const onHurt = entity => {
      const snapshot = runtime.adapter.snapshot(); if (String(entity?.id) !== String(snapshot.entityId)) return;
      const now = Date.now(); const combatAlreadyActive = runtime.adapter.combatState?.status === 'ACTIVE';
      void transition(botId, (profileCache.get(botId)?.mainState ?? 'IDLE'), 'COMBAT', 'UNDER_ATTACK', { entityId: entity.id });
      void requestDefense({ botId, position: snapshot.position, attacker: null }).catch(error => logger?.warn?.('combat.defense.failed', { botId, error: error.message }));
      void record({ botId, type: 'DAMAGE_TAKEN', state: { health: snapshot.health }, action: 'UNDER_ATTACK' });
      if (threats?.detect && snapshot.position && now - lastThreatAt >= 5_000) {
        lastThreatAt = now;
        void observeRuntimeThreat({ threats, runtime, bots, snapshot }).catch(error => logger?.warn?.('combat.threat-record.failed', { botId, error: error.message }));
      }
      // A Mineflayer entityHurt event has no attacker reference. Guarding the bot's
      // current position makes it acquire the nearest hostile that can hit it.
      if (!combatAlreadyActive && now - lastAutoDefenseAt >= 2_000 && typeof runtime.adapter.startCombat === 'function') {
        lastAutoDefenseAt = now;
        const role = profileCache.get(botId)?.combatRole ?? 'UNASSIGNED';
        void runtime.adapter.startCombat({ mode: 'guard', position: snapshot.position, radius: 16, role })
          .then(() => transition(botId, (profileCache.get(botId)?.mainState ?? 'IDLE'), 'COMBAT', 'AUTO_GUARD', { trigger: 'damage-taken', radius: 16 }))
          .catch(error => logger?.warn?.('combat.auto-defense.failed', { botId, error: error.message }));
      }
    };
    const onDeath = () => void record({ botId, type: 'DEATH', action: 'DEATH', outcome: 'FAILED' });
    runtime.adapter.on('entityHurt', onHurt); runtime.adapter.on('death', onDeath);
    bindings.set(botId, () => { runtimes.delete(botId); runtime.adapter.off('entityHurt', onHurt); runtime.adapter.off('death', onDeath); });
  }
  async function ingestDoctrine(input = {}) {
    const text = String(input.text ?? '').trim(); if (text.length < 12 || text.length > 20_000) throw new ValidationError('Combat doctrine text must be 12 to 20000 characters');
    const title = String(input.title ?? 'Imported PvP technique').trim().slice(0, 120) || 'Imported PvP technique'; const techniques = extractTechniques(text);
    if (!techniques.length) throw new ValidationError('No supported combat technique was found in this text');
    const record = { id: 'doctrine:' + randomUUID(), title, source: String(input.source ?? 'owner-text').slice(0, 80), text, techniques, confidence: Math.max(0.3, Math.min(0.85, Number(input.confidence ?? 0.65))), status: 'APPROVED', learnedAt: new Date().toISOString(), schemaVersion: 1 };
    const saved = await doctrineRepository.create(record); await emit('combat.doctrine.learned', { doctrine: saved }); return saved;
  }
  async function doctrines() { return (await doctrineRepository.list()).filter(item => String(item.id).startsWith('doctrine:')).sort((a,b) => String(b.learnedAt).localeCompare(String(a.learnedAt))); }
  async function status() {
    const profiles = await Promise.all(bots.list().map(item => profile(item.id))); const eventsLog = await repositories.events.list(); const policies = await repositories.policies.list(); const doctrineList = await doctrines();
    return { version: '1.1.1', profiles, squadTargets: [...squadTargets.values()], events: eventsLog.slice(-100), policy: policies.find(p => p.status === 'PRODUCTION') ?? { version: 'combat-rules-v1', status: 'SAFE_FALLBACK' }, rl: { mode: 'online-neural-policy', pythonBridge: 'ml/combat_trainer.py', records: eventsLog.length, doctrines: doctrineList.length, neural: neural.status() }, doctrines: doctrineList };
  }
  async function trainingBatch(limit = 2048) { const records = await repositories.events.list(); return records.slice(-Math.max(1, Math.min(4096, Number(limit) || 2048))).map(item => ({ state: item.state, action: item.action, reward: item.reward, outcome: item.outcome, botId: item.botId, timestamp: item.createdAt })); }
  async function promotePolicy(policy) { if (!policy?.version) throw new ValidationError('Policy version is required'); const row = { id: String(policy.version), version: String(policy.version), status: 'PRODUCTION', metrics: compact(policy.metrics ?? {}), promotedAt: new Date().toISOString(), source: String(policy.source ?? 'python') }; const existing = (await repositories.policies.list()).find(x => x.id === row.id); const saved = existing ? await repositories.policies.update(existing.id, row) : await repositories.policies.create(row); await emit('combat.policy.promoted', saved); return saved; }
  return Object.freeze({ profile, setRole, transition, record, decide, engage, stopEngagement, protect, assignFocus, requestDefense, bind, status, trainingBatch, promotePolicy, ingestDoctrine, doctrines });
}
async function observeRuntimeThreat({ threats, runtime, bots, snapshot }) { const survival=runtime.adapter.survivalStatus?.()??{};const inventory=snapshot.inventorySummary??survival.inventory??[];const names=inventory.map(item=>String(item.name??item));const home=snapshot.home;const position=snapshot.position;return threats.detect({entityType:'unknown_hostile',distance:4,botHealth:Number(snapshot.health??survival.health??20),armor:Math.min(1,names.filter(name=>/_(helmet|chestplate|leggings|boots)$/.test(name)).length/4),weapon:names.some(name=>/(sword|axe|bow|crossbow|trident)$/.test(name))?1:0,enemyCount:Math.max(1,Number(survival.hostileCount??1)),time:survival.isNight?'NIGHT':'DAY',nearbyFriendlyBots:Math.max(0,bots.list().filter(bot=>bot.id!==runtime.bot.id&&['READY','ACTIVE'].includes(bot.status)).length),distanceFromBase:home?distance(position,home):65,escapeRoute:Number(snapshot.health??20)>6,missionImportance:.5,worldKey:`${runtime.options?.host??'unknown'}:${runtime.options?.port??25565}`,dimension:String(snapshot.dimension??survival.dimension??'overworld').replace(/^minecraft:/,''),position,sourceBotId:runtime.bot.id}); }
function distance(left,right){return Math.hypot(Number(left.x)-Number(right.x),Number(left.y)-Number(right.y),Number(left.z)-Number(right.z));}
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
function extractTechniques(text) {
  const lower = text.toLowerCase(); const found = [];
  const add = (id, action, when, keywords) => { if (keywords.some(word => lower.includes(word))) found.push({ id, action, when, evidence: keywords.filter(word => lower.includes(word)) }); };
  add('bow-spacing', 'RANGED_AIM', 'target distance > 8', ['bow', 'busur', 'crossbow', 'panah']);
  add('shield-break', 'SHIELD_BREAK_WITH_AXE', 'enemy using shield', ['shield', 'perisai', 'axe', 'kapak']);
  add('heal-threshold', 'SURVIVE_HEAL', 'low health', ['golden apple', 'gap', 'healing', 'potion', 'hp rendah']);
  add('skeleton-strafe', 'DIAGONAL_STRAFE', 'skeleton ranged attack', ['skeleton', 'strafe', 'diagonal']);
  add('creeper-reset', 'HIT_RETREAT_FUSE', 'creeper fuse', ['creeper', 'fuse', 'hissing']);
  add('knockback-loop', 'KNOCKBACK_LOOP', 'slow melee mob', ['knockback', 'zombie', 'husk']);
  add('retreat-discipline', 'RETREAT', 'outnumbered or unsafe', ['retreat', 'mundur', 'kabur', 'low health']);
  return [...new Map(found.map(item => [item.id, item])).values()];
}
function doctrineMatches(doctrine, context) { return doctrine.techniques?.some(item => item.action === context.action || (context.mob === 'skeleton' && item.id === 'skeleton-strafe') || (context.mob === 'creeper' && item.id === 'creeper-reset')); }
