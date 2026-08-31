export function scoreHelper(state) {
  const signals = { readiness: state.available && state.alive && state.connected ? 25 : 0, capacity: Math.min(20, state.inventoryFreeSlots * 2), tool: state.toolSuitable ? 20 : 0, productivity: Math.min(20, Math.round(state.currentRate * 10)), workloadPenalty: -Math.min(15, state.remaining), failurePenalty: state.alive && state.connected ? 0 : -50 };
  const score = Object.values(signals).reduce((total, value) => total + value, 0);
  return Object.freeze({ botId: state.botId, eligible: state.available && state.alive && state.connected && state.toolSuitable && state.inventoryFreeSlots > 0, score: Math.max(0, score), signals });
}
