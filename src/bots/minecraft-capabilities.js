export const MINECRAFT_CAPABILITIES = Object.freeze([
  'minecraft.navigation', 'minecraft.follow-player', 'minecraft.collection', 'minecraft.chat', 'minecraft.observation', 'minecraft.inventory', 'minecraft.stop'
]);

export function registerMinecraftCapabilities(registry, botManager) {
  const adapter = context => botManager.get(context.botId).adapter;
  registry.register({ name: 'minecraft.navigation', execute: (input, context) => adapter(context).navigate(input, context) });
  registry.register({ name: 'minecraft.follow-player', execute: (input, context) => adapter(context).followPlayer(input, context) });
  registry.register({ name: 'minecraft.collection', execute: (input, context) => adapter(context).collect(input, context) });
  registry.register({ name: 'minecraft.chat', execute: (input, context) => adapter(context).chat(input.message) });
  registry.register({ name: 'minecraft.observation', execute: (_input, context) => adapter(context).snapshot() });
  registry.register({ name: 'minecraft.inventory', execute: (_input, context) => adapter(context).snapshot().inventorySummary });
  registry.register({ name: 'minecraft.stop', execute: async (_input, context) => { await adapter(context).stopActions(); return { stopped: true }; } });
}
