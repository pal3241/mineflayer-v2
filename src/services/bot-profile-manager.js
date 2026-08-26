import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';

export class BotProfileManager {
  constructor({ repository, botManager }) { this.repository = repository; this.bots = botManager; }
  async initialize() { const profiles = await this.repository.list(); for (const profile of profiles) if (!this.bots.list().some(bot => bot.id === profile.id)) this.bots.create(profile); return profiles; }
  async create(input) {
    const profile = normalize(input); const bot = this.bots.create(profile);
    try { await this.repository.create(profile); } catch (error) { await this.bots.remove(bot.id); throw error; }
    return bot;
  }
  async remove(id) { await this.bots.remove(id); await this.repository.delete(id); return true; }
  async list() { return this.repository.list(); }
}

function normalize(input) {
  const username = String(input.username ?? input.name ?? '').trim(); if (!username) throw new ValidationError('Bot username is required');
  const port = Number.parseInt(input.port ?? 25565, 10); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValidationError('Invalid Minecraft port');
  return { id: input.id ?? randomUUID(), name: input.name ?? username, username, host: input.host ?? 'localhost', port, auth: input.auth ?? 'offline', version: input.version || undefined,
    autoConnect: Boolean(input.autoConnect), capabilities: input.capabilities, metadata: input.metadata ?? {} };
}
