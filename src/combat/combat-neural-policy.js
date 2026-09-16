const ACTIONS = Object.freeze(['MELEE_PRESSURE', 'RANGED_AIM', 'DIAGONAL_STRAFE', 'HIT_RETREAT_FUSE', 'SURVIVE_HEAL', 'SHIELD_BREAK_WITH_AXE', 'RETREAT']);
const ACTION_INDEX = new Map(ACTIONS.map((action, index) => [action, index]));

export function createCombatNeuralPolicy({ hiddenSize = 16, learningRate = 0.015 } = {}) {
  const inputSize = 8; const hidden = Math.max(4, Math.min(64, Number(hiddenSize) || 16)); const rate = Math.max(0.0001, Math.min(0.1, Number(learningRate) || 0.015));
  const w1 = Array.from({ length: hidden }, (_, row) => Array.from({ length: inputSize }, (_, col) => seeded(row * inputSize + col + 1) * 0.14));
  const b1 = Array(hidden).fill(0); const w2 = Array.from({ length: ACTIONS.length }, (_, row) => Array.from({ length: hidden }, (_, col) => seeded(700 + row * hidden + col) * 0.12));
  const b2 = Array(ACTIONS.length).fill(0); let samples = 0; let loss = 0;

  function forward(state) {
    const x = features(state); const h = w1.map((row, index) => Math.max(0, dot(row, x) + b1[index])); const y = w2.map((row, index) => dot(row, h) + b2[index]);
    return { x, h, y };
  }
  function observe({ state = {}, action, reward = 0 } = {}) {
    const index = ACTION_INDEX.get(normalizeAction(action)); if (index === undefined) return status();
    const { x, h, y } = forward(state); const target = Math.max(-1, Math.min(1, Number(reward) / 20)); const error = y[index] - target;
    const oldOutput = [...w2[index]];
    for (let j = 0; j < hidden; j++) w2[index][j] -= rate * error * h[j];
    b2[index] -= rate * error;
    for (let j = 0; j < hidden; j++) {
      if (h[j] <= 0) continue;
      const gradient = error * oldOutput[j];
      for (let k = 0; k < inputSize; k++) w1[j][k] -= rate * gradient * x[k];
      b1[j] -= rate * gradient;
    }
    samples++; loss = loss * 0.95 + error * error * 0.05; return status();
  }
  function recommend(state = {}, fallback = 'MELEE_PRESSURE') {
    const { y } = forward(state); const bestIndex = y.reduce((best, value, index) => value > y[best] ? index : best, 0); const fallbackIndex = ACTION_INDEX.get(normalizeAction(fallback));
    const confidence = 1 / (1 + Math.exp(-(y[bestIndex] - (fallbackIndex === undefined ? 0 : y[fallbackIndex]))));
    return { action: samples >= 20 && confidence >= 0.56 ? ACTIONS[bestIndex] : normalizeAction(fallback), suggestedAction: ACTIONS[bestIndex], confidence: Number(confidence.toFixed(3)), samples, active: samples >= 20 };
  }
  function status() { return { architecture: `${inputSize}-${hidden}-${ACTIONS.length}`, actions: ACTIONS, samples, rollingLoss: Number(loss.toFixed(6)), learningRate: rate }; }
  return Object.freeze({ observe, recommend, status });
}
function features(state = {}) {
  const health = clamp(Number(state.health ?? 20) / 20); const distance = clamp(Number(state.distance ?? 4) / 16); const mob = String(state.mob ?? '').toLowerCase();
  const inventory = new Set((state.inventory ?? []).map(value => typeof value === 'string' ? value : value?.name));
  return [health, distance, state.onFire ? 1 : 0, mob === 'creeper' ? 1 : 0, mob === 'skeleton' ? 1 : 0, inventory.has('bow') || inventory.has('crossbow') ? 1 : 0, inventory.has('golden_apple') || inventory.has('splash_potion_of_healing') ? 1 : 0, inventoryHasAxe(inventory) ? 1 : 0];
}
function inventoryHasAxe(inventory) { return [...inventory].some(name => String(name).endsWith('_axe')); }
function normalizeAction(action) { const value = String(action ?? '').toUpperCase(); return ACTION_INDEX.has(value) ? value : 'MELEE_PRESSURE'; }
function dot(a, b) { return a.reduce((total, value, index) => total + value * b[index], 0); }
function clamp(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function seeded(value) { const x = Math.sin(value * 12.9898) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
