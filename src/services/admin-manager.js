import { ValidationError } from '../core/errors.js';

export class AdminManager {
  constructor({ repository, bootstrap = [], target = [] }) { this.repository = repository; this.bootstrap = new Set(bootstrap); this.target = target; this.persisted = new Set(); this.#sync(); }
  async initialize() { for (const record of await this.repository.list()) this.persisted.add(record.id); this.#sync(); }
  #sync() { this.target.splice(0, this.target.length, ...new Set([...this.bootstrap, ...this.persisted])); }
  list() { return this.target.map(username => ({ username, source: this.bootstrap.has(username) ? 'environment' : 'dashboard', removable: !this.bootstrap.has(username) })); }
  async add(username) {
    const value = String(username ?? '').trim(); if (!/^[A-Za-z0-9_]{2,32}$/.test(value)) throw new ValidationError('Admin username must be 2-32 letters, numbers, or underscores');
    if (!this.bootstrap.has(value) && !this.persisted.has(value)) { await this.repository.create({ id: value, username: value }); this.persisted.add(value); this.#sync(); }
    return this.list();
  }
  async remove(username) {
    if (this.bootstrap.has(username)) throw new ValidationError(`Admin '${username}' comes from .env and must be removed there`);
    await this.repository.delete(username); this.persisted.delete(username); this.#sync(); return this.list();
  }
}
