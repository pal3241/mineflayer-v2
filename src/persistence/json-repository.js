import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '../core/errors.js';

export class JsonRepository {
  constructor(file) { this.file = file; this.queue = Promise.resolve(); }
  async #read() { try { return JSON.parse(await readFile(this.file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } }
  async #write(data) { await mkdir(dirname(this.file), { recursive: true }); const temporary = `${this.file}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(data, null, 2)); await rename(temporary, this.file); }
  #mutate(operation) { const result = this.queue.then(operation); this.queue = result.catch(() => {}); return result; }
  async create(value) { return this.#mutate(async () => { const data = await this.#read(); const item = { ...value, id: value.id ?? randomUUID() }; if (data[item.id]) throw new ConflictError(`Record '${item.id}' exists`); data[item.id] = item; await this.#write(data); return structuredClone(item); }); }
  async find(id) { const item = (await this.#read())[id]; if (!item) throw new NotFoundError('Record', id); return structuredClone(item); }
  async update(id, patch) { return this.#mutate(async () => { const data = await this.#read(); if (!data[id]) throw new NotFoundError('Record', id); data[id] = { ...data[id], ...patch, id }; await this.#write(data); return structuredClone(data[id]); }); }
  async delete(id) { return this.#mutate(async () => { const data = await this.#read(); if (!data[id]) return false; delete data[id]; await this.#write(data); return true; }); }
  async list() { return Object.values(await this.#read()).map(item => structuredClone(item)); }
}
