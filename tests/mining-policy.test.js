import assert from 'node:assert/strict';
import test from 'node:test';
import { isOreBlock, prioritizeMiningTargets } from '../src/plugins/minecraft/mining-policy.js';

const profile = (id, values = {}) => ({ block: { id }, exposedFaces: 0, hazard: false, skyLight: 0, distance: 10, descent: 0, withinGroup: true, ...values });

test('ore detection covers every game stage and excludes ordinary blocks', () => {
  for (const name of ['coal_ore','deepslate_iron_ore','diamond_ore','nether_quartz_ore','ancient_debris']) assert.equal(isOreBlock(name), true, name);
  assert.equal(isOreBlock('stone'), false);
});

test('universal cave-first policy prefers safe exposed ore before shallow buried fallback', () => {
  const targets = prioritizeMiningTargets([
    profile('buried-near', { distance: 2, descent: 2 }),
    profile('surface', { exposedFaces: 2, skyLight: 15, distance: 3 }),
    profile('cave', { exposedFaces: 1, skyLight: 0, distance: 8 }),
    profile('lava', { exposedFaces: 4, hazard: true, distance: 1 }),
    profile('deep-strip', { distance: 1, descent: 8 })
  ]);
  assert.deepEqual(targets.map(value => value.id), ['cave','surface','buried-near']);
});

test('strict cave expedition refuses buried ore and targets beyond the group leash', () => {
  const targets = prioritizeMiningTargets([
    profile('buried', { distance: 1 }),
    profile('separated', { exposedFaces: 2, withinGroup: false }),
    profile('safe-cave', { exposedFaces: 1, distance: 5 })
  ], { avoidStripMining: true });
  assert.deepEqual(targets.map(value => value.id), ['safe-cave']);
});
