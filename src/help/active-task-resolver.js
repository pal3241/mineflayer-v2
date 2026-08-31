import { ConflictError } from '../core/errors.js';
import { analyzeHelpTask } from './task-analyzer.js';

const ORDER = new Map([['RUNNING', 0], ['ASSIGNED', 1], ['READY', 2]]);

export function resolveActiveHelpTask(goals, ownerBotId) {
  const active = goals.allTasks().filter(task => task.assignedBot === ownerBotId && ORDER.has(task.status)); const analyzed = active.map(task => analyzeCandidate(goals, task)); const candidates = analyzed.filter(result => result.helpable).map(result => result.task).sort((left, right) => ORDER.get(left.status) - ORDER.get(right.status) || right.priority - left.priority || left.createdAt.localeCompare(right.createdAt));
  if (!candidates.length) throw new ConflictError(`NO_HELPABLE_TASK for owner '${ownerBotId}'`, { code: 'NO_HELPABLE_TASK', ownerBotId, rejected: analyzed.map(result => ({ taskId: result.task.id, reason: result.reason })) });
  return goals.task(candidates[0].id);
}

function analyzeCandidate(goals, task) { try { analyzeHelpTask(goals.task(task.id)); return { task, helpable: true, reason: null }; } catch (error) { return { task, helpable: false, reason: error.message }; } }
