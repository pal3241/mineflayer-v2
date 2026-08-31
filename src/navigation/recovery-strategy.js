import { NavigationError } from './navigation-error.js';

const MICRO_ACTIONS = Object.freeze(['JUMP', 'BACKWARD', 'STRAFE_LEFT', 'STRAFE_RIGHT']);
const OFFSETS = Object.freeze([{ name: 'NORTH', x: 0, z: -2 }, { name: 'SOUTH', x: 0, z: 2 }, { name: 'EAST', x: 2, z: 0 }, { name: 'WEST', x: -2, z: 0 }, { name: 'NORTHEAST', x: 2, z: -2 }, { name: 'NORTHWEST', x: -2, z: -2 }, { name: 'SOUTHEAST', x: 2, z: 2 }, { name: 'SOUTHWEST', x: -2, z: 2 }]);

export function microEscapeAction(input) { const attempt = Number(input.attempt); if (!Number.isInteger(attempt) || attempt < 0) throw new NavigationError('RECOVERY_ACTION_INVALID', 'Micro escape attempt must be a non-negative integer', { attempt: input.attempt }); const fingerprint = String(input.fingerprint ?? ''); const offset = [...fingerprint].reduce((sum, value) => sum + value.charCodeAt(0), 0) % MICRO_ACTIONS.length; return MICRO_ACTIONS[(offset + attempt) % MICRO_ACTIONS.length]; }

export function alternateApproaches(input) { const origin = position(input.origin, 'origin'); const target = position(input.target, 'target'); const failed = new Set(Array.isArray(input.failed) ? input.failed.map(String) : []); return OFFSETS.map(offset => { const candidate = { x: origin.x + offset.x, y: origin.y, z: origin.z + offset.z }; const id = `${offset.name}:${candidate.x}:${candidate.y}:${candidate.z}`; return { id, direction: offset.name, position: candidate, distanceToTarget: distance(candidate, target) }; }).filter(candidate => !failed.has(candidate.id)).sort((left, right) => left.distanceToTarget - right.distanceToTarget || left.direction.localeCompare(right.direction)); }

function position(value, field) { if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) throw new NavigationError('RECOVERY_ACTION_INVALID', `Recovery ${field} position is invalid`, { [field]: value }); return { x: Number(value.x), y: Number(value.y), z: Number(value.z) }; }
function distance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z); }
