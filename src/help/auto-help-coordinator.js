import { ValidationError } from '../core/errors.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const EXECUTABLE = new Set(['ASSIGNED', 'REASSIGN_REQUIRED', 'PARTIAL']);

export function createAutoHelpCoordinator({ help, goals, bots, events, earlyGame = null, fleetTransfer = null, logger = null, config = {} }) {
  if (!help || !goals || !bots || !events) throw new ValidationError('Auto-help coordinator requires help, goals, bots, and events');
  const policy = normalize(config); const activeParents = new Set(); let disposed = false;

  const handle = async task => {
    if (disposed || !policy.enabled || !helpable(task) || Number(task.input?.count ?? 0) < policy.minimumTaskCount || activeParents.has(task.id)) return null;
    const group = await resolveGroup({ task, bots, goals, earlyGame, fleetTransfer, policy });
    if (group.helpers.length < 1) return null;
    activeParents.add(task.id);
    let session = null;
    try {
      session = await help.create({ parentTaskId: task.id, ownerBotId: task.assignedBot, workers: [task.assignedBot, ...group.helpers], outputPolicy: { mode: 'OWNER', targetBotId: task.assignedBot } });
      await goals.transitionTaskToCollaborative(task.id, session.id);
      await events.publish('help.auto.started', { sessionId: session.id, parentTaskId: task.id, ownerBotId: task.assignedBot, helperBotIds: group.helpers, group: group.key }, { source: 'auto-help', correlationId: task.goalId });
      await runSession({ sessionId: session.id, help, events, logger });
      const completed = await help.get(session.id);
      await events.publish('help.auto.completed', { sessionId: session.id, parentTaskId: task.id, status: completed.status, progress: completed.progress }, { source: 'auto-help', correlationId: task.goalId });
      return completed;
    } catch (error) {
      if (session) await help.cancel(session.id, `Automatic help failed: ${error.message}`).catch(() => {});
      await events.publish('help.auto.failed', { sessionId: session?.id ?? null, parentTaskId: task.id, error: { code: error.code ?? 'AUTO_HELP_FAILED', message: error.message } }, { source: 'auto-help', correlationId: task.goalId });
      logger?.warn?.('help.auto.failed', { parentTaskId: task.id, error: error.message }); return null;
    } finally { activeParents.delete(task.id); }
  };

  const unsubscribe = events.subscribe('task.started', event => { void handle(event.payload); });
  return Object.freeze({ handle, status: () => ({ status: policy.enabled ? 'HEALTHY' : 'DISABLED', enabled: policy.enabled, activeParents: [...activeParents], policy: { ...policy } }), dispose: () => { disposed = true; unsubscribe(); } });
}

async function runSession({ sessionId, help, events, logger }) {
  const initial = await help.get(sessionId); const workers = [...new Set(initial.workShares.map(share => share.botId))];
  await Promise.all(workers.map(botId => runWorker({ sessionId, botId, help, events, logger })));
}

async function runWorker({ sessionId, botId, help, events, logger }) {
  for (let batch = 0; batch < 256; batch++) {
    const session = await help.get(sessionId); if (TERMINAL.has(session.status)) return;
    const share = [...session.workShares].reverse().find(item => item.botId === botId && EXECUTABLE.has(item.status)); if (!share) return;
    try {
      await help.executeShare({ sessionId, shareId: share.shareId });
      const refreshed = await help.get(sessionId); const output = refreshed.workShares.find(item => item.shareId === share.shareId);
      if (output && output.completed > output.delivered) await help.handoff({ sessionId, shareId: output.shareId });
    } catch (error) {
      await events.publish('help.auto.worker-failed', { sessionId, shareId: share.shareId, botId, error: { code: error.code ?? 'AUTO_HELP_WORKER_FAILED', message: error.message } }, { source: 'auto-help', correlationId: session.parentGoalId });
      logger?.warn?.('help.auto.worker-failed', { sessionId, botId, error: error.message }); return;
    }
  }
}

async function resolveGroup({ task, bots, goals, earlyGame, fleetTransfer, policy }) {
  const owner = bots.get(task.assignedBot); const ownerDescriptor = bots.list().find(item => item.id === task.assignedBot); const ownerPosition = owner.adapter.snapshot().position;
  const early = earlyGame?.group?.(); const earlyMembers = early?.active && early.memberBotIds.includes(task.assignedBot) ? new Set(early.memberBotIds) : null;
  const metadata = ownerDescriptor?.metadata ?? owner.bot?.metadata ?? {}; const metadataKey = String(metadata.groupId ?? metadata.group ?? metadata.className ?? '').trim().toLowerCase();
  if (!earlyMembers && !metadataKey) return { key: null, helpers: [] };
  const busy = new Set(goals.allTasks().filter(item => item.id !== task.id && ['ASSIGNED', 'RUNNING', 'COLLABORATIVE'].includes(item.status)).map(item => item.assignedBot));
  const candidates = [];
  for (const descriptor of bots.list()) {
    if (descriptor.id === task.assignedBot || !['READY', 'ACTIVE'].includes(descriptor.status) || busy.has(descriptor.id)) continue;
    if (earlyMembers ? !earlyMembers.has(descriptor.id) : groupKey(descriptor) !== metadataKey) continue;
    const runtime = bots.get(descriptor.id); if (!sameScope(owner, runtime)) continue;
    const position = runtime.adapter.snapshot().position; if (!ownerPosition || !position || distance(ownerPosition, position) > (earlyMembers ? early.leashMaximum : policy.maximumDistance)) continue;
    const reliability = await fleetTransfer?.reliability?.(descriptor.id); if (reliability && reliability.score < policy.minimumReliability) continue;
    candidates.push({ id: descriptor.id, distance: distance(ownerPosition, position), reliability: reliability?.score ?? 100 });
  }
  candidates.sort((left, right) => right.reliability - left.reliability || left.distance - right.distance || left.id.localeCompare(right.id));
  return { key: earlyMembers ? `early-game:${early.leaderBotId}` : `metadata:${metadataKey}`, helpers: candidates.slice(0, policy.maximumHelpers).map(item => item.id) };
}

function helpable(task) { return task?.type !== 'help-collection' && Array.isArray(task?.requiredCapabilities) && task.requiredCapabilities.includes('minecraft.collection') && Boolean(task.assignedBot) && Boolean(String(task.input?.item ?? task.input?.block ?? '').trim()) && Number.isInteger(Number(task.input?.count)) && Number(task.input.count) > 0; }
function normalize(value) { const policy = { enabled: value.enabled ?? true, minimumTaskCount: Number(value.minimumTaskCount ?? 8), maximumHelpers: Number(value.maximumHelpers ?? 4), maximumDistance: Number(value.maximumDistance ?? 15), minimumReliability: Number(value.minimumReliability ?? 40) }; if (!Number.isInteger(policy.minimumTaskCount) || policy.minimumTaskCount < 2 || !Number.isInteger(policy.maximumHelpers) || policy.maximumHelpers < 1 || policy.maximumHelpers > 8 || !Number.isFinite(policy.maximumDistance) || policy.maximumDistance < 1 || policy.maximumDistance > 64 || !Number.isFinite(policy.minimumReliability) || policy.minimumReliability < 0 || policy.minimumReliability > 100) throw new ValidationError('Invalid automatic help policy'); return Object.freeze(policy); }
function groupKey(descriptor) { const metadata = descriptor.metadata ?? {}; return String(metadata.groupId ?? metadata.group ?? metadata.className ?? '').trim().toLowerCase(); }
function sameScope(left, right) { const a = left.adapter.snapshot(), b = right.adapter.snapshot(); return String(left.options?.host ?? 'localhost').toLowerCase() === String(right.options?.host ?? 'localhost').toLowerCase() && Number(left.options?.port ?? 25565) === Number(right.options?.port ?? 25565) && String(a.dimension ?? 'overworld') === String(b.dimension ?? 'overworld'); }
function distance(left, right) { return Math.hypot(Number(left.x) - Number(right.x), Number(left.y) - Number(right.y), Number(left.z) - Number(right.z)); }
