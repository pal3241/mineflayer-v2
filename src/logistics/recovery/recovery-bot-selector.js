import { ValidationError } from '../../core/errors.js';
import {
  createRecoveryConfig,
  finiteNumber,
  identifier,
  normalizePosition,
  nonNegativeInteger,
  positiveInteger,
  requiredRecord,
  strictBoolean
} from './recovery-schema.js';

export function selectRecoveryBot(input) {
  const source = requiredRecord(input, 'Recovery bot selection input');
  if (!Array.isArray(source.candidates)) throw new ValidationError('Recovery bot candidates must be an array');
  const config = createRecoveryConfig(source.config);
  const death = normalizeDeathContext(source.death);
  const requiredSlots = source.requiredSlots === undefined ? 1 : positiveInteger(source.requiredSlots, 'Recovery requiredSlots');
  const ranked = [];
  const rejected = [];
  for (let index = 0; index < source.candidates.length; index++) {
    try {
      const candidate = normalizeCandidate(source.candidates[index], index, config);
      const result = rankCandidate({ candidate, death, requiredSlots, maxDistance: config.maxDistance });
      if (result.eligible) ranked.push(result);
      else rejected.push(result);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      const candidate = source.candidates[index];
      const botId = candidate && typeof candidate === 'object' && typeof candidate.botId === 'string' && candidate.botId.trim() ? candidate.botId.trim() : `candidate-${index}`;
      rejected.push(Object.freeze({ botId, distance: null, score: 0, eligible: false, rejectionReasons: Object.freeze(['INVALID_CANDIDATE']), validationError: error.message }));
    }
  }
  ranked.sort(compareCandidates);
  rejected.sort((left, right) => left.botId.localeCompare(right.botId));
  return Object.freeze({
    selected: ranked.length ? ranked[0] : null,
    ranked: Object.freeze(ranked),
    rejected: Object.freeze(rejected),
    reason: ranked.length ? null : 'NO_ELIGIBLE_RECOVERY_BOT'
  });
}

function normalizeDeathContext(input) {
  const source = requiredRecord(input, 'Recovery death context');
  return Object.freeze({
    deadBotId: identifier(source.deadBotId, 'Recovery death deadBotId'),
    worldKey: scopedString(source.worldKey, 'Recovery death worldKey'),
    dimension: scopedString(source.dimension, 'Recovery death dimension'),
    position: normalizePosition(source.position, 'Recovery death position'),
    danger: finiteNumber(source.danger, 0, 1, 'Recovery death danger')
  });
}

function normalizeCandidate(input, index, config) {
  const label = `Recovery bot candidates[${index}]`;
  const source = requiredRecord(input, label);
  const freeSlots = nonNegativeInteger(source.freeSlots, `${label}.freeSlots`);
  if (freeSlots > 36) throw new ValidationError(`${label}.freeSlots must not exceed 36`, { freeSlots });
  return Object.freeze({
    botId: identifier(source.botId, `${label}.botId`),
    worldKey: scopedString(source.worldKey, `${label}.worldKey`),
    dimension: scopedString(source.dimension, `${label}.dimension`),
    position: normalizePosition(source.position, `${label}.position`),
    alive: strictBoolean(source.alive, `${label}.alive`),
    available: strictBoolean(source.available, `${label}.available`),
    health: finiteNumber(source.health, 0, 20, `${label}.health`),
    food: finiteNumber(source.food, 0, 20, `${label}.food`),
    freeSlots,
    equipmentScore: finiteNumber(source.equipmentScore, 0, 1, `${label}.equipmentScore`),
    workload: finiteNumber(source.workload, 0, 1, `${label}.workload`),
    dangerTolerance: source.dangerTolerance === undefined
      ? config.dangerLimit
      : finiteNumber(source.dangerTolerance, 0, 1, `${label}.dangerTolerance`)
  });
}

function rankCandidate(input) {
  const distance = euclideanDistance(input.candidate.position, input.death.position);
  const rejectionReasons = [];
  if (!input.candidate.alive) rejectionReasons.push('BOT_NOT_ALIVE');
  if (!input.candidate.available) rejectionReasons.push('BOT_UNAVAILABLE');
  if (input.candidate.worldKey !== input.death.worldKey) rejectionReasons.push('WORLD_MISMATCH');
  if (input.candidate.dimension !== input.death.dimension) rejectionReasons.push('DIMENSION_MISMATCH');
  if (input.candidate.health <= 0) rejectionReasons.push('NO_HEALTH');
  if (input.candidate.freeSlots < input.requiredSlots) rejectionReasons.push('INVENTORY_FULL');
  if (distance > input.maxDistance) rejectionReasons.push('MAX_DISTANCE_EXCEEDED');
  if (input.death.danger > input.candidate.dangerTolerance) rejectionReasons.push('DANGER_TOO_HIGH');
  if (rejectionReasons.length) return Object.freeze({ ...input.candidate, distance: rounded(distance), score: 0, eligible: false, rejectionReasons: Object.freeze(rejectionReasons) });
  const distanceValue = (1 - Math.min(1, distance / input.maxDistance)) * 35;
  const healthValue = (input.candidate.health / 20) * 15;
  const foodValue = (input.candidate.food / 20) * 10;
  const inventoryValue = Math.min(1, input.candidate.freeSlots / Math.max(1, input.requiredSlots * 2)) * 15;
  const equipmentValue = input.candidate.equipmentScore * 10;
  const workloadValue = (1 - input.candidate.workload) * 10;
  const dangerValue = (1 - input.death.danger) * 5;
  const originalBotValue = input.candidate.botId === input.death.deadBotId ? 1 : 0;
  const score = rounded(Math.min(100, distanceValue + healthValue + foodValue + inventoryValue + equipmentValue + workloadValue + dangerValue + originalBotValue));
  return Object.freeze({ ...input.candidate, distance: rounded(distance), score, eligible: true, rejectionReasons: Object.freeze([]) });
}

function compareCandidates(left, right) {
  if (left.score !== right.score) return right.score - left.score;
  if (left.distance !== right.distance) return left.distance - right.distance;
  return left.botId.localeCompare(right.botId);
}
function euclideanDistance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z); }
function scopedString(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 255) throw new ValidationError(`${label} must be a non-empty string no longer than 255 characters`, { value });
  return value.trim();
}
function rounded(value) { return Math.round(value * 100) / 100; }
