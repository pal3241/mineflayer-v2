import { ValidationError } from '../../core/errors.js';
import { nonNegativeInteger, normalizeEvaluatedItem, normalizeInventory, requiredRecord, strictBoolean } from './recovery-schema.js';

export function verifyRecovery(input) {
  const source = requiredRecord(input, 'Recovery verification input');
  if (!Array.isArray(source.expectedItems)) throw new ValidationError('Recovery verification expectedItems must be an array');
  const expectedItems = source.expectedItems.map((item, index) => normalizeEvaluatedItem(item, `Recovery verification expectedItems[${index}]`));
  if (!expectedItems.some(item => item.decision === 'REQUIRED')) throw new ValidationError('Recovery verification requires at least one REQUIRED item');
  const before = inventoryCounts(normalizeInventory(source.beforeInventory, 'Recovery verification beforeInventory'));
  const after = inventoryCounts(normalizeInventory(source.afterInventory, 'Recovery verification afterInventory'));
  const items = Object.freeze(expectedItems.map(item => verifyItem(item, before, after)));
  const missingRequired = Object.freeze(items.filter(item => item.decision === 'REQUIRED' && item.missingCount > 0));
  const missingOptional = Object.freeze(items.filter(item => item.decision === 'OPTIONAL' && item.missingCount > 0));
  const recoveredItems = items.reduce((sum, item) => sum + item.recoveredCount, 0);
  const ignoredItems = items.filter(item => item.decision === 'IGNORE').reduce((sum, item) => sum + item.count, 0);
  const verified = missingRequired.length === 0;
  return Object.freeze({
    status: verified ? 'RECOVERED' : 'PARTIAL_RECOVERY',
    verified,
    items,
    missingRequired,
    missingOptional,
    recoveredItems,
    ignoredItems
  });
}

export function inventoryDelta(input) {
  const source = requiredRecord(input, 'Inventory delta input');
  const before = inventoryCounts(normalizeInventory(source.beforeInventory, 'Inventory delta beforeInventory'));
  const after = inventoryCounts(normalizeInventory(source.afterInventory, 'Inventory delta afterInventory'));
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  return Object.freeze(keys.map(key => {
    const beforeCount = before.get(key)?.count ?? 0;
    const afterCount = after.get(key)?.count ?? 0;
    const item = after.get(key)?.item ?? before.get(key).item;
    return Object.freeze({ ...item, beforeCount, afterCount, delta: afterCount - beforeCount });
  }));
}

export function validateRecoveryVerification(input) {
  const source = requiredRecord(input, 'Recovery verification');
  if (!Array.isArray(source.items)) throw new ValidationError('Recovery verification items must be an array');
  const items = Object.freeze(source.items.map((item, index) => {
    const record = requiredRecord(item, `Recovery verification items[${index}]`);
    const expected = normalizeEvaluatedItem(record, `Recovery verification items[${index}]`);
    const beforeCount = nonNegativeInteger(record.beforeCount, `Recovery verification items[${index}].beforeCount`);
    const afterCount = nonNegativeInteger(record.afterCount, `Recovery verification items[${index}].afterCount`);
    const inventoryIncrease = nonNegativeInteger(record.inventoryIncrease, `Recovery verification items[${index}].inventoryIncrease`);
    const recoveredCount = nonNegativeInteger(record.recoveredCount, `Recovery verification items[${index}].recoveredCount`);
    const missingCount = nonNegativeInteger(record.missingCount, `Recovery verification items[${index}].missingCount`);
    const verified = strictBoolean(record.verified, `Recovery verification items[${index}].verified`);
    const calculatedIncrease = Math.max(0, afterCount - beforeCount);
    const calculatedRecovered = expected.decision === 'IGNORE' ? 0 : Math.min(expected.count, calculatedIncrease);
    const calculatedMissing = expected.decision === 'IGNORE' ? 0 : expected.count - calculatedRecovered;
    if (inventoryIncrease !== calculatedIncrease || recoveredCount !== calculatedRecovered || missingCount !== calculatedMissing || verified !== (expected.decision === 'IGNORE' || calculatedMissing === 0)) throw new ValidationError(`Recovery verification items[${index}] contains inconsistent inventory delta values`, { beforeCount, afterCount, inventoryIncrease, recoveredCount, missingCount, verified });
    return Object.freeze({ ...expected, beforeCount, afterCount, inventoryIncrease, recoveredCount, missingCount, verified });
  }));
  const missingRequired = Object.freeze(items.filter(item => item.decision === 'REQUIRED' && item.missingCount > 0));
  const missingOptional = Object.freeze(items.filter(item => item.decision === 'OPTIONAL' && item.missingCount > 0));
  const verified = strictBoolean(source.verified, 'Recovery verification verified');
  const status = source.status;
  if (!['RECOVERED', 'PARTIAL_RECOVERY'].includes(status)) throw new ValidationError('Recovery verification status must be RECOVERED or PARTIAL_RECOVERY', { status });
  if (verified !== (missingRequired.length === 0) || (status === 'RECOVERED') !== verified) throw new ValidationError('Recovery verification status is inconsistent with REQUIRED item results', { status, verified, missingRequired: missingRequired.length });
  const recoveredItems = nonNegativeInteger(source.recoveredItems, 'Recovery verification recoveredItems');
  const ignoredItems = nonNegativeInteger(source.ignoredItems, 'Recovery verification ignoredItems');
  const calculatedRecovered = items.reduce((sum, item) => sum + item.recoveredCount, 0);
  const calculatedIgnored = items.filter(item => item.decision === 'IGNORE').reduce((sum, item) => sum + item.count, 0);
  if (recoveredItems !== calculatedRecovered || ignoredItems !== calculatedIgnored) throw new ValidationError('Recovery verification aggregate counts do not match item results', { recoveredItems, calculatedRecovered, ignoredItems, calculatedIgnored });
  return Object.freeze({ status, verified, items, missingRequired, missingOptional, recoveredItems, ignoredItems });
}

function verifyItem(item, before, after) {
  const key = inventoryIdentity(item);
  const beforeCount = before.get(key)?.count ?? 0;
  const afterCount = after.get(key)?.count ?? 0;
  const inventoryIncrease = Math.max(0, afterCount - beforeCount);
  const recoveredCount = item.decision === 'IGNORE' ? 0 : Math.min(item.count, inventoryIncrease);
  const missingCount = item.decision === 'IGNORE' ? 0 : Math.max(0, item.count - recoveredCount);
  return Object.freeze({ ...item, beforeCount, afterCount, inventoryIncrease, recoveredCount, missingCount, verified: item.decision === 'IGNORE' || missingCount === 0 });
}

function inventoryCounts(items) {
  const counts = new Map();
  for (const item of items) {
    const key = inventoryIdentity(item);
    const current = counts.get(key);
    counts.set(key, { item, count: (current?.count ?? 0) + item.count });
  }
  return counts;
}
function inventoryIdentity(item) { return [item.name, item.customName ?? '', item.enchanted ? '1' : '0', item.unique ? '1' : '0', item.nbtHash ?? ''].join('|'); }
