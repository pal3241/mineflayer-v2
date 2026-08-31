import { NavigationError } from './navigation-error.js';

export function createMovementPolicy({ policy, lease }) {
  const scaffoldItems = lease?.item ? [lease.item] : [];
  if (policy.allowPlace && policy.allowScaffolding && !lease) throw new NavigationError('RESOURCE_RESERVATION_FAILED', 'Scaffolding requires an active resource reservation', {});
  return Object.freeze({
    allow1by1towers: Boolean(policy.allowPlace && policy.allowTower && lease),
    allowBridge: Boolean(policy.allowPlace && policy.allowBridge && lease),
    allowParkour: Boolean(policy.allowParkour),
    allowJump: Boolean(policy.allowJump),
    allowSprinting: policy.allowSprint,
    allowFreeMotion: Boolean(policy.allowFreeMotion),
    maxDropDown: policy.maxDropDown,
    water: structuredClone(policy.water),
    placeCost: policy.allowPlace && lease ? 1 : Number.POSITIVE_INFINITY,
    scaffoldItems,
    scaffoldLeaseId: lease?.id ?? null
  });
}
