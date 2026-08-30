import { ValidationError } from '../../core/errors.js';
import { identifier, nonNegativeInteger, normalizeInventoryItem, requiredRecord } from './recovery-schema.js';

export function reconcileRecovery(input) {
  const source = requiredRecord(input, 'Recovery reconciliation input');
  const verification = normalizeVerification(source.verification);
  const transfer = source.transfer === undefined || source.transfer === null ? null : normalizeTransfer(source.transfer);
  const permanentLosses = Object.freeze(verification.items
    .filter(item => item.decision === 'REQUIRED' && item.missingCount > 0)
    .map(item => Object.freeze({ name: item.name, count: item.missingCount, decision: item.decision, reason: 'PERMANENT_LOSS' })));
  const optionalLosses = Object.freeze(verification.items
    .filter(item => item.decision === 'OPTIONAL' && item.missingCount > 0)
    .map(item => Object.freeze({ name: item.name, count: item.missingCount, decision: item.decision, reason: 'OPTIONAL_NOT_RECOVERED' })));
  const transferReconciliation = transfer ? reconcileTransfer(transfer, verification, source.recoveryBotId) : null;
  const full = verification.verified;
  return Object.freeze({
    outcome: full ? 'FULL' : 'PARTIAL_RECONCILED',
    jobStatus: full ? 'RECOVERED' : 'PARTIAL_RECONCILED',
    cleanupDeathDrop: true,
    recoveredItems: verification.recoveredItems,
    permanentLosses,
    optionalLosses,
    transfer: transferReconciliation
  });
}

function normalizeVerification(input) {
  const source = requiredRecord(input, 'Recovery reconciliation verification');
  if (!Array.isArray(source.items)) throw new ValidationError('Recovery reconciliation verification items must be an array');
  const items = Object.freeze(source.items.map((item, index) => {
    const record = requiredRecord(item, `Recovery reconciliation items[${index}]`);
    const decision = enumValue(record.decision, ['REQUIRED', 'OPTIONAL', 'IGNORE'], `Recovery reconciliation items[${index}].decision`);
    const normalizedItem = normalizeInventoryItem(record, `Recovery reconciliation items[${index}]`);
    return Object.freeze({
      ...normalizedItem,
      decision,
      recoveredCount: nonNegativeInteger(record.recoveredCount, `Recovery reconciliation items[${index}].recoveredCount`),
      missingCount: nonNegativeInteger(record.missingCount, `Recovery reconciliation items[${index}].missingCount`)
    });
  }));
  const missingRequired = items.filter(item => item.decision === 'REQUIRED' && item.missingCount > 0);
  const verified = Boolean(source.verified);
  if (verified !== (missingRequired.length === 0)) throw new ValidationError('Recovery reconciliation verification result is inconsistent with REQUIRED item losses', { verified, missingRequired: missingRequired.length });
  const status = enumValue(source.status, ['RECOVERED', 'PARTIAL_RECOVERY'], 'Recovery reconciliation verification status');
  if ((status === 'RECOVERED') !== verified) throw new ValidationError('Recovery reconciliation verification status is inconsistent with verified', { status, verified });
  const recoveredItems = nonNegativeInteger(source.recoveredItems, 'Recovery reconciliation recoveredItems');
  const calculatedRecovered = items.reduce((sum, item) => sum + item.recoveredCount, 0);
  if (recoveredItems !== calculatedRecovered) throw new ValidationError('Recovery reconciliation recoveredItems does not match item detail', { recoveredItems, calculatedRecovered });
  return Object.freeze({ status, verified, items, recoveredItems });
}

function normalizeTransfer(input) {
  const source = requiredRecord(input, 'Recovery reconciliation transfer');
  if (!Array.isArray(source.items) || !source.items.length) throw new ValidationError('Recovery reconciliation transfer items must be a non-empty array');
  const items = Object.freeze(source.items.map((entry, index) => {
    const item = requiredRecord(entry, `Recovery reconciliation transfer items[${index}]`);
    return normalizeInventoryItem(item, `Recovery reconciliation transfer items[${index}]`);
  }));
  return Object.freeze({
    id: identifier(source.id, 'Recovery reconciliation transfer id'),
    originalBotId: identifier(source.originalBotId, 'Recovery reconciliation transfer originalBotId'),
    items
  });
}

function reconcileTransfer(transfer, verification, recoveryBotIdInput) {
  const recoveryBotId = identifier(recoveryBotIdInput, 'Recovery reconciliation recoveryBotId');
  const expectedByIdentity = sumByIdentity(transfer.items, 'count');
  const recoveredByIdentity = sumByIdentity(verification.items.filter(item => item.decision !== 'IGNORE'), 'recoveredCount');
  const items = Object.freeze([...expectedByIdentity.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, expected]) => {
    const recoveredCount = Math.min(expected.count, recoveredByIdentity.get(key)?.count ?? 0);
    return Object.freeze({ ...expected.item, expectedCount: expected.count, recoveredCount, lostCount: expected.count - recoveredCount });
  }));
  const expectedCount = items.reduce((sum, item) => sum + item.expectedCount, 0);
  const recoveredCount = items.reduce((sum, item) => sum + item.recoveredCount, 0);
  const lostCount = expectedCount - recoveredCount;
  const action = recoveredCount > 0 ? 'TAKEOVER_REQUIRED' : 'RECONCILE_PERMANENT_LOSS';
  return Object.freeze({
    transferId: transfer.id,
    originalBotId: transfer.originalBotId,
    recoveryBotId,
    items,
    expectedCount,
    recoveredCount,
    lostCount,
    action,
    reservationStatus: action === 'TAKEOVER_REQUIRED' ? 'RECOVERY_REQUIRED' : 'FAILED',
    reservationProtected: action === 'TAKEOVER_REQUIRED'
  });
}

function sumByIdentity(items, countField) {
  const result = new Map();
  for (const item of items) {
    const key = inventoryIdentity(item);
    const current = result.get(key);
    result.set(key, { item, count: (current?.count ?? 0) + item[countField] });
  }
  return result;
}
function inventoryIdentity(item) { return [item.name, item.customName ?? '', item.enchanted ? '1' : '0', item.unique ? '1' : '0', item.nbtHash ?? ''].join('|'); }
function enumValue(value, choices, label) {
  if (typeof value !== 'string' || !choices.includes(value)) throw new ValidationError(`${label} must be one of: ${choices.join(', ')}`, { value });
  return value;
}
