import { NavigationError } from './navigation-error.js';

export function planCorridorWaves({ members, cellSize = 2 }) {
  const size = Number(cellSize);
  if (!Array.isArray(members) || !members.length || !Number.isFinite(size) || size < 1 || size > 16) throw new NavigationError('INVALID_CORRIDOR', 'Corridor planning requires members and a cell size between 1 and 16', { members, cellSize });
  const reservations = members.map(member => {
    if (!member?.botId || !valid(member.start) || !valid(member.target)) throw new NavigationError('INVALID_CORRIDOR', 'Every corridor requires a botId, start, and target', { member });
    return { botId: String(member.botId), start: { ...member.start }, target: { ...member.target }, cells: rasterize(member.start, member.target, size), wave: 0 };
  });
  const waves = [];
  for (const reservation of reservations) {
    let wave = waves.findIndex(entries => entries.every(entry => !overlaps(entry.cells, reservation.cells)));
    if (wave < 0) { wave = waves.length; waves.push([]); }
    reservation.wave = wave; waves[wave].push(reservation);
  }
  return Object.freeze({ cellSize: size, waveCount: waves.length, reservations, waves: waves.map(entries => entries.map(entry => entry.botId)) });
}

function rasterize(start, target, size) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(target.x - start.x), Math.abs(target.z - start.z)) / size)); const cells = new Set();
  for (let index = 0; index <= steps; index++) { const ratio = index / steps; cells.add(`${Math.floor((start.x + (target.x - start.x) * ratio) / size)}:${Math.floor((start.z + (target.z - start.z) * ratio) / size)}`); }
  return [...cells];
}
function overlaps(left, right) { const occupied = new Set(left); return right.some(cell => occupied.has(cell)); }
function valid(value) { return value && [value.x, value.y, value.z].every(Number.isFinite); }
