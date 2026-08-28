import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.js';

export class SqliteDatabase {
  constructor({ file }) {
    if (typeof file !== 'string' || !file.trim()) throw new ValidationError('SQLite database file is required');
    this.file = resolve(file); mkdirSync(dirname(this.file), { recursive: true }); this.connection = new Database(this.file);
    this.connection.pragma('journal_mode = WAL'); this.connection.pragma('foreign_keys = ON'); this.connection.pragma('busy_timeout = 5000'); this.#migrate();
  }
  repository(domain) { return new SqliteRepository(this.connection, domain); }
  transaction(operation) { if (typeof operation !== 'function') throw new ValidationError('Database transaction operation must be a function'); return this.connection.transaction(operation)(); }
  async backup(destination) { const target = resolve(destination); mkdirSync(dirname(target), { recursive: true }); await this.connection.backup(target); return { source: this.file, destination: target, createdAt: new Date().toISOString() }; }
  health() { const started = performance.now(); const integrity = this.connection.pragma('quick_check', { simple: true }); return { status: integrity === 'ok' ? 'HEALTHY' : 'FAILED', latencyMs: Math.round((performance.now() - started) * 100) / 100, schemaVersion: this.connection.pragma('user_version', { simple: true }), file: this.file }; }
  close() { if (this.connection.open) this.connection.close(); }
  #migrate() {
    const version = this.connection.pragma('user_version', { simple: true });
    if (version > 1) throw new ConflictError(`Database schema ${version} is newer than supported schema 1`);
    if (version === 0) this.connection.transaction(() => { this.connection.exec('CREATE TABLE IF NOT EXISTS records (domain TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (domain, id)); CREATE INDEX IF NOT EXISTS records_domain_updated ON records(domain, updated_at DESC); CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);'); this.connection.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString()); this.connection.pragma('user_version = 1'); })();
  }
}

export class SqliteRepository {
  constructor(connection, domain) { if (!/^[a-z0-9_-]{1,64}$/.test(String(domain))) throw new ValidationError('Repository domain must contain only lowercase letters, numbers, underscore, or dash'); this.connection = connection; this.domain = domain; }
  async create(value) { const item = structuredClone({ ...value, id: value.id ?? randomUUID() }); const now = new Date().toISOString(); try { this.connection.prepare('INSERT INTO records(domain, id, data, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(this.domain, item.id, JSON.stringify(item), now, now); } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw new ConflictError(`Record '${item.id}' exists`); throw error; } return item; }
  async find(id) { const row = this.connection.prepare('SELECT data FROM records WHERE domain = ? AND id = ?').get(this.domain, id); if (!row) throw new NotFoundError('Record', id); return parseRecord(row.data, this.domain, id); }
  async update(id, patch) { const current = await this.find(id); const version = Number(current.version ?? 1); const item = structuredClone({ ...current, ...patch, id, version: version + 1 }); const updatedAt = new Date().toISOString(); const result = this.connection.prepare('UPDATE records SET data = ?, version = ?, updated_at = ? WHERE domain = ? AND id = ? AND version = ?').run(JSON.stringify(item), version + 1, updatedAt, this.domain, id, version); if (!result.changes) throw new ConflictError(`Record '${id}' was modified concurrently`); return item; }
  async delete(id) { return this.connection.prepare('DELETE FROM records WHERE domain = ? AND id = ?').run(this.domain, id).changes > 0; }
  async list() { return this.connection.prepare('SELECT id, data FROM records WHERE domain = ? ORDER BY updated_at DESC').all(this.domain).map(row => parseRecord(row.data, this.domain, row.id)); }
}

function parseRecord(value, domain, id) { try { return JSON.parse(value); } catch (error) { throw new ValidationError(`Stored record '${domain}/${id}' contains invalid JSON`, { cause: error.message }); } }
