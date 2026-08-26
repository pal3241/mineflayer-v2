import { ConflictError, NotFoundError } from '../core/errors.js';

export class MemoryRepository {
  #items = new Map();
  async create(value) { if (this.#items.has(value.id)) throw new ConflictError(`Record '${value.id}' exists`); this.#items.set(value.id, structuredClone(value)); return structuredClone(value); }
  async find(id) { if (!this.#items.has(id)) throw new NotFoundError('Record', id); return structuredClone(this.#items.get(id)); }
  async update(id, patch) { const value = await this.find(id); return this.#items.set(id, { ...value, ...structuredClone(patch), id }).get(id); }
  async delete(id) { return this.#items.delete(id); }
  async list() { return [...this.#items.values()].map(value => structuredClone(value)); }
}
