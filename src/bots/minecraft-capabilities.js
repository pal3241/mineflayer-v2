export const MINECRAFT_CAPABILITIES = Object.freeze([
  'minecraft.navigation', 'minecraft.smart-movement', 'minecraft.follow-player', 'minecraft.come', 'minecraft.set-home', 'minecraft.home', 'minecraft.crafting', 'minecraft.craft-planning', 'minecraft.smelting', 'minecraft.block-analysis', 'minecraft.resource-analysis', 'minecraft.survey', 'minecraft.storage-discovery', 'minecraft.storage-inspection', 'minecraft.storage-deposit', 'minecraft.storage-withdraw', 'minecraft.collection', 'minecraft.farming', 'minecraft.deforestation', 'minecraft.reforestation', 'minecraft.combat', 'minecraft.drop-item', 'minecraft.pickup-item', 'minecraft.chat', 'minecraft.observation', 'minecraft.inventory', 'minecraft.stop'
]);

export function registerMinecraftCapabilities(registry, botManager) {
  const adapter = context => botManager.get(context.botId).adapter;
  registry.register({ name: 'minecraft.navigation', execute: (input, context) => adapter(context).navigate(input, context) });
  registry.register({ name: 'minecraft.follow-player', execute: (input, context) => adapter(context).followPlayer(input, context) });
  registry.register({ name: 'minecraft.come', execute: (input, context) => adapter(context).comeToPlayer(input, context) });
  registry.register({ name: 'minecraft.smart-movement', execute: (input, context) => adapter(context).smartMove(input, context) });
  registry.register({ name: 'minecraft.set-home', execute: (input, context) => adapter(context).setHome(input) });
  registry.register({ name: 'minecraft.home', execute: (input, context) => adapter(context).goHome(input, context) });
  registry.register({ name: 'minecraft.crafting', execute: (input, context) => adapter(context).craftItem(input) });
  registry.register({ name: 'minecraft.craft-planning', execute: (input, context) => adapter(context).craftRequirements(input) });
  registry.register({ name: 'minecraft.smelting', execute: (input, context) => adapter(context).smeltItem(input, context) });
  registry.register({ name: 'minecraft.block-analysis', execute: (input, context) => adapter(context).analyzeBlock(input) });
  registry.register({ name: 'minecraft.resource-analysis', execute: (input, context) => adapter(context).findSourceBlocks(input) });
  registry.register({ name: 'minecraft.survey', execute: (input, context) => adapter(context).survey(input) });
  registry.register({ name: 'minecraft.storage-discovery', execute: (input, context) => adapter(context).findNearestStorage(input) });
  registry.register({ name: 'minecraft.storage-inspection', execute: (input, context) => adapter(context).inspectStorage(input) });
  registry.register({ name: 'minecraft.storage-deposit', execute: (input, context) => adapter(context).depositStorage(input) });
  registry.register({ name: 'minecraft.storage-withdraw', execute: (input, context) => adapter(context).withdrawStorage(input) });
  registry.register({ name: 'minecraft.drop-item', execute: (input, context) => adapter(context).dropItem(input) });
  registry.register({ name: 'minecraft.pickup-item', execute: (input, context) => adapter(context).pickupItem(input, context) });
  registry.register({ name: 'minecraft.collection', execute: (input, context) => adapter(context).collect(input, context) });
  registry.register({ name: 'minecraft.farming', execute: (input, context) => adapter(context).farm(input, context) });
  registry.register({ name: 'minecraft.deforestation', execute: (input, context) => adapter(context).deforest(input, context) });
  registry.register({ name: 'minecraft.reforestation', execute: (input, context) => adapter(context).reforest(input, context) });
  registry.register({ name: 'minecraft.combat', execute: (input, context) => adapter(context).startCombat(input, context) });
  registry.register({ name: 'minecraft.chat', execute: (input, context) => adapter(context).chat(input.message) });
  registry.register({ name: 'minecraft.observation', execute: (_input, context) => adapter(context).snapshot() });
  registry.register({ name: 'minecraft.inventory', execute: (_input, context) => adapter(context).snapshot().inventorySummary });
  registry.register({ name: 'minecraft.stop', execute: async (_input, context) => { await adapter(context).stopActions(); return { stopped: true }; } });
}
