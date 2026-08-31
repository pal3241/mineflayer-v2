const ACTIVE = new Set(['ASSIGNED', 'REASSIGN_REQUIRED', 'RUNNING', 'OUTPUT_READY', 'PARTIAL', 'COMPLETED', 'RESUMING']);

export function collectWorkerStates({ session, shares, bots, now }) {
  const timestamp = Number(now);
  return shares.filter(share => ACTIVE.has(share.status)).map(share => workerState({ session, share, bots, timestamp }));
}

function workerState({ session, share, bots, timestamp }) {
  const runtime = bots.get(share.botId); const snapshot = runtime.adapter.snapshot(); const status = runtime.snapshot?.().status ?? runtime.status;
  const capacity = Number.isInteger(snapshot.inventorySlots) ? snapshot.inventorySlots : 36; const used = Number.isInteger(snapshot.inventorySlotsUsed) ? snapshot.inventorySlotsUsed : 0; const inventoryFreeSlots = Number.isInteger(snapshot.inventorySlotsFree) ? snapshot.inventorySlotsFree : Math.max(0, capacity - used); const capacityUnits = targetCapacity(snapshot, session.goal.item, inventoryFreeSlots);
  const lastProgressAt = Date.parse(share.lastProgressAt ?? share.updatedAt ?? share.createdAt); const elapsedSeconds = Math.max(1, (timestamp - lastProgressAt) / 1000);
  return Object.freeze({ botId: share.botId, sessionId: session.id, shareId: share.shareId, role: share.role, status: share.status, assigned: share.assigned, completed: share.completed, delivered: share.delivered, credited: share.credited, remaining: Math.max(0, share.assigned - share.completed), inventoryFreeSlots, capacityUnits, toolSuitable: hasSuitableTool(runtime, snapshot.inventorySummary, session.goal.item), available: ['READY', 'ACTIVE'].includes(status) && share.completed === share.delivered && !['PAUSED', 'WAITING_DESTINATION', 'HELPER_LOST'].includes(share.status), alive: !['DEAD', 'FAILED'].includes(status), connected: !['OFFLINE', 'DISCONNECTED', 'DEAD', 'FAILED'].includes(status), currentRate: share.completed / elapsedSeconds, lastProgressAt: Number.isFinite(lastProgressAt) ? lastProgressAt : timestamp });
}

function targetCapacity(snapshot, item, inventoryFreeSlots) { const slots = Array.isArray(snapshot.inventorySlots) ? snapshot.inventorySlots : null; if (!slots) return inventoryFreeSlots * 64; const target = String(item).toLowerCase(); const stackSize = slots.find(slot => slot?.name === target)?.stackSize ?? 64; return slots.reduce((total, slot) => total + (slot === null ? stackSize : slot?.name === target ? Math.max(0, Number(slot.stackSize ?? stackSize) - Number(slot.count ?? 0)) : 0), 0); }
function hasSuitableTool(runtime, inventory, item) { if (Array.isArray(runtime.capabilities) && !runtime.capabilities.includes('minecraft.collection')) return false; const requirement = runtime.adapter?.toolRequirementForBlock?.(item) ?? requiredTool(item); if (!requirement) return true; return (Array.isArray(inventory) ? inventory : []).some(entry => toolMatches(entry.name, requirement)); }
function requiredTool(item) { const name = String(item).toLowerCase().replace('deepslate_', ''); if (name.includes('obsidian')) return { type: 'pickaxe', tier: 5 }; if (/(gold_ore|redstone_ore|diamond_ore|emerald_ore)/.test(name)) return { type: 'pickaxe', tier: 4 }; if (/(iron_ore|copper_ore|lapis_ore)/.test(name)) return { type: 'pickaxe', tier: 3 }; if (/(coal_ore|stone|cobblestone|andesite|diorite|granite)/.test(name)) return { type: 'pickaxe', tier: 1 }; if (/(log|wood|stem|hyphae)/.test(name)) return { type: 'axe', tier: 1 }; return null; }
function toolMatches(name, requirement) { const value = String(name ?? '').toLowerCase(); if (!value.endsWith(`_${requirement.type}`)) return false; return toolTier(value) >= requirement.tier; }
function toolTier(name) { const material = String(name).split('_', 1)[0]; return { wooden: 1, golden: 2, stone: 3, iron: 4, diamond: 5, netherite: 6 }[material] ?? 0; }
