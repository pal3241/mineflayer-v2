import { ValidationError } from '../core/errors.js';

export class DenseClassifier {
  constructor({ inputSize, hiddenSize, labels, seed = 1337, weights = null }) {
    if (!Number.isInteger(inputSize) || inputSize < 1 || !Number.isInteger(hiddenSize) || hiddenSize < 1 || !Array.isArray(labels) || labels.length < 2) throw new ValidationError('Invalid neural classifier dimensions');
    this.inputSize = inputSize; this.hiddenSize = hiddenSize; this.labels = [...labels];
    const random = seeded(seed); const scale1 = Math.sqrt(2 / inputSize); const scale2 = Math.sqrt(2 / hiddenSize);
    this.w1 = weights?.w1 ?? matrix(hiddenSize, inputSize, () => (random() * 2 - 1) * scale1); this.b1 = weights?.b1 ?? Array(hiddenSize).fill(0);
    this.w2 = weights?.w2 ?? matrix(labels.length, hiddenSize, () => (random() * 2 - 1) * scale2); this.b2 = weights?.b2 ?? Array(labels.length).fill(0);
  }
  forward(input) { validateVector(input, this.inputSize); const hidden = this.w1.map((row, i) => relu(dot(row, input) + this.b1[i])); const probabilities = softmax(this.w2.map((row, i) => dot(row, hidden) + this.b2[i])); return { hidden, probabilities }; }
  predict(input) { const { probabilities } = this.forward(input); const index = probabilities.indexOf(Math.max(...probabilities)); return { label: this.labels[index], confidence: probabilities[index], probabilities: Object.fromEntries(this.labels.map((label, i) => [label, probabilities[i]])) }; }
  train(samples, { epochs = 120, learningRate = 0.04, l2 = 0.0001 } = {}) {
    if (!Array.isArray(samples) || !samples.length) throw new ValidationError('Neural training requires samples'); let loss = 0;
    for (let epoch = 0; epoch < epochs; epoch++) { loss = 0; for (const sample of shuffle(samples, epoch + 17)) { validateVector(sample.input, this.inputSize); const target = this.labels.indexOf(sample.label); if (target < 0) throw new ValidationError(`Unknown neural label '${sample.label}'`); const { hidden, probabilities } = this.forward(sample.input); loss -= Math.log(Math.max(1e-9, probabilities[target])); const outputGradient = probabilities.map((value, i) => value - Number(i === target)); const hiddenGradient = hidden.map((value, h) => value > 0 ? this.w2.reduce((sum, row, o) => sum + row[h] * outputGradient[o], 0) : 0);
        for (let o = 0; o < this.w2.length; o++) { for (let h = 0; h < this.hiddenSize; h++) this.w2[o][h] -= learningRate * (outputGradient[o] * hidden[h] + l2 * this.w2[o][h]); this.b2[o] -= learningRate * outputGradient[o]; }
        for (let h = 0; h < this.hiddenSize; h++) { for (let i = 0; i < this.inputSize; i++) this.w1[h][i] -= learningRate * (hiddenGradient[h] * sample.input[i] + l2 * this.w1[h][i]); this.b1[h] -= learningRate * hiddenGradient[h]; }
      } loss /= samples.length; }
    return { epochs, samples: samples.length, loss: round(loss), accuracy: round(this.evaluate(samples).accuracy) };
  }
  evaluate(samples) { const correct = samples.filter(sample => this.predict(sample.input).label === sample.label).length; return { samples: samples.length, correct, accuracy: samples.length ? correct / samples.length : 0 }; }
  serialize() { return { architecture: 'dense-relu-softmax-v1', inputSize: this.inputSize, hiddenSize: this.hiddenSize, labels: this.labels, weights: { w1: this.w1, b1: this.b1, w2: this.w2, b2: this.b2 } }; }
  static restore(value) { return new DenseClassifier(value); }
}

export function hashedTextVector(text, size = 128) { const vector = Array(size).fill(0); const tokens = String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9_\s.-]/g, ' ').split(/\s+/).filter(Boolean); for (const token of tokens) { vector[hash(token) % size] += 1; for (let i = 0; i < token.length - 2; i++) vector[hash(`_${token.slice(i, i + 3)}`) % size] += 0.35; } const norm = Math.hypot(...vector) || 1; return vector.map(value => value / norm); }
function matrix(rows, columns, factory) { return Array.from({ length: rows }, () => Array.from({ length: columns }, factory)); }
function dot(left, right) { return left.reduce((sum, value, i) => sum + value * right[i], 0); }
function relu(value) { return Math.max(0, value); }
function softmax(values) { const max = Math.max(...values); const exponentials = values.map(value => Math.exp(value - max)); const total = exponentials.reduce((sum, value) => sum + value, 0); return exponentials.map(value => value / total); }
function validateVector(value, length) { if (!Array.isArray(value) || value.length !== length || value.some(item => !Number.isFinite(item))) throw new ValidationError(`Neural input must contain ${length} finite values`); }
function seeded(seed) { let state = seed >>> 0; return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296); }
function shuffle(values, seed) { const result = [...values]; const random = seeded(seed); for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; }
function hash(value) { let result = 2166136261; for (const char of value) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); } return result >>> 0; }
function round(value) { return Math.round(value * 10000) / 10000; }
