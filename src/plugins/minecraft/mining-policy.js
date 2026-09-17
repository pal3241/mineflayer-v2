const ORE_PATTERN = /(?:^|_)(?:coal|copper|iron|gold|redstone|lapis|diamond|emerald|nether_gold|nether_quartz)_ore$/;

export function isOreBlock(name) {
  const value = String(name ?? '').toLowerCase();
  return ORE_PATTERN.test(value) || value === 'ancient_debris';
}

export function prioritizeMiningTargets(profiles, { strategy = 'CAVE_FIRST', avoidStripMining = false, maximumBuriedDescent = 4 } = {}) {
  const candidates = profiles.filter(profile => !profile.hazard && profile.withinGroup !== false);
  if (String(strategy).toUpperCase() !== 'CAVE_FIRST') return candidates.sort(nearestFirst).map(profile => profile.block);
  const exposed = candidates.filter(profile => profile.exposedFaces > 0).sort(caveFirst);
  if (avoidStripMining) return exposed.map(profile => profile.block);
  const buried = candidates.filter(profile => profile.exposedFaces === 0 && profile.descent <= maximumBuriedDescent).sort(nearestFirst);
  return [...exposed, ...buried].map(profile => profile.block);
}

function caveFirst(left, right) {
  return Number(left.skyLight > 7) - Number(right.skyLight > 7)
    || right.exposedFaces - left.exposedFaces
    || left.distance - right.distance
    || left.descent - right.descent;
}

function nearestFirst(left, right) { return left.distance - right.distance || left.descent - right.descent; }
