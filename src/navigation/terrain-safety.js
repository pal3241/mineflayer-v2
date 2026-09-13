const DIRECT_HAZARDS = Object.freeze({
  lava: 'LAVA', fire: 'FIRE', soul_fire: 'FIRE', cactus: 'CACTUS',
  magma_block: 'MAGMA', sweet_berry_bush: 'SWEET_BERRY_BUSH',
  powder_snow: 'POWDER_SNOW', campfire: 'CAMPFIRE', soul_campfire: 'CAMPFIRE'
});

const EMPTY = new Set(['air', 'cave_air', 'void_air', 'water', 'bubble_column', 'lava', 'fire', 'soul_fire', 'tall_grass', 'short_grass', 'snow']);

export function inspectTerrainPosition(bot, position, safety = {}) {
  const point = floorPosition(position); const hazards = [];
  const samples = [
    ['FEET', point], ['HEAD', offset(point, 0, 1, 0)], ['GROUND', offset(point, 0, -1, 0)],
    ['NORTH', offset(point, 0, 0, -1)], ['SOUTH', offset(point, 0, 0, 1)],
    ['WEST', offset(point, -1, 0, 0)], ['EAST', offset(point, 1, 0, 0)]
  ];
  for (const [location, sample] of samples) {
    const block = blockAt(bot, sample); const type = DIRECT_HAZARDS[String(block?.name ?? '')];
    if (type && (location !== 'GROUND' || type === 'MAGMA' || type === 'CAMPFIRE' || type === 'LAVA')) hazards.push({ type, location, block: block.name, position: sample });
  }
  const fallDistance = unsupportedDepth(bot, point, Number(safety.maxFallDistance ?? 3) + 1);
  if (fallDistance > Number(safety.maxFallDistance ?? 3)) hazards.push({ type: 'FALL', location: 'GROUND', distance: fallDistance, position: point });
  const blockedTypes = new Set(enabledAvoidances(safety));
  return Object.freeze({ position: point, hazards, fallDistance, safe: !hazards.some(hazard => blockedTypes.has(hazard.type)), blockedTypes: [...blockedTypes] });
}

export function enabledAvoidances(safety = {}) {
  const result = ['FALL'];
  if (safety.avoidLava !== false) result.push('LAVA');
  if (safety.avoidFire !== false) result.push('FIRE', 'CAMPFIRE');
  if (safety.avoidCactus !== false) result.push('CACTUS');
  if (safety.avoidMagma !== false) result.push('MAGMA');
  if (safety.avoidBerryBush !== false) result.push('SWEET_BERRY_BUSH');
  if (safety.avoidPowderSnow !== false) result.push('POWDER_SNOW');
  return result;
}

function unsupportedDepth(bot, position, limit) {
  for (let depth = 1; depth <= limit; depth++) {
    const block = blockAt(bot, offset(position, 0, -depth, 0));
    if (!block) return 0;
    if (!EMPTY.has(String(block?.name ?? 'air'))) return depth - 1;
  }
  return limit;
}
function blockAt(bot, position) { return bot?.blockAt?.(position) ?? null; }
function floorPosition(value) { return value?.floored ? value.floored() : { x: Math.floor(Number(value.x)), y: Math.floor(Number(value.y)), z: Math.floor(Number(value.z)) }; }
function offset(value, x, y, z) { return value?.offset ? value.offset(x, y, z) : { x: value.x + x, y: value.y + y, z: value.z + z }; }
