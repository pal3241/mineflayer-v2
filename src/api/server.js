import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { MineHiveError, ValidationError } from '../core/errors.js';
import { readFile } from 'node:fs/promises';

const DASHBOARD_FILES = Object.freeze({
  '/': [new URL('../dashboard/index.html', import.meta.url), 'text/html; charset=utf-8'],
  '/dashboard.js': [new URL('../dashboard/dashboard.js', import.meta.url), 'text/javascript; charset=utf-8'],
  '/dashboard.css': [new URL('../dashboard/dashboard.css', import.meta.url), 'text/css; charset=utf-8']
});

async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 1_000_000) throw new ValidationError('Request body too large'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks)); } catch { throw new ValidationError('Request body must be valid JSON'); }
}

export class ApiServer {
  constructor({ application, host, port, logger }) { this.application = application; this.host = host; this.port = port; this.logger = logger; }
  async start() {
    if (this.server) return this.address();
    this.server = createServer(async (req, res) => {
      const requestId = req.headers['x-request-id'] ?? randomUUID(); const started = performance.now();
      const send = (status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': requestId }); res.end(JSON.stringify(value)); };
      const sendFile = async ([file, contentType]) => { res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' }); res.end(await readFile(file)); };
      try {
        const url = new URL(req.url, 'http://localhost'); const parts = url.pathname.split('/').filter(Boolean);
        if (req.method === 'GET' && DASHBOARD_FILES[url.pathname]) return await sendFile(DASHBOARD_FILES[url.pathname]);
        if (req.method === 'GET' && url.pathname === '/health') return send(200, await this.application.health.check());
        if (this.application.config.api.token && req.headers.authorization !== `Bearer ${this.application.config.api.token}`) return send(401, { error: { code: 'UNAUTHORIZED', message: 'Valid bearer token required', requestId } });
        if (req.method === 'GET' && url.pathname === '/api/v1/system/status') return send(200, this.application.status());
        if (req.method === 'GET' && url.pathname === '/api/v1/metrics') return send(200, this.application.metrics.snapshot());
        if (req.method === 'GET' && url.pathname === '/api/v1/bots') return send(200, { data: this.application.bots.list() });
        if (req.method === 'POST' && url.pathname === '/api/v1/bots') return send(201, { data: await this.application.botProfiles.create(await body(req)) });
        if (req.method === 'GET' && url.pathname === '/api/v1/admins') return send(200, { data: this.application.admins.list() });
        if (req.method === 'POST' && url.pathname === '/api/v1/admins') return send(201, { data: await this.application.admins.add((await body(req)).username) });
        if (req.method === 'DELETE' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'admins' && parts[3]) return send(200, { data: await this.application.admins.remove(decodeURIComponent(parts[3])) });
        if (req.method === 'GET' && url.pathname === '/api/v1/goals') return send(200, { data: this.application.goals.list() });
        if (req.method === 'POST' && url.pathname === '/api/v1/goals') return send(201, { data: this.application.goals.create(await body(req)) });
        if (req.method === 'GET' && url.pathname === '/api/v1/tasks') return send(200, { data: this.application.goals.allTasks() });
        if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'goals' && parts[3]) {
          if (req.method === 'GET' && parts.length === 4) return send(200, { data: this.application.goals.get(parts[3]).toDTO(), tasks: this.application.goals.tasks(parts[3]) });
          if (req.method === 'POST' && parts[4] === 'run') return send(200, { data: await this.application.goals.run(parts[3]) });
          if (req.method === 'POST' && parts[4] === 'cancel') return send(200, { data: await this.application.goals.cancel(parts[3], (await body(req)).reason) });
        }
        if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'tasks' && parts[3]) {
          if (req.method === 'GET') return send(200, { data: this.application.goals.task(parts[3]).toDTO() });
          if (req.method === 'POST' && parts[4] === 'cancel') return send(this.application.executor.cancel(parts[3], (await body(req)).reason) ? 202 : 409, { data: this.application.goals.task(parts[3]).toDTO() });
        }
        if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'bots' && parts[3]) {
          if (req.method === 'GET' && parts.length === 4) return send(200, { data: this.application.bots.get(parts[3]).snapshot() });
          if (req.method === 'POST' && parts[4] === 'start') { await this.application.bots.start(parts[3]); return send(202, { data: this.application.bots.get(parts[3]).snapshot() }); }
          if (req.method === 'POST' && parts[4] === 'stop') { await this.application.bots.stop(parts[3]); return send(200, { data: this.application.bots.get(parts[3]).snapshot() }); }
          if (req.method === 'DELETE' && parts.length === 4) { await this.application.stopCamera(parts[3]).catch(() => {}); await this.application.botProfiles.remove(parts[3]); return send(200, { data: { removed: true, id: parts[3] } }); }
          if (req.method === 'POST' && parts[4] === 'camera' && parts[5] === 'start') return send(200, { data: await this.application.startCamera(parts[3]) });
          if (req.method === 'POST' && parts[4] === 'camera' && parts[5] === 'stop') return send(200, { data: await this.application.stopCamera(parts[3]) });
          if (req.method === 'POST' && parts[4] === 'actions' && parts[5]) {
            const input = await body(req); const capability = ({ navigate: 'minecraft.navigation', collect: 'minecraft.collection', follow: 'minecraft.follow-player', chat: 'minecraft.chat', observe: 'minecraft.observation', stop: 'minecraft.stop' })[parts[5]];
            if (!capability) throw new ValidationError(`Unsupported action '${parts[5]}'`);
            const goal = this.application.goals.create({ description: `${parts[5]} for bot ${parts[3]}`, priority: input.priority ?? 50, constraints: { preferredBot: parts[3] }, steps: [{ type: parts[5], input, requiredCapabilities: [capability], timeout: input.timeout ?? 120_000 }] });
            return send(200, { data: await this.application.goals.run(goal.id) });
          }
        }
        if (req.method === 'GET' && url.pathname === '/api/v1/modules') return send(200, { data: this.application.modules.status() });
        if (req.method === 'GET' && url.pathname === '/api/v1/plugins') return send(200, { data: this.application.plugins.status() });
        return send(404, { error: { code: 'NOT_FOUND', message: 'Route not found', requestId } });
      } catch (error) {
        const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : error.code === 'VALIDATION_ERROR' ? 400 : error.code === 'CANCELLED' ? 409 : 500;
        const safe = error instanceof MineHiveError ? error.toJSON() : { code: 'INTERNAL_ERROR', message: 'Internal server error' };
        this.logger.error('api.request.failed', { requestId, error: error.message }); send(status, { error: { ...safe, requestId } });
      } finally { this.application.metrics.increment('api.requests'); this.application.metrics.gauge('api.last_latency_ms', performance.now() - started); }
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, this.host, resolve); });
    return this.address();
  }
  address() { return this.server?.address(); }
  async stop() { if (!this.server) return; await new Promise((resolve, reject) => this.server.close(error => error ? reject(error) : resolve())); this.server = null; }
}
