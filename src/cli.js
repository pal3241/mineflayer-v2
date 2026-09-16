#!/usr/bin/env node
import { config as loadEnvironment } from 'dotenv';
import { createApplication } from './index.js';
import { join, resolve } from 'node:path';
import { loadTrainingSources } from './ml/training-source-loader.js';

loadEnvironment({ path: ['.env', 'config/minehive.env'], quiet: true });

const command = process.argv[2] ?? 'start';
const app = createApplication();

if (command === 'start') {
  await app.start();
  const shutdown = async signal => { app.logger.info('application.signal', { signal }); await app.stop(); process.exitCode = 0; };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
} else if (command === 'health') {
  await app.initialize(); console.log(JSON.stringify(await app.health.check(), null, 2)); await app.stop();
} else if (command === 'status') {
  await app.initialize(); console.log(JSON.stringify(app.status(), null, 2)); await app.stop();
} else if (command === 'backup') {
  await app.initialize();
  if (!app.database) throw new Error('Database backup requires MINEHIVE_DATABASE_DRIVER=sqlite');
  const name = process.argv[3] ?? `minehive-${Date.now()}.sqlite`; if (!/^[A-Za-z0-9_.-]{1,100}\.sqlite$/.test(name)) throw new Error('Backup name must be a safe .sqlite filename');
  console.log(JSON.stringify(await app.database.backup(join(resolve(app.config.dataPath), 'backups', name)), null, 2)); await app.stop();
} else if (command === 'ai') {
  const action = process.argv[3] ?? 'status';
  await app.initialize();
  if (action === 'training' || action === 'train') { const sources = process.argv.slice(4).filter(value => !value.startsWith('--')); const loaded = await loadTrainingSources(sources); console.log(JSON.stringify(await app.localBrain.importTraining(loaded), null, 2)); }
  else if (action === 'status') console.log(JSON.stringify(app.localBrain.status(), null, 2));
  else if (action === 'talk') { const text = process.argv.slice(4).join(' ').trim(); if (!text) throw new Error('Use: npm run ai -- talk <text>'); console.log(app.localBrain.respond(text).reply); }
  else throw new Error(`Unknown AI action '${action}'. Use: training [sources...], status, talk <text>`);
  await app.stop();
} else {
  console.error(`Unknown command '${command}'. Use: start, health, status, backup [name.sqlite], ai training|status|talk`); process.exitCode = 1;
}
