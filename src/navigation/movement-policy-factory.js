import { NavigationError } from './navigation-error.js';

export function createMovementPolicy({ policy, lease }) {
  const scaffoldItems = lease?.item ? [lease.item] : [];
  if (policy.allowPlace && policy.allowScaffolding && !lease) throw new NavigationError('SCAFFOLD_RESERVATION_FAILED', 'Scaffolding requires an active resource lease', {});
  return Object.freeze({
    allow1by1towers: Boolean(policy.allowPlace && policy.allowTower && lease),
    allowBridge: Boolean(policy.allowPlace && policy.allowBridge && lease),
    allowParkour: false,
    allowSprinting: policy.allowSprint,
    allowFreeMotion: false,
    maxDropDown: 3,
    placeCost: policy.allowPlace && lease ? 1 : Number.POSITIVE_INFINITY,
    scaffoldItems,
    scaffoldLeaseId: lease?.id ?? null
  });
}
