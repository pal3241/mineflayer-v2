import { randomUUID } from 'node:crypto';

export function createScaffoldLedger() {
  const placements = [];
  const record = input => { const entry = { id: `PLACE-${randomUUID()}`, placementId: null, sessionId: input.sessionId, action: input.action, reason: input.reason, item: input.item, position: { ...input.position }, verified: input.verified === true, placedAt: new Date().toISOString(), verifiedAt: input.verified ? new Date().toISOString() : null }; entry.placementId = entry.id; placements.push(entry); return structuredClone(entry); };
  const forSession = sessionId => placements.filter(entry => entry.sessionId === sessionId).map(entry => structuredClone(entry));
  return Object.freeze({ record, forSession });
}
