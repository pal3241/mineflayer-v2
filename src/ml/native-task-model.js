import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export class NativeTaskModel {
  constructor({ binary = process.env.MINEHIVE_NATIVE_ML_BIN ?? defaultBinary() } = {}) { this.binary = binary; }
  available() { return existsSync(this.binary); }
  async train(samples, options = {}) { return this.#call({ action:'train', samples, epochs:options.epochs ?? 180, learning_rate:options.learningRate ?? 0.045, weights:options.weights, bias:options.bias }); }
  async predict(input, model) { return this.#call({ action:'predict', input, weights:model.weights, bias:model.bias }); }
  #call(payload) { return new Promise((resolvePromise, reject) => { const child=spawn(this.binary, [], { stdio:['pipe','pipe','pipe'] }); let output='', error=''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { error += value; }); child.on('error', reject); child.on('close', code => { if (code !== 0) return reject(new Error(`Native ML exited ${code}: ${error.trim()}`)); try { resolvePromise(JSON.parse(output)); } catch (cause) { reject(new Error(`Native ML returned invalid JSON: ${cause.message}`)); } }); child.stdin.end(JSON.stringify(payload)); }); }
}
function defaultBinary() { const name=process.platform==='win32'?'minehive-native-ml.exe':'minehive-native-ml'; return join(resolve('native-ml'),'target','release',name); }
