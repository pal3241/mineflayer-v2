import { ConflictError, NotFoundError } from '../core/errors.js';

export function validateHelper({ bots, goals, helperBotId, ownerBotId, activeShares, maxHelpers, minimumChunk, remaining }) {
  if (helperBotId === ownerBotId) throw new ConflictError('ALREADY_HELPING owner is already a worker', { code: 'ALREADY_HELPING' });
  let helper; let owner;
  try { helper = bots.get(helperBotId); owner = bots.get(ownerBotId); } catch (error) { if (error instanceof NotFoundError) throw new ConflictError(`HELPER_NOT_FOUND '${helperBotId}'`, { code: 'HELPER_NOT_FOUND', helperBotId }); throw error; }
  const helperStatus = helper.snapshot?.().status ?? helper.status; if (!['READY', 'ACTIVE'].includes(helperStatus)) throw new ConflictError(`HELPER_BUSY '${helperBotId}'`, { code: 'HELPER_BUSY', helperBotId, status: helperStatus });
  const busyTask = criticalTaskFor(goals, helperBotId); if (busyTask) throw new ConflictError(`HELPER_BUSY '${helperBotId}' is executing ${busyTask.busyState}`, { code: 'HELPER_BUSY', helperBotId, busyState: busyTask.busyState, taskId: busyTask.id });
  const helperScope = scope(helper); const ownerScope = scope(owner); if (helperScope.host !== ownerScope.host || helperScope.port !== ownerScope.port || helperScope.dimension !== ownerScope.dimension) throw new ConflictError(`HELPER_SCOPE_MISMATCH '${helperBotId}'`, { code: 'HELPER_SCOPE_MISMATCH', helperBotId });
  if (activeShares.some(share => share.botId === helperBotId)) throw new ConflictError(`ALREADY_HELPING '${helperBotId}'`, { code: 'ALREADY_HELPING', helperBotId });
  const helpers = new Set(activeShares.filter(share => share.role === 'HELPER').map(share => share.botId)); if (helpers.size >= maxHelpers) throw new ConflictError(`MAX_HELPERS_REACHED ${maxHelpers}`, { code: 'MAX_HELPERS_REACHED', maxHelpers });
  if (Math.floor(remaining / (helpers.size + 2)) < minimumChunk) throw new ConflictError(`Minimum work chunk is ${minimumChunk}`, { code: 'MINIMUM_CHUNK', minimumChunk });
  return helper;
}

function scope(runtime) { const snapshot = runtime.adapter.snapshot(); return { host: String(runtime.options?.host ?? 'localhost').toLowerCase(), port: Number(runtime.options?.port ?? 25565), dimension: String(snapshot.dimension ?? 'overworld') }; }
function criticalTaskFor(goals, helperBotId) { if (typeof goals?.allTasks !== 'function') return null; return goals.allTasks().filter(task => task.assignedBot === helperBotId && ['ASSIGNED', 'RUNNING'].includes(task.status)).map(task => ({ ...task, busyState: busyState(task) })).find(task => task.busyState) ?? null; }
function busyState(task) { const declared = String(task.input?.priorityClass ?? task.input?.mode ?? task.type ?? '').trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_'); if (task.input?.userCritical === true || declared === 'USER_CRITICAL_TASK') return 'USER_CRITICAL_TASK'; if (declared.includes('EMERGENCY')) return 'EMERGENCY'; if (declared.includes('RECOVERY')) return 'RECOVERY'; if (declared.includes('CRITICAL_COMBAT') || declared.includes('COMBAT') && (task.input?.critical === true || task.priority >= 90)) return 'CRITICAL_COMBAT'; return null; }
