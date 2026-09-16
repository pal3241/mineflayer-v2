package dev.minehive.client;

import com.google.gson.*;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.entity.Entity;
import net.minecraft.text.Text;
import net.minecraft.util.hit.EntityHitResult;
import org.lwjgl.glfw.GLFW;

public final class MineHiveClient implements ClientModInitializer {
    public static MineHiveClient INSTANCE;
    private MineHiveConfig config; private MineHiveApi api;
    private KeyBinding controlKey, switchKey, releaseKey, rtsKey, blueprintKey;
    private int ticks; private String controlledBotId, controlledUsername; private boolean previousAttack, previousUse; private long lastControlAt; private String lastControlSignature = "";

    @Override public void onInitializeClient() {
        INSTANCE = this; config = MineHiveConfig.load(); api = new MineHiveApi(config);
        controlKey = key("key.minehive.control", GLFW.GLFW_KEY_H); switchKey = key("key.minehive.switch", GLFW.GLFW_KEY_V);
        releaseKey = key("key.minehive.release", GLFW.GLFW_KEY_X); rtsKey = key("key.minehive.rts", GLFW.GLFW_KEY_R); blueprintKey = key("key.minehive.blueprint", GLFW.GLFW_KEY_B);
        ClientTickEvents.END_CLIENT_TICK.register(this::tick); HudRenderCallback.EVENT.register((draw, tickCounter) -> renderHud(draw));
    }
    private KeyBinding key(String id, int code) { return KeyBindingHelper.registerKeyBinding(new KeyBinding(id, InputUtil.Type.KEYSYM, code, "category.minehive")); }
    private void tick(MinecraftClient client) {
        if (client.player == null || client.world == null) { ticks = 0; return; } ticks++;
        if (!api.connected() && ticks % 40 == 1) api.connect(client.player.getGameProfile().getName());
        if (api.connected() && ticks % config.pollIntervalTicks == 0) api.poll();
        while (controlKey.wasPressed()) client.setScreen(new MineHiveScreen(client.currentScreen));
        while (rtsKey.wasPressed()) client.setScreen(new RtsScreen(client.currentScreen));
        while (blueprintKey.wasPressed()) client.setScreen(new BlueprintScreen(client.currentScreen));
        while (switchKey.wasPressed()) switchByLook(client); while (releaseKey.wasPressed()) release(client);
        keepCamera(client); if (controlledBotId != null) sendControl(client);
    }
    private void switchByLook(MinecraftClient client) {
        if (!(client.crosshairTarget instanceof EntityHitResult hit)) { toast(client, "Look directly at a MineHive bot first"); return; }
        Entity entity = hit.getEntity(); String username = entity.getName().getString(); JsonObject bot = botByUsername(username);
        if (bot == null) { toast(client, username + " is not a registered MineHive bot"); return; }
        String botId = bot.get("id").getAsString(); api.switchBody(botId).thenAccept(result -> client.execute(() -> {
            controlledBotId = botId; controlledUsername = username; client.setCameraEntity(entity); toast(client, "Controlling " + username + " · look at another bot and press V");
        })).exceptionally(error -> { client.execute(() -> toast(client, rootMessage(error))); return null; });
    }
    public void release(MinecraftClient client) {
        api.release().whenComplete((result, error) -> client.execute(() -> { controlledBotId = null; controlledUsername = null; if (client.player != null) client.setCameraEntity(client.player); toast(client, error == null ? "Bot control released" : rootMessage(error)); }));
    }
    private void keepCamera(MinecraftClient client) {
        if (controlledUsername == null || client.player == null) return;
        Entity target = findEntity(client, controlledUsername);
        if (target != null) {
            if (client.getCameraEntity() != target) client.setCameraEntity(target);
            // Keep the locally rendered remote camera aligned with the player's mouse input.
            target.setYaw(client.player.getYaw()); target.setPitch(client.player.getPitch()); target.setHeadYaw(client.player.getYaw());
        }
    }
    private void sendControl(MinecraftClient client) {
        boolean forward = client.options.forwardKey.isPressed(), back = client.options.backKey.isPressed(), left = client.options.leftKey.isPressed(), right = client.options.rightKey.isPressed();
        boolean jump = client.options.jumpKey.isPressed(), sprint = client.options.sprintKey.isPressed(), sneak = client.options.sneakKey.isPressed();
        boolean attack = client.options.attackKey.isPressed(), use = client.options.useKey.isPressed();
        float yaw = client.player.getYaw(), pitch = client.player.getPitch();
        String signature = forward + ":" + back + ":" + left + ":" + right + ":" + jump + ":" + sprint + ":" + sneak + ":" + attack + ":" + use + ":" + Math.round(yaw) + ":" + Math.round(pitch);
        long now = System.currentTimeMillis();
        // Four packets per second at most; idle state is not resent. This keeps the mobile host responsive.
        if (signature.equals(lastControlSignature) || now - lastControlAt < 250) { previousAttack = attack; previousUse = use; return; }
        api.control(forward, back, left, right, jump, sprint, sneak, yaw, pitch, attack && !previousAttack, use && !previousUse);
        lastControlAt = now; lastControlSignature = signature; previousAttack = attack; previousUse = use;
    }
    private void renderHud(net.minecraft.client.gui.DrawContext draw) {
        MinecraftClient client = MinecraftClient.getInstance(); if (!config.showHud || client.player == null) return;
        int color = api.status().startsWith("Error") ? 0xFFFF6666 : api.connected() ? 0xFF75E6A4 : 0xFFFFC857;
        draw.fill(6, 6, 520, controlledBotId == null ? 31 : 43, 0xB0101815); draw.drawTextWithShadow(client.textRenderer, Text.literal("MineHive 1.0.2 · " + api.status()), 12, 11, color);
        if (controlledBotId != null) draw.drawTextWithShadow(client.textRenderer, Text.literal("BODY: " + controlledUsername + "  [V switch · X release]"), 12, 25, 0xFFFFFFFF);
    }
    private JsonObject botByUsername(String username) { JsonObject state = api.state(); if (!state.has("bots")) return null; for (JsonElement element : state.getAsJsonArray("bots")) { JsonObject bot = element.getAsJsonObject(); if (bot.has("username") && username.equalsIgnoreCase(bot.get("username").getAsString())) return bot; } return null; }
    private Entity findEntity(MinecraftClient client, String username) { for (Entity entity : client.world.getEntities()) if (username.equalsIgnoreCase(entity.getName().getString())) return entity; return null; }
    public MineHiveApi api() { return api; } public MineHiveConfig config() { return config; }
    public void saveConfig(String baseUrl, String token) {
        config.baseUrl = baseUrl; config.apiToken = token; config.normalize(); config.save(); api.reconfigure(config);
    }
    public static void toast(MinecraftClient client, String message) { if (client.player != null) client.player.sendMessage(Text.literal("[MineHive] " + message), true); }
    public static String rootMessage(Throwable error) { Throwable cause = error; while (cause.getCause() != null) cause = cause.getCause(); return cause.getMessage() == null ? cause.toString() : cause.getMessage(); }
}
