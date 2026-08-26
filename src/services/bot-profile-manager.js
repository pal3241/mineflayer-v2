import { randomUUID } from 'node:crypto';
import { ValidationError } from '../core/errors.js';
import { ConflictError } from '../core/errors.js';

export class BotProfileManager {
  constructor({ repository, botManager }) { this.repository = repository; this.bots = botManager; }
  async initialize() { const profiles = await this.repository.list(); for (const profile of profiles) if (!this.bots.list().some(bot => bot.id === profile.id)) this.bots.create(profile); return profiles; }
  async create(input) {
    const profile = normalize(input); const alias = profile.metadata.commandAlias.toLowerCase();
    if (this.bots.list().some(bot => String(bot.metadata.commandAlias ?? bot.name).toLowerCase() === alias)) throw new ConflictError(`Bot command alias '${profile.metadata.commandAlias}' already exists`);
    const bot = this.bots.create(profile);
    try { await this.repository.create(profile); } catch (error) { await this.bots.remove(bot.id); throw error; }
    return bot;
  }
  async remove(id) { await this.bots.remove(id); await this.repository.delete(id); return true; }
  async update(id, input) {
    const runtime = this.bots.get(id); const current = await this.repository.find(id);
    const commandAlias = String(input.commandAlias ?? current.metadata?.commandAlias ?? runtime.bot.name).trim(); const className = String(input.className ?? current.metadata?.className ?? 'worker').trim();
    if (!/^[A-Za-z0-9_-]{2,32}$/.test(commandAlias) || !/^[A-Za-z0-9_-]{2,32}$/.test(className)) throw new ValidationError('Command alias and class must be 2-32 letters, numbers, hyphens, or underscores');
    if (this.bots.list().some(bot => bot.id !== id && String(bot.metadata.commandAlias ?? bot.name).toLowerCase() === commandAlias.toLowerCase())) throw new ConflictError(`Bot command alias '${commandAlias}' already exists`);
    runtime.bot.metadata = { ...runtime.bot.metadata, commandAlias, className }; await this.repository.update(id, { metadata: runtime.bot.metadata }); return runtime.snapshot();
  }
  async list() { return this.repository.list(); }
}

function normalize(input) {
  const username = String(input.username ?? input.name ?? '').trim(); if (!username) throw new ValidationError('Bot username is required');
  const port = Number.parseInt(input.port ?? 25565, 10); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValidationError('Invalid Minecraft port');
  const derivedAlias = String(input.name ?? username).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32); const commandAlias = String(input.commandAlias ?? input.metadata?.commandAlias ?? derivedAlias).trim(); const className = String(input.className ?? input.metadata?.className ?? 'worker').trim();
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(commandAlias) || !/^[A-Za-z0-9_-]{2,32}$/.test(className)) throw new ValidationError('Command alias and class must be 2-32 letters, numbers, hyphens, or underscores');
  return { id: input.id ?? randomUUID(), name: input.name ?? username, username, host: input.host ?? 'localhost', port, auth: input.auth ?? 'offline', version: input.version || undefined,
    autoConnect: Boolean(input.autoConnect), capabilities: input.capabilities, metadata: { ...(input.metadata ?? {}), commandAlias, className } };
}
