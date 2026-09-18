import { ValidationError } from '../core/errors.js';

export function analyzeHelpTask(task) {
  if (!task || typeof task !== 'object' || !task.id) throw new ValidationError('Help session requires a valid parent task');
  const capability = Array.isArray(task.requiredCapabilities) && task.requiredCapabilities.includes('minecraft.collection');
  const block = String(task.input?.block ?? task.input?.item ?? '').trim().toLowerCase();
  const declaredOutput = Array.isArray(task.resources?.outputs) ? task.resources.outputs.find(entry => entry?.item) : null;
  const item = String(declaredOutput?.item ?? task.input?.item ?? block).trim().toLowerCase();
  const target = Number(task.input?.count);
  if (!capability || !block || !item || !Number.isInteger(target) || target < 1) throw new ValidationError(`Parent task '${task.id}' is not a supported collection task`);
  const collectionPolicy = Object.fromEntries(['strategy','combatEscort','avoidStripMining','groupAnchor','maximumGroupDistance','maxDistance','minY','maxY','maxDescend'].filter(key => task.input?.[key] !== undefined).map(key => [key, task.input[key]]));
  return Object.freeze({ helpable: true, helpMode: 'RESOURCE_COLLECTION', progressMetric: 'VERIFIED_DELIVERY', splitUnit: 'ITEM', completionPolicy: 'CREDITED_OUTPUT', block, item, target, collectionPolicy });
}
