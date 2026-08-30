import { ConflictError } from '../core/errors.js';
import { analyzeHelpTask } from './task-analyzer.js';

const ORDER = new Map([['RUNNING', 0], ['ASSIGNED', 1], ['READY', 2]]);

export function resolveActiveHelpTask(goals, ownerBotId) {
  const candidates = goals.allTasks().filter(task => task.assignedBot === ownerBotId && ORDER.has(task.status)).sort((left, right) => ORDER.get(left.status) - ORDER.get(right.status) || right.priority - left.priority || left.createdAt.localeCompare(right.createdAt));
  if (!candidates.length) throw new ConflictError(`NO_HELPABLE_TASK for owner '${ownerBotId}'`, { code: 'NO_HELPABLE_TASK', ownerBotId });
  const task = goals.task(candidates[0].id);
  try { analyzeHelpTask(task); } catch (error) { throw new ConflictError(`TASK_NOT_HELPABLE '${task.id}'`, { code: 'TASK_NOT_HELPABLE', taskId: task.id, cause: error.message }); }
  return task;
}
