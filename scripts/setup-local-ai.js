#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const termux = process.platform === 'android' || String(process.env.PREFIX ?? '').includes('com.termux');
const command = termux ? 'pkg' : (process.env.MINEHIVE_PYTHON ?? 'python3');
const args = termux ? ['install', '-y', 'python-torch'] : ['-m', 'pip', 'install', '-r', 'requirements-local-ai.txt'];

console.log(termux ? 'Installing the Termux python-torch package…' : 'Installing CPU PyTorch from requirements-local-ai.txt…');
const installation = spawnSync(command, args, { stdio: 'inherit' });
if (installation.error) throw installation.error;
if (installation.status !== 0) process.exit(installation.status ?? 1);

const python = process.env.MINEHIVE_PYTHON ?? 'python3';
const check = spawnSync(python, ['-c', "import torch; print('PyTorch', torch.__version__, 'ready')"], { stdio: 'inherit' });
if (check.error) throw check.error;
process.exit(check.status ?? 1);
