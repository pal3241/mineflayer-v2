const ACTIVE = new Set(['ASSIGNED', 'REASSIGN_REQUIRED', 'RUNNING', 'OUTPUT_READY', 'PARTIAL', 'COMPLETED', 'RESUMING']);

export function collectWorkerStates({ session, shares, bots, now }) {
  const timestamp = Number(now);
  return shares.filter(share => ACTIVE.has(share.status)).map(share => workerState({ session, share, bots, timestamp }));
}

function workerState({ session, share, bots, timestamp }) {
  const runtime = bots.get(share.botId); const snapshot = runtime.adapter.snapshot(); const status = runtime.snapshot?.().status ?? runtime.status;
  const inventory = Array.isArray(snapshot.inventorySummary) ? snapshot.inventorySummary : []; const capacity = Number.isInteger(snapshot.inventorySlots) ? snapshot.inventorySlots : 36; const inventoryFreeSlots = Math.max(0, capacity - inventory.length); const capacityUnits = Number.isInteger(snapshot.freeItemCapacity) ? snapshot.freeItemCapacity : inventoryFreeSlots * 64;
  const lastProgressAt = Date.parse(share.updatedAt ?? share.createdAt); const elapsedSeconds = Math.max(1, (timestamp - lastProgressAt) / 1000);
  return Object.freeze({ botId: share.botId, sessionId: session.id, shareId: share.shareId, role: share.role, status: share.status, assigned: share.assigned, completed: share.completed, delivered: share.delivered, credited: share.credited, remaining: Math.max(0, share.assigned - share.completed), inventoryFreeSlots, capacityUnits, toolSuitable: hasCollectionCapability(runtime), available: ['READY', 'ACTIVE'].includes(status) && share.completed === share.delivered && !['PAUSED', 'WAITING_DESTINATION', 'HELPER_LOST'].includes(share.status), alive: !['DEAD', 'FAILED'].includes(status), connected: !['OFFLINE', 'DISCONNECTED', 'DEAD', 'FAILED'].includes(status), currentRate: share.completed / elapsedSeconds, lastProgressAt: Number.isFinite(lastProgressAt) ? lastProgressAt : timestamp });
}

function hasCollectionCapability(runtime) { return !Array.isArray(runtime.capabilities) || runtime.capabilities.includes('minecraft.collection'); }
