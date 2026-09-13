import { NavigationError } from './navigation-error.js';

const FORMATIONS = new Set(['LINE', 'COLUMN', 'WEDGE', 'GRID']);

export function planFormationTargets({ botIds, anchor, formation = 'LINE', spacing = 2 }) {
  const ids = Array.isArray(botIds) ? botIds.map(String) : []; const kind = String(formation).toUpperCase(); const gap = Number(spacing);
  if (ids.length < 2 || ids.length > 32 || new Set(ids).size !== ids.length || ids.some(id => !id.trim())) throw new NavigationError('INVALID_GROUP', 'Group navigation requires 2-32 unique bot IDs', { botIds });
  if (!FORMATIONS.has(kind)) throw new NavigationError('INVALID_FORMATION', `Unsupported formation '${kind}'`, { formation: kind });
  if (!Number.isFinite(gap) || gap < 1 || gap > 16) throw new NavigationError('INVALID_FORMATION', 'Formation spacing must be between 1 and 16 blocks', { spacing });
  if (!anchor || ![anchor.x, anchor.y, anchor.z].every(Number.isFinite)) throw new NavigationError('INVALID_TARGET', 'Formation anchor requires finite x, y, z', { anchor });
  const targets = ids.map((botId, index) => ({ botId, index, position: add(anchor, offset(kind, index, ids.length, gap)) }));
  return Object.freeze({ formation: kind, spacing: gap, anchor: { ...anchor }, targets });
}

function offset(kind, index, count, gap) {
  if (kind === 'LINE') return { x: (index - (count - 1) / 2) * gap, y: 0, z: 0 };
  if (kind === 'COLUMN') return { x: 0, y: 0, z: index * gap };
  if (kind === 'WEDGE') { if (index === 0) return { x: 0, y: 0, z: 0 }; const rank = Math.ceil(index / 2); return { x: (index % 2 ? -1 : 1) * rank * gap, y: 0, z: rank * gap }; }
  const width = Math.ceil(Math.sqrt(count)); return { x: (index % width) * gap, y: 0, z: Math.floor(index / width) * gap };
}
function add(left, right) { return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z }; }
