import { ValidationError } from '../core/errors.js';

export function analyzeHelpTask(task) {
  if (!task || typeof task !== 'object' || !task.id) throw new ValidationError('Help session requires a valid parent task');
  const capability = Array.isArray(task.requiredCapabilities) && task.requiredCapabilities.includes('minecraft.collection');
  const item = String(task.input?.item ?? task.input?.block ?? '').trim().toLowerCase();
  const target = Number(task.input?.count);
  if (!capability || !item || !Number.isInteger(target) || target < 1) throw new ValidationError(`Parent task '${task.id}' is not a supported collection task`);
  return Object.freeze({ helpable: true, helpMode: 'RESOURCE_COLLECTION', progressMetric: 'VERIFIED_DELIVERY', splitUnit: 'ITEM', completionPolicy: 'CREDITED_OUTPUT', item, target });
}
