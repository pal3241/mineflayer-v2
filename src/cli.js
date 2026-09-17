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
  if (action === 'training' || action === 'train') { const options=parseTrainingArguments(process.argv.slice(4)); const loaded=await loadTrainingSources(options.sources,{maxBytes:options.maxBytes,onProgress:printTrainingProgress}); console.error(`Training PyTorch model for ${options.epochs} epoch(s)…`); console.log(JSON.stringify(await app.localBrain.importTraining({...loaded,epochs:options.epochs,onProgress:printTrainingProgress}),null,2)); }
  else if (action === 'status') console.log(JSON.stringify(app.localBrain.status(), null, 2));
  else if (action === 'talk') { const text = process.argv.slice(4).join(' ').trim(); if (!text) throw new Error('Use: npm run ai -- talk <text>'); console.log((await app.localBrain.respond(text)).reply); }
  else if (action === 'save') { const target=process.argv[4]??join(resolve(app.config.dataPath),'local-ai','minehive-local-ai-export.pt'); console.log(JSON.stringify(await app.localBrain.save(resolve(target)),null,2)); }
  else throw new Error(`Unknown AI action '${action}'. Use: training [--epochs N] [sources...], save [model.pt], status, talk <text>`);
  await app.stop();
} else {
  console.error(`Unknown command '${command}'. Use: start, health, status, backup [name.sqlite], ai training|status|talk`); process.exitCode = 1;
}

function parseTrainingArguments(args){ let epochs=12,maxBytes=100_000_000;const sources=[];for(let i=0;i<args.length;i++){const value=args[i];if(value==='--epochs'){epochs=Number(args[++i]);continue;}if(value.startsWith('--epochs=')){epochs=Number(value.slice(9));continue;}if(value==='--max-bytes'){maxBytes=Number(args[++i]);continue;}if(value.startsWith('--max-bytes=')){maxBytes=Number(value.slice(12));continue;}sources.push(value);}if(!Number.isInteger(epochs)||epochs<1||epochs>500)throw new Error('--epochs must be an integer from 1 to 500');if(!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>1_000_000_000)throw new Error('--max-bytes must be between 1024 and 1000000000');return {epochs,maxBytes,sources};}
let activeProgress='';
function printTrainingProgress(progress){if(progress.phase==='reading'||progress.phase==='read'){finishProgress();const total=progress.total?`${progress.index}/${progress.total}`:'';console.error(`[${progress.phase}] ${total} ${progress.source}`);return;}const percent=Math.max(0,Math.min(100,Number(progress.percent??0)));const width=24;const filled=Math.round(width*percent/100);const bar=`${'█'.repeat(filled)}${'░'.repeat(width-filled)}`;const detail=progress.phase==='preparing'?`${progress.texts}/${progress.totalTexts} text`:progress.phase==='training'?`epoch ${progress.epoch}/${progress.epochs} · batch ${progress.batch}/${progress.batches} · loss ${progress.loss}`:'saving checkpoint';const line=`[${bar}] ${percent.toFixed(1)}% ${detail}`;process.stderr.write(`\r${line}`);activeProgress=line;if(percent>=100||progress.phase==='saving')finishProgress();}
function finishProgress(){if(!activeProgress)return;process.stderr.write('\n');activeProgress='';}
