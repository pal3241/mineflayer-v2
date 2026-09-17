package dev.minehive.client;

import com.google.gson.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import java.util.*;

public final class BlueprintScreen extends Screen {
    private final Screen parent; private int blueprintIndex, layer = -1; private String loading = "Choose a blueprint";
    public BlueprintScreen(Screen parent) { super(Text.literal("MineHive Blueprint Preview")); this.parent = parent; }
    @Override protected void init() {
        addDrawableChild(ButtonWidget.builder(Text.literal("< Blueprint"), b -> select(-1)).dimensions(20, height - 30, 90, 20).build()); addDrawableChild(ButtonWidget.builder(Text.literal("Blueprint >"), b -> select(1)).dimensions(116, height - 30, 90, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Sync Litematica"), b -> syncLitematica()).dimensions(212, height - 30, 118, 20).build()); addDrawableChild(ButtonWidget.builder(Text.literal("Build"), b -> build()).dimensions(336, height - 30, 62, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Layer -"), b -> layer--).dimensions(width - 302, height - 30, 70, 20).build()); addDrawableChild(ButtonWidget.builder(Text.literal("All"), b -> layer = -1).dimensions(width - 226, height - 30, 55, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Layer +"), b -> layer++).dimensions(width - 165, height - 30, 70, 20).build()); addDrawableChild(ButtonWidget.builder(Text.literal("Close"), b -> close()).dimensions(width - 89, height - 30, 70, 20).build()); loadCurrent();
    }
    private void select(int delta) { JsonArray plans = blueprints(); if (plans.isEmpty()) return; blueprintIndex = Math.floorMod(blueprintIndex + delta, plans.size()); layer = -1; loadCurrent(); }
    private void loadCurrent() { JsonArray plans = blueprints(); if (plans.isEmpty()) { loading = "No imported blueprint"; return; } blueprintIndex = Math.min(blueprintIndex, plans.size() - 1); JsonObject plan = plans.get(blueprintIndex).getAsJsonObject(); loading = "Loading " + plan.get("name").getAsString(); MineHiveClient.INSTANCE.api().loadPreview(plan.get("id").getAsString()).whenComplete((data, error) -> loading = error == null ? "" : MineHiveClient.rootMessage(error)); }
    private JsonObject current() { JsonArray plans = blueprints(); return plans.isEmpty() ? null : plans.get(Math.min(blueprintIndex, plans.size() - 1)).getAsJsonObject(); }
    private void syncLitematica() { JsonObject plan = current(); LitematicaPlacementBridge.Placement placement = LitematicaPlacementBridge.selected(); if (plan == null) { loading = "Import the same .litematic into MineHive first"; return; } if (placement == null) { loading = "No selected Litematica placement (or Litematica missing)"; return; } loading = "Syncing " + placement.name() + " at " + placement.origin().toShortString(); MineHiveClient.INSTANCE.api().placeBlueprint(plan.get("id").getAsString(), placement.origin().getX(), placement.origin().getY(), placement.origin().getZ()).whenComplete((data,error) -> loading = error == null ? "Placement synced · approve then Build" : MineHiveClient.rootMessage(error)); }
    private void build() { JsonObject plan = current(); if (plan == null) return; loading = "Starting protected build…"; MineHiveClient.INSTANCE.api().buildBlueprint(plan.get("id").getAsString()).whenComplete((data,error) -> loading = error == null ? "Bots are building from the Litematica placement" : MineHiveClient.rootMessage(error)); }
    // Never invoke the vanilla blur pass: blueprints are an in-world overlay, not a pause menu.
    @Override public void blur() {}
    @Override public void renderBackground(DrawContext draw, int mouseX, int mouseY, float delta) {}

    @Override public void render(DrawContext draw, int mouseX, int mouseY, float delta) {
        draw.fill(0, 0, width, height, 0x22000000); JsonObject preview = MineHiveClient.INSTANCE.api().preview(); draw.drawCenteredTextWithShadow(textRenderer, title, width / 2, 12, 0xFF75E6A4); if (!loading.isBlank()) draw.drawCenteredTextWithShadow(textRenderer, Text.literal(loading), width / 2, 29, 0xFFFFC857); if (preview.has("blocks")) renderBlocks(draw, preview.getAsJsonArray("blocks"));
        JsonArray plans = blueprints(); String name = plans.isEmpty() ? "No blueprint" : plans.get(Math.min(blueprintIndex, plans.size() - 1)).getAsJsonObject().get("name").getAsString(); draw.drawTextWithShadow(textRenderer, Text.literal(name + " · " + (layer < 0 ? "all layers" : "layer " + layer)), 20, 30, 0xFFFFFFFF); super.render(draw, mouseX, mouseY, delta);
    }
    private void renderBlocks(DrawContext draw, JsonArray blocks) {
        int originX = width / 2, originY = height / 2 + 60, tile = Math.max(2, Math.min(7, 900 / Math.max(1, (int)Math.sqrt(blocks.size()) * 4))); List<JsonObject> visible = new ArrayList<>(); int minY = Integer.MAX_VALUE;
        for (JsonElement e : blocks) minY = Math.min(minY, e.getAsJsonObject().get("y").getAsInt()); for (JsonElement e : blocks) { JsonObject b = e.getAsJsonObject(); if (layer < 0 || b.get("y").getAsInt() - minY == layer) visible.add(b); }
        visible.sort(Comparator.comparingInt(b -> b.get("x").getAsInt() + b.get("z").getAsInt() + b.get("y").getAsInt())); int drawn = 0;
        for (JsonObject b : visible) { if (drawn++ > 12000) break; int x = b.get("x").getAsInt(), y = b.get("y").getAsInt() - minY, z = b.get("z").getAsInt(); int sx = originX + (x - z) * tile, sy = originY + (x + z) * tile / 2 - y * tile; draw.fill(sx - tile, sy - tile, sx + tile + 1, sy + tile / 2 + 1, color(b.get("name").getAsString(), b.has("status") ? b.get("status").getAsString() : "PENDING")); }
        draw.drawTextWithShadow(textRenderer, Text.literal("Visible blocks: " + Math.min(drawn, 12000) + " / " + visible.size()), 20, 46, 0xFF94A89C);
    }
    private int color(String name, String status) { if ("COMPLETED".equals(status)) return 0xAA49C979; int hash = name.hashCode(); return 0xCC000000 | (80 + (hash >>> 16 & 127)) << 16 | (80 + (hash >>> 8 & 127)) << 8 | (80 + (hash & 127)); }
    private JsonArray blueprints() { JsonObject state = MineHiveClient.INSTANCE.api().state(); return state.has("blueprints") ? state.getAsJsonArray("blueprints") : new JsonArray(); }
    @Override public void close() { client.setScreen(parent); }
}
