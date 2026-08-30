import { ConflictError, ValidationError } from '../core/errors.js';

export function createFleetTransferService({ events }) {
  const transfer = async input => {
    const donor = validateRuntime(input.donor, 'donor'); const receiver = validateRuntime(input.receiver, 'receiver'); const item = validateItem(input.item); const count = validateCount(input.count);
    if (donor.id === receiver.id) throw new ConflictError('Fleet transfer requires different donor and receiver bots');
    const donorBefore = itemTotal(donor, item); const receiverBefore = itemTotal(receiver, item); if (donorBefore < count) throw new ConflictError(`Fleet donor '${donor.id}' has only ${donorBefore} '${item}'`, { donorId: donor.id, item, requested: count, available: donorBefore });
    const donorSnapshot = donor.adapter.snapshot(); const receiverSnapshot = receiver.adapter.snapshot(); validateScope(donor, receiver, donorSnapshot, receiverSnapshot); const meeting = meetingPoint(donorSnapshot.position, receiverSnapshot.position);
    await events?.publish('fleet.transfer.planned', { donorId: donor.id, receiverId: receiver.id, item, count, meeting }, { source: 'fleet-transfer' });
    try {
      await Promise.all([donor.adapter.smartMove({ ...meeting, range: 2 }, { signal: input.signal }), receiver.adapter.smartMove({ ...meeting, range: 2 }, { signal: input.signal })]); await events?.publish('fleet.transfer.started', { donorId: donor.id, receiverId: receiver.id, item, count, meeting }, { source: 'fleet-transfer' });
      await donor.adapter.dropItem({ item, count }); await receiver.adapter.pickupItem({ item, count }, { signal: input.signal });
      const donorAfter = itemTotal(donor, item); const receiverAfter = itemTotal(receiver, item); if (donorAfter !== donorBefore - count || receiverAfter !== receiverBefore + count) throw new ConflictError(`Fleet transfer verification failed for '${item}'`, { item, requested: count, donorBefore, donorAfter, receiverBefore, receiverAfter });
      const result = { donorId: donor.id, receiverId: receiver.id, item, requested: count, donorBefore, donorAfter, receiverBefore, receiverAfter, transferred: count, meeting, verified: true }; await events?.publish('fleet.transfer.completed', result, { source: 'fleet-transfer' }); return result;
    } catch (error) { await events?.publish('fleet.transfer.failed', { donorId: donor.id, receiverId: receiver.id, item, requested: count, code: error.code ?? 'TRANSFER_FAILED', error: error.message }, { source: 'fleet-transfer' }); throw error; }
  };
  return Object.freeze({ transfer });
}

function validateRuntime(value, label) { if (!value || typeof value !== 'object' || !value.adapter || typeof value.adapter.snapshot !== 'function') throw new ValidationError(`Fleet transfer ${label} runtime is invalid`); const id = String(value.id ?? value.bot?.id ?? '').trim(); if (!id) throw new ValidationError(`Fleet transfer ${label} requires a bot id`); return { ...value, id }; }
function validateItem(value) { const item = String(value ?? '').trim().toLowerCase(); if (!/^[a-z0-9_.:-]{1,128}$/.test(item)) throw new ValidationError('Fleet transfer item must be a valid registry name'); return item; }
function validateCount(value) { const count = Number(value); if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new ValidationError('Fleet transfer count must be an integer between 1 and 10000'); return count; }
function itemTotal(runtime, item) { return (runtime.adapter.snapshot().inventorySummary ?? []).filter(entry => String(entry?.name).toLowerCase() === item).reduce((sum, entry) => sum + Number(entry.count ?? 0), 0); }
function validateScope(donor, receiver, donorSnapshot, receiverSnapshot) { if (donorSnapshot.dimension !== receiverSnapshot.dimension) throw new ConflictError('Fleet transfer requires the same dimension'); const donorOptions = donor.options ?? {}; const receiverOptions = receiver.options ?? {}; if (String(donorOptions.host ?? 'localhost').toLowerCase() !== String(receiverOptions.host ?? 'localhost').toLowerCase() || Number(donorOptions.port ?? 25565) !== Number(receiverOptions.port ?? 25565)) throw new ConflictError('Fleet transfer requires the same server'); }
function meetingPoint(donor, receiver) { if (!donor || !receiver || ![donor.x, donor.y, donor.z, receiver.x, receiver.y, receiver.z].every(Number.isFinite)) throw new ConflictError('Fleet transfer requires finite bot positions'); return { x: Math.round((donor.x + receiver.x) / 2), y: Math.ceil(Math.max(donor.y, receiver.y)), z: Math.round((donor.z + receiver.z) / 2) }; }
