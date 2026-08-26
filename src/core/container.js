import { ConflictError, NotFoundError, ValidationError } from './errors.js';

export class Container {
  #entries = new Map();

  register(name, value, { replace = false } = {}) {
    if (!name) throw new ValidationError('Dependency name is required');
    if (this.#entries.has(name) && !replace) throw new ConflictError(`Dependency '${name}' already registered`);
    this.#entries.set(name, { value, resolved: typeof value !== 'function' });
    return this;
  }

  resolve(name) {
    const entry = this.#entries.get(name);
    if (!entry) throw new NotFoundError('Dependency', name);
    if (!entry.resolved) {
      entry.value = entry.value(this);
      entry.resolved = true;
    }
    return entry.value;
  }

  has(name) { return this.#entries.has(name); }
}
