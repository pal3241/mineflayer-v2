import { randomUUID } from 'node:crypto';
import { ValidationError } from './errors.js';

export class EventBus {
  #handlers = new Map();

  subscribe(type, handler) {
    if (typeof handler !== 'function') throw new ValidationError('Event handler must be a function');
    const handlers = this.#handlers.get(type) ?? new Set();
    handlers.add(handler);
    this.#handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  async publish(type, payload = {}, options = {}) {
    if (!type || !options.source) throw new ValidationError('Event type and source are required');
    const event = Object.freeze({
      id: options.id ?? randomUUID(), type, source: options.source,
      timestamp: options.timestamp ?? new Date().toISOString(),
      correlationId: options.correlationId ?? randomUUID(), payload
    });
    const handlers = [...(this.#handlers.get(type) ?? []), ...(this.#handlers.get('*') ?? [])];
    const results = await Promise.allSettled(handlers.map(handler => handler(event)));
    return { event, results };
  }

  clear() { this.#handlers.clear(); }
}
