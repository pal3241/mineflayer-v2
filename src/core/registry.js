import { ConflictError, NotFoundError, ValidationError } from './errors.js';

export class Registry {
  #items = new Map();
  constructor(kind = 'item') { this.kind = kind; }

  register(item) {
    if (!item?.name) throw new ValidationError(`${this.kind} must have a name`);
    if (this.#items.has(item.name)) throw new ConflictError(`${this.kind} '${item.name}' already registered`);
    this.#items.set(item.name, item);
    return item;
  }
  get(name) { const item = this.#items.get(name); if (!item) throw new NotFoundError(this.kind, name); return item; }
  has(name) { return this.#items.has(name); }
  remove(name) { return this.#items.delete(name); }
  list() { return [...this.#items.values()]; }
}

export class ComponentRegistry extends Registry {
  constructor(kind) { super(kind); this.states = new Map(); }

  register(component) {
    for (const method of ['initialize', 'start', 'stop']) {
      if (typeof component?.[method] !== 'function') throw new ValidationError(`${this.kind} '${component?.name ?? '?'}' needs ${method}()`);
    }
    const result = super.register(component);
    this.states.set(component.name, 'REGISTERED');
    return result;
  }

  async run(hook, context, { reverse = false } = {}) {
    const components = reverse ? this.list().reverse() : this.list();
    for (const component of components) {
      if (hook === 'initialize' && this.states.get(component.name) !== 'REGISTERED') continue;
      if (hook === 'start' && this.states.get(component.name) !== 'INITIALIZED') continue;
      if (hook === 'stop' && this.states.get(component.name) !== 'STARTED') continue;
      await component[hook](context);
      this.states.set(component.name, hook === 'initialize' ? 'INITIALIZED' : hook === 'start' ? 'STARTED' : 'STOPPED');
    }
  }

  status() { return this.list().map(component => ({ name: component.name, version: component.version, status: this.states.get(component.name) })); }
}
