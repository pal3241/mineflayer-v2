import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRepository } from '../src/persistence/memory-repository.js';
import { createNavigationSettingsService } from '../src/navigation/index.js';

test('movement settings persist presets and resolve bot overrides over global policy', async () => {
  const repository = new MemoryRepository(); const service = createNavigationSettingsService({ repository }); await service.initialize(); await service.applyPreset({ scope: 'GLOBAL', preset: 'SAFE' }); await service.configure({ scope: 'BOT', botId: 'miner-01', settings: { scaffold: { enabled: true, maxBlocks: 12, preference: ['dirt', 'cobblestone'] }, pillar: { enabled: true, maxHeight: 8, maxAttempts: 2 } } }); const policy = service.resolve({ botId: 'miner-01' }); assert.equal(policy.allowScaffolding, true); assert.equal(policy.allowTower, true); assert.equal(policy.maxPillarHeight, 8); assert.deepEqual(policy.scaffoldPreference, ['dirt', 'cobblestone']); const restored = createNavigationSettingsService({ repository }); await restored.initialize(); assert.equal(restored.get({ scope: 'BOT', botId: 'miner-01' }).settings.pillar.maxHeight, 8);
});

test('movement settings expose no switch that can consume protected resources', async () => {
  const service = createNavigationSettingsService({ repository: new MemoryRepository() }); await service.initialize(); const serialized = JSON.stringify(service.get({ scope: 'GLOBAL' })); for (const forbidden of ['allowTaskResources', 'allowProtectedResources', 'TASK_OUTPUT', 'ACQUISITION_RESERVED', 'LOGISTICS_RESERVED', 'RECOVERY_RESERVED']) assert.equal(serialized.includes(forbidden), false);
});

test('movement settings wire every dashboard group into the effective runtime policy', async () => {
  const service = createNavigationSettingsService({ repository: new MemoryRepository() }); await service.initialize(); await service.configure({ scope: 'GLOBAL', settings: { movement: { allowSprint: false, allowJump: false, allowParkour: true, allowFreeMotion: true, maxDrop: 7 }, water: { allowSwimming: false, allowEnterWater: false, allowDeepWater: true, allowUnderwaterRoute: true, maxDepth: 12, maxUnderwaterDurationMs: 25_000 }, recovery: { enabled: true, maxAttempts: 9, maxReplans: 1, cooldownMs: 333, restartPath: false, microEscape: true, alternateApproach: false, safeScaffold: false }, microEscape: { enabled: true, jump: false, backward: true, strafeLeft: false, strafeRight: true, maxAttempts: 6, minimumDisplacement: 1.25 }, pillar: { repeatedFailureLimit: 5 }, bridge: { maxAttempts: 4 } } });
  const policy = service.resolve({ botId: 'bot1' }); assert.equal(policy.allowJump, false); assert.equal(policy.allowParkour, true); assert.equal(policy.allowFreeMotion, true); assert.equal(policy.maxDropDown, 7); assert.deepEqual(policy.water, { allowSwimming: false, allowEnterWater: false, allowDeepWater: true, allowUnderwaterRoute: true, maxDepth: 12, maxUnderwaterDurationMs: 25_000 }); assert.equal(policy.restartPathEnabled, false); assert.equal(policy.alternateApproachEnabled, false); assert.equal(policy.safeScaffoldRecoveryEnabled, false); assert.equal(policy.recoveryCooldownMs, 333); assert.equal(policy.microEscapeMaxAttempts, 6); assert.equal(policy.microEscapeMinimumDisplacement, 1.25); assert.deepEqual(policy.microEscapeActions, ['BACKWARD', 'STRAFE_RIGHT']); assert.equal(policy.pillarRepeatedFailureLimit, 5); assert.equal(policy.maxBridgeAttempts, 4);
});

test('bot movement override reports differences and can return to inherited global settings', async () => {
  const service = createNavigationSettingsService({ repository: new MemoryRepository() }); await service.initialize(); await service.configure({ scope: 'BOT', botId: 'bot1', settings: { movement: { maxDrop: 8 } } }); const overridden = service.get({ scope: 'BOT', botId: 'bot1' }); assert.equal(overridden.hasOverride, true); assert.equal(overridden.differences['movement.maxDrop'], 8); const inherited = await service.removeOverride({ scope: 'BOT', botId: 'bot1' }); assert.equal(inherited.hasOverride, false); assert.equal(inherited.preset, 'INHERITED'); assert.equal(inherited.settings.movement.maxDrop, service.get({ scope: 'GLOBAL' }).settings.movement.maxDrop);
});

test('movement settings reject invalid booleans and unusable micro escape actions', async () => {
  const service = createNavigationSettingsService({ repository: new MemoryRepository() }); await service.initialize(); await assert.rejects(service.configure({ scope: 'GLOBAL', settings: { recovery: { enabled: 'false' } } }), /recovery\.enabled must be boolean/); await assert.rejects(service.configure({ scope: 'GLOBAL', settings: { microEscape: { enabled: true, jump: false, backward: false, strafeLeft: false, strafeRight: false } } }), /at least one action/);
});
