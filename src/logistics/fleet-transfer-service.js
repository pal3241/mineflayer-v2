import { ConflictError, ValidationError } from '../core/errors.js';

const INITIAL_RELIABILITY = 100;
const WRONG_PICKUP_PENALTY = 10;
const CUSTODY_LOSS_PENALTY = 5;

export function createFleetTransferService({ events, bots = null, repository = null }) {
  const reliability = async botId => {
    const id = String(botId ?? '').trim();
    if (!id) throw new ValidationError('Fleet reliability requires a bot id');
    return (await repository?.list?.() ?? []).find(item => item.botId === id) ?? reliabilityRecord(id);
  };

  const penalize = async (botId, points, reason, details = {}) => {
    if (!repository || !botId) return null;
    const current = await reliability(botId); const now = new Date().toISOString();
    const penalty = Math.max(1, Math.floor(Number(points) || 1));
    const next = { ...current, score: Math.max(0, current.score - penalty), penalties: Number(current.penalties ?? 0) + 1, lostItems: Number(current.lostItems ?? 0) + Number(details.lostCount ?? 0), lastReason: reason, lastDetails: details, updatedAt: now };
    const exists = (await repository.list()).some(item => item.id === current.id);
    const saved = exists ? await repository.update(current.id, next) : await repository.create(next);
    await events?.publish('fleet.reliability.penalized', { botId, points: penalty, reason, score: saved.score, details }, { source: 'fleet-transfer', correlationId: botId });
    return saved;
  };

  const transfer = async input => {
    const donor = validateRuntime(input.donor, 'donor'); const receiver = validateRuntime(input.receiver, 'receiver'); const item = validateItem(input.item); const count = validateCount(input.count);
    if (donor.id === receiver.id) throw new ConflictError('Fleet transfer requires different donor and receiver bots');
    const donorBefore = itemTotal(donor, item); const receiverBefore = itemTotal(receiver, item); if (donorBefore < count) throw new ConflictError(`Fleet donor '${donor.id}' has only ${donorBefore} '${item}'`, { donorId: donor.id, item, requested: count, available: donorBefore });
    const fleetBefore = fleetTotals(bots, item, [donor, receiver]);
    const donorSnapshot = donor.adapter.snapshot(); const receiverSnapshot = receiver.adapter.snapshot(); validateScope(donor, receiver, donorSnapshot, receiverSnapshot); const meeting = meetingPoint(donorSnapshot.position, receiverSnapshot.position);
    await events?.publish('fleet.transfer.planned', { donorId: donor.id, receiverId: receiver.id, item, count, meeting }, { source: 'fleet-transfer' });
    try {
      await Promise.all([donor.adapter.smartMove({ ...meeting, range: 2 }, { signal: input.signal }), receiver.adapter.smartMove({ ...meeting, range: 2 }, { signal: input.signal })]); await events?.publish('fleet.transfer.started', { donorId: donor.id, receiverId: receiver.id, item, count, meeting }, { source: 'fleet-transfer' });
      await donor.adapter.dropItem({ item, count }); await receiver.adapter.pickupItem({ item, count }, { signal: input.signal });
      return await verifyAndComplete({ donor, receiver, item, count, donorBefore, receiverBefore, meeting, events });
    } catch (error) {
      let wrongTakerId = null;
      const recovered = await recoverWrongPickup({ bots, donor, receiver, item, count, donorBefore, receiverBefore, fleetBefore, meeting, signal: input.signal, events, penalize, onDetected: botId => { wrongTakerId = botId; } });
      if (recovered) return recovered;
      const fleetAfter = fleetTotals(bots, item, [donor, receiver]); const lost = Math.max(0, total(fleetBefore) - total(fleetAfter));
      if (lost > 0 && !wrongTakerId) await penalize(donor.id, CUSTODY_LOSS_PENALTY, 'TRANSFER_ITEM_LOST', { item, lostCount: lost, receiverId: receiver.id });
      await events?.publish('fleet.transfer.failed', { donorId: donor.id, receiverId: receiver.id, item, requested: count, lost, code: error.code ?? 'TRANSFER_FAILED', error: error.message }, { source: 'fleet-transfer' });
      throw error;
    }
  };

  const listReliability = async () => repository?.list?.() ?? [];
  return Object.freeze({ transfer, reliability, listReliability });
}

async function recoverWrongPickup({ bots, donor, receiver, item, count, donorBefore, receiverBefore, fleetBefore, meeting, signal, events, penalize, onDetected }) {
  if (!bots) return null;
  const fleetAfter = fleetTotals(bots, item, [donor, receiver]);
  const wrong = [...fleetAfter.entries()].map(([botId, after]) => ({ botId, gained: after - (fleetBefore.get(botId) ?? 0) })).filter(entry => entry.botId !== donor.id && entry.botId !== receiver.id && entry.gained > 0).sort((a, b) => b.gained - a.gained)[0];
  if (!wrong) return null;
  onDetected?.(wrong.botId);
  const missing = Math.max(0, receiverBefore + count - itemTotal(receiver, item)); const returnCount = Math.min(missing, wrong.gained);
  if (!returnCount) return null;
  const taker = runtimeById(bots, wrong.botId); if (!taker) return null;
  await events?.publish('fleet.transfer.wrong-pickup', { botId: wrong.botId, donorId: donor.id, receiverId: receiver.id, item, count: returnCount }, { source: 'fleet-transfer' });
  try {
    await taker.adapter.smartMove({ ...meeting, range: 2 }, { signal });
    await taker.adapter.dropItem({ item, count: returnCount });
    await receiver.adapter.pickupItem({ item, count: returnCount }, { signal });
    const result = await verifyAndComplete({ donor, receiver, item, count, donorBefore, receiverBefore, meeting, events, recoveredFrom: wrong.botId });
    await events?.publish('fleet.transfer.recovered', result, { source: 'fleet-transfer' });
    return result;
  } catch (recoveryError) {
    await penalize(wrong.botId, WRONG_PICKUP_PENALTY, 'WRONG_PICKUP_NOT_RETURNED', { item, lostCount: returnCount, receiverId: receiver.id, error: recoveryError.message });
    return null;
  }
}

async function verifyAndComplete({ donor, receiver, item, count, donorBefore, receiverBefore, meeting, events, recoveredFrom = null }) {
  const donorAfter = itemTotal(donor, item); const receiverAfter = itemTotal(receiver, item);
  if (donorAfter !== donorBefore - count || receiverAfter !== receiverBefore + count) throw new ConflictError(`Fleet transfer verification failed for '${item}'`, { item, requested: count, donorBefore, donorAfter, receiverBefore, receiverAfter });
  const result = { donorId: donor.id, receiverId: receiver.id, item, requested: count, donorBefore, donorAfter, receiverBefore, receiverAfter, transferred: count, meeting, recoveredFrom, verified: true };
  await events?.publish('fleet.transfer.completed', result, { source: 'fleet-transfer' }); return result;
}

function reliabilityRecord(botId) { const now = new Date().toISOString(); return { id: `fleet-reliability:${botId}`, botId, score: INITIAL_RELIABILITY, penalties: 0, lostItems: 0, lastReason: null, lastDetails: null, createdAt: now, updatedAt: now }; }
function runtimeById(bots, id) { try { return bots.get(id); } catch { return null; } }
function fleetTotals(bots, item, required = []) { const values = new Map(); for (const runtime of required) values.set(runtime.id, itemTotal(runtime, item)); if (!bots) return values; for (const descriptor of bots.list?.() ?? []) { const id = String(descriptor.id ?? ''); if (!id || values.has(id)) continue; const runtime = runtimeById(bots, id); if (runtime) values.set(id, itemTotal(runtime, item)); } return values; }
function total(values) { return [...values.values()].reduce((sum, value) => sum + value, 0); }
function validateRuntime(value, label) { if (!value || typeof value !== 'object' || !value.adapter || typeof value.adapter.snapshot !== 'function') throw new ValidationError(`Fleet transfer ${label} runtime is invalid`); const id = String(value.id ?? value.bot?.id ?? '').trim(); if (!id) throw new ValidationError(`Fleet transfer ${label} requires a bot id`); return { ...value, id }; }
function validateItem(value) { const item = String(value ?? '').trim().toLowerCase(); if (!/^[a-z0-9_.:-]{1,128}$/.test(item)) throw new ValidationError('Fleet transfer item must be a valid registry name'); return item; }
function validateCount(value) { const count = Number(value); if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new ValidationError('Fleet transfer count must be an integer between 1 and 10000'); return count; }
function itemTotal(runtime, item) { return (runtime.adapter.snapshot().inventorySummary ?? []).filter(entry => String(entry?.name).toLowerCase() === item).reduce((sum, entry) => sum + Number(entry.count ?? 0), 0); }
function validateScope(donor, receiver, donorSnapshot, receiverSnapshot) { if (donorSnapshot.dimension !== receiverSnapshot.dimension) throw new ConflictError('Fleet transfer requires the same dimension'); const donorOptions = donor.options ?? {}; const receiverOptions = receiver.options ?? {}; if (String(donorOptions.host ?? 'localhost').toLowerCase() !== String(receiverOptions.host ?? 'localhost').toLowerCase() || Number(donorOptions.port ?? 25565) !== Number(receiverOptions.port ?? 25565)) throw new ConflictError('Fleet transfer requires the same server'); }
function meetingPoint(donor, receiver) { if (!donor || !receiver || ![donor.x, donor.y, donor.z, receiver.x, receiver.y, receiver.z].every(Number.isFinite)) throw new ConflictError('Fleet transfer requires finite bot positions'); return { x: Math.round((donor.x + receiver.x) / 2), y: Math.ceil(Math.max(donor.y, receiver.y)), z: Math.round((donor.z + receiver.z) / 2) }; }
