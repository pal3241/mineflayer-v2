import { randomUUID } from 'node:crypto';
import { NavigationError } from './navigation-error.js';

const ACTIVE = new Set(['ACTIVE', 'PARTIALLY_USED']);

export function createResourceReservationService() {
  const reservations = new Map();
  const reserve = input => {
    const item = normalizedItem(input.item); const count = positive(input.count, 'count'); const available = availableFor({ botId: input.botId, item, inventory: input.inventory });
    if (count > available) throw new NavigationError('SCAFFOLD_RESOURCE_UNAVAILABLE', `Only ${available} unreserved '${item}' available for scaffolding`, { botId: input.botId, item, requested: count, available });
    const now = new Date().toISOString(); const reservation = { id: `SCAF-${randomUUID()}`, reservationId: null, sessionId: String(input.sessionId), botId: String(input.botId), item, reserved: count, used: 0, reason: 'NAVIGATION_SCAFFOLD', status: 'ACTIVE', createdAt: now, updatedAt: now }; reservation.reservationId = reservation.id; reservations.set(reservation.id, reservation); return copy(reservation);
  };
  const commit = input => {
    const current = required(reservations, input.leaseId); const count = positive(input.count, 'count'); if (!ACTIVE.has(current.status)) throw new NavigationError('SCAFFOLD_RESERVATION_FAILED', `Scaffold lease '${current.id}' is ${current.status}`, { leaseId: current.id }); if (current.used + count > current.reserved) throw new NavigationError('SCAFFOLD_BUDGET_EXHAUSTED', `Scaffold lease '${current.id}' has no remaining blocks`, { leaseId: current.id }); const next = { ...current, used: current.used + count, status: current.used + count === current.reserved ? 'PARTIALLY_USED' : 'PARTIALLY_USED', updatedAt: new Date().toISOString() }; reservations.set(next.id, next); return copy(next);
  };
  const release = input => { const current = required(reservations, input.leaseId); const next = { ...current, status: 'RELEASED', releasedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; reservations.set(next.id, next); return copy(next); };
  const available = input => availableFor(input);
  const reservationsForBot = botId => [...reservations.values()].filter(entry => entry.botId === String(botId)).map(copy);
  return Object.freeze({ reserve, commit, release, available, reservationsForBot });
  function availableFor(input) { const inventoryCount = itemCount(input.inventory, input.item); const reserved = [...reservations.values()].filter(entry => entry.botId === String(input.botId) && entry.item === normalizedItem(input.item) && ACTIVE.has(entry.status)).reduce((sum, entry) => sum + entry.reserved - entry.used, 0); return Math.max(0, inventoryCount - reserved); }
}

function required(reservations, id) { const value = reservations.get(String(id)); if (!value) throw new NavigationError('SCAFFOLD_RESERVATION_FAILED', `Scaffold lease '${id}' was not found`, { leaseId: id }); return value; }
function itemCount(inventory, item) { return (Array.isArray(inventory) ? inventory : []).filter(entry => normalizedItem(entry?.name) === normalizedItem(item)).reduce((sum, entry) => sum + Number(entry.count ?? 0), 0); }
function normalizedItem(value) { const item = String(value ?? '').trim().toLowerCase(); if (!/^[a-z0-9_]{1,128}$/.test(item)) throw new NavigationError('SCAFFOLD_RESOURCE_UNAVAILABLE', 'Scaffold item is invalid', { item: value }); return item; }
function positive(value, field) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new NavigationError('SCAFFOLD_RESERVATION_FAILED', `${field} must be a positive integer`, { [field]: value }); return number; }
function copy(value) { return structuredClone(value); }
