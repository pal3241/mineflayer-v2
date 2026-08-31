import { NavigationError } from './navigation-error.js';

const MODES = Object.freeze({ FAST: { tolerance: 3, allowSprint: true, allowJump: true, allowDig: false, allowPlace: false, timeout: 120_000 }, SAFE: { tolerance: 2, allowSprint: true, allowJump: true, allowDig: false, allowPlace: false, timeout: 120_000 }, PRECISE: { tolerance: 1, allowSprint: false, allowJump: true, allowDig: false, allowPlace: false, timeout: 120_000 } });

export function normalizeNavigationPolicy(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}; const mode = String(raw.mode ?? 'SAFE').trim().toUpperCase(); const defaults = MODES[mode]; if (!defaults) throw new NavigationError('INVALID_POLICY', `Unsupported navigation mode '${mode}'`, { mode });
  const policy = { ...defaults, ...raw, mode, tolerance: raw.tolerance ?? defaults.tolerance, timeout: raw.timeout ?? defaults.timeout };
  if (!Number.isFinite(Number(policy.tolerance)) || Number(policy.tolerance) < 0 || Number(policy.tolerance) > 64) throw new NavigationError('INVALID_POLICY', 'Navigation tolerance must be a finite number between 0 and 64', { tolerance: policy.tolerance });
  if (!Number.isInteger(Number(policy.timeout)) || Number(policy.timeout) < 250 || Number(policy.timeout) > 600_000) throw new NavigationError('INVALID_POLICY', 'Navigation timeout must be an integer between 250 and 600000ms', { timeout: policy.timeout });
  for (const field of ['allowSprint', 'allowJump', 'allowDig', 'allowPlace']) if (typeof policy[field] !== 'boolean') throw new NavigationError('INVALID_POLICY', `Navigation policy '${field}' must be boolean`, { field, value: policy[field] });
  return Object.freeze({ ...policy, tolerance: Number(policy.tolerance), timeout: Number(policy.timeout) });
}
