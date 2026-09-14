import { ValidationError } from '../core/errors.js';

const KINDS = new Set(['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'stonecutter', 'smithing_table', 'loom', 'cartography_table', 'brewing_stand']);
export function createWorkshopService({ events, memory }) { return Object.freeze({ scan: input => scan({ events, memory }, input), known: input => known(memory, input) }); }

async function scan({ events, memory }, { runtime, radius = 48, kinds = [...KINDS] }) {
  if (!runtime?.adapter?.findWorkshops) throw new ValidationError('Workshop scan requires a Minecraft runtime that supports workshop discovery');
  const validKinds = kinds.map(String).filter(kind => KINDS.has(kind)); if (!validKinds.length) throw new ValidationError('No supported workshop kinds requested');
  const found = await runtime.adapter.findWorkshops({ kinds: validKinds, maxDistance: bounded(radius) });
  const scope = runtimeScope(runtime); const observedAt = new Date().toISOString();
  const workshops = found.map(item => ({ ...scope, ...item, botId: runtime.bot?.id ?? runtime.id, observedAt }));
  for (const workshop of workshops) await events?.publish('logistics.workshop.observed', workshop, { source: 'workshops', correlationId: `${workshop.kind}:${workshop.position.x},${workshop.position.y},${workshop.position.z}` });
  return workshops;
}
async function known(memory, { worldKey, dimension, kind, position = null }) { if (!memory) return []; const context = await memory.context({ worldKey, dimension, position, limit: 100 }); return context.records.filter(record => record.kind === 'WORKSHOP' && (!kind || record.metadata?.kind === kind)); }
function bounded(value) { const number = Number(value); if (!Number.isInteger(number) || number < 1 || number > 256) throw new ValidationError('Workshop scan radius must be an integer from 1 to 256'); return number; }
function runtimeScope(runtime) { const snapshot = runtime.adapter.snapshot(); return { worldKey: `${String(runtime.options?.host ?? 'localhost').toLowerCase()}:${Number(runtime.options?.port ?? 25565)}`, dimension: String(snapshot.dimension ?? 'overworld') }; }
