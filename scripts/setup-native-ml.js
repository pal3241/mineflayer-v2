#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const termux = process.platform === 'android' || String(process.env.PREFIX ?? '').includes('com.termux');
if (termux) {
  console.log('Installing Rust compiler from Termux…');
  const install = spawnSync('pkg', ['install', '-y', 'rust'], { stdio:'inherit' });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
const build = spawnSync('cargo', ['build', '--manifest-path', 'native-ml/Cargo.toml', '--release'], { stdio:'inherit' });
if (build.error) throw build.error;
process.exit(build.status ?? 1);
