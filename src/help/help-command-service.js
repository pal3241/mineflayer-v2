import { ConflictError } from '../core/errors.js';
import { resolveActiveHelpTask } from './active-task-resolver.js';
import { validateHelper } from './helper-validator.js';
import { presentHelperStatus, presentHelpSession } from './help-chat-presenter.js';

export function createHelpCommandService({ help, goals, bots, events, maxHelpersPerSession, minimumChunk }) {
  const settings = { maxHelpersPerSession, minimumChunk };
  const requestHelp = async ({ helperBotId, ownerBotId }) => {
    await publish(events, 'help.command.requested', { helperBotId, ownerBotId }); const existing = await help.activeForOwner(ownerBotId);
    if (existing) { await validateJoin(existing, helperBotId); const joined = await help.join({ sessionId: existing.id, botId: helperBotId }); await publish(events, 'help.command.accepted', { sessionId: joined.id, helperBotId, ownerBotId }); return joined; }
    const parent = resolveActiveHelpTask(goals, ownerBotId); const preview = { ownerBotId, outputPolicy: { mode: 'OWNER', targetBotId: ownerBotId }, goal: { item: parent.input.item ?? parent.input.block, target: parent.input.count }, progress: { remaining: parent.input.count }, workShares: [] }; await validateJoin(preview, helperBotId); const created = await help.create({ parentTaskId: parent.id, ownerBotId, workers: [ownerBotId, helperBotId] }); await goals.transitionTaskToCollaborative(parent.id, created.id); await publish(events, 'help.parent.collaborative', { sessionId: created.id, parentTaskId: parent.id }); await publish(events, 'help.command.accepted', { sessionId: created.id, helperBotId, ownerBotId }); return created;
  };
  const addHelpers = async ({ ownerBotId, helperBotIds }) => { if (!Array.isArray(helperBotIds) || !helperBotIds.length) throw new ConflictError('At least one helper is required'); let session = await help.activeForOwner(ownerBotId); if (!session) { const [first, ...rest] = helperBotIds; session = await requestHelp({ helperBotId: first, ownerBotId }); if (!rest.length) return session; helperBotIds = rest; }
    for (const helperBotId of helperBotIds) await validateJoin(session, helperBotId); const joined = await help.joinMany({ sessionId: session.id, botIds: helperBotIds }); await publish(events, 'help.command.accepted', { sessionId: joined.id, helperBotIds, ownerBotId }); return joined; };
  const joinSession = async ({ sessionId, botId }) => { const session = await help.get(sessionId); await validateJoin(session, botId); return help.join({ sessionId, botId }); };
  const joinManySession = async ({ sessionId, botIds }) => { const session = await help.get(sessionId); const preview = { ...session, workShares: [...session.workShares] }; for (const botId of botIds) { await validateJoin(preview, botId); preview.workShares.push({ botId, role: 'HELPER' }); } return help.joinMany({ sessionId, botIds }); };
  const stopHelping = async ({ botId }) => { const session = (await help.list()).find(entry => entry.workShares.some(share => share.botId === botId && !['SUPERSEDED', 'CANCELLED'].includes(share.status))); if (!session) throw new ConflictError(`No active help session for '${botId}'`); const left = await help.leave({ sessionId: session.id, botId, reason: 'HELPER_STOPPED' }); await publish(events, 'help.command.completed', { sessionId: session.id, botId, action: 'STOP_HELP' }); return left; };
  const removeHelper = async ({ ownerBotId, helperBotId }) => { const session = await help.activeForOwner(ownerBotId); if (!session) throw new ConflictError(`No active help session for '${ownerBotId}'`); const left = await help.leave({ sessionId: session.id, botId: helperBotId, reason: 'OWNER_REMOVED' }); await publish(events, 'help.command.completed', { sessionId: session.id, botId: helperBotId, action: 'REMOVE_HELPER' }); return left; };
  const status = async ({ botId }) => presentHelperStatus((await help.list()).find(session => session.workShares.some(share => share.botId === botId)) ?? { workShares: [] }, botId);
  const helpers = async ({ ownerBotId }) => { const session = await help.activeForOwner(ownerBotId); return session ? presentHelpSession(session) : `[Help] ${ownerBotId} has no active helpers`; };
  async function validateJoin(session, helperBotId) { const remaining = session.id ? await help.remaining(session.id) : session.progress.remaining; return validateHelper({ bots, helperBotId, ownerBotId: session.ownerBotId, activeShares: session.workShares, maxHelpers: settings.maxHelpersPerSession, minimumChunk: settings.minimumChunk, remaining }); }
  return Object.freeze({ requestHelp, addHelpers, joinSession, joinManySession, stopHelping, removeHelper, status, helpers });
}

async function publish(events, type, payload) { await events?.publish(type, payload, { source: 'help-command' }); }
