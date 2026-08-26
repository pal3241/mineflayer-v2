import { NotFoundError, ValidationError } from './errors.js';

export class HandlerBus {
  #handlers = new Map();
  constructor(kind) { this.kind = kind; }
  register(type, handler) { if (typeof handler !== 'function') throw new ValidationError(`${this.kind} handler must be a function`); this.#handlers.set(type, handler); }
  async execute(message, context = {}) {
    if (!message?.type) throw new ValidationError(`${this.kind} type is required`);
    const handler = this.#handlers.get(message.type);
    if (!handler) throw new NotFoundError(`${this.kind} handler`, message.type);
    return handler(message.payload ?? {}, context);
  }
}

export class CommandBus extends HandlerBus { constructor() { super('Command'); } }
export class QueryBus extends HandlerBus { constructor() { super('Query'); } }
