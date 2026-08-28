import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from '../core/errors.js';

export class RotatingLogStore {
  constructor({ directory, maxFiles }) {
    if (typeof directory !== 'string' || !directory.trim()) throw new ValidationError('Log directory is required');
    if (!Number.isInteger(maxFiles) || maxFiles !== 3) throw new ValidationError('Rotating log store must retain exactly three files');
    this.directory = resolve(directory); this.maxFiles = maxFiles; mkdirSync(this.directory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); this.name = `minehive-${timestamp}-${process.pid}-${randomUUID().slice(0, 8)}.jsonl`; this.file = join(this.directory, this.name); this.queue = Promise.resolve(); this.failure = null; writeFileSync(this.file, '', { flag: 'wx' }); this.#rotate();
  }
  write(record) { if (this.failure) throw this.failure; const operation = this.queue.then(() => appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8')); this.queue = operation.catch(error => { this.failure = error; }); }
  async flush() { await this.queue; if (this.failure) throw this.failure; }
  list() { return this.#files().sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt)); }
  read(name, limit) { if (!/^minehive-[A-Za-z0-9_.-]+\.jsonl$/.test(String(name))) throw new ValidationError('Saved log name is invalid'); if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new ValidationError('Saved log limit must be between 1 and 5000'); const file = resolve(this.directory, name); if (dirname(file) !== this.directory) throw new ValidationError('Saved log path is outside the log directory'); return readJsonLines(file, name, limit); }
  #files() { return readdirSync(this.directory, { withFileTypes: true }).filter(entry => entry.isFile() && /^minehive-[A-Za-z0-9_.-]+\.jsonl$/.test(entry.name)).map(entry => { const details = statSync(join(this.directory, entry.name)); return { name: entry.name, size: details.size, modifiedAt: details.mtime.toISOString(), active: entry.name === this.name }; }); }
  #rotate() { const previous = this.#files().filter(item => !item.active).sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || right.name.localeCompare(left.name)); for (const item of previous.slice(this.maxFiles - 1)) { const target = resolve(this.directory, item.name); if (dirname(target) !== this.directory || basename(target) !== item.name) throw new ValidationError('Refusing to delete a log outside the configured directory'); unlinkSync(target); } }
}

function readJsonLines(file, name, limit) { let content; try { content = readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') throw new NotFoundError('Saved log', name); throw error; } const lines = content.split(/\r?\n/).filter(Boolean).slice(-limit); return lines.map((line, index) => { try { return JSON.parse(line); } catch (error) { throw new ValidationError(`Saved log '${name}' contains invalid JSON at selected line ${index + 1}`, { cause: error.message }); } }); }
