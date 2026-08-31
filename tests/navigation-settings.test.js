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
