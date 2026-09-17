package dev.minehive.client;

import com.google.gson.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import java.util.*;

/** Thin command panel; Litematica remains the in-world 3D ghost renderer. */
public final class BlueprintScreen extends Screen {
    private final Screen parent; private String message = "Select a Litematica placement, then Sync";
    public BlueprintScreen(Screen parent) { super(Text.literal("MineHive · Litematica build control")); this.parent = parent; }
    @Override protected void init() {
        int left = width / 2 - 155;
        addDrawableChild(ButtonWidget.builder(Text.literal("Sync selected placement"), b -> sync()).dimensions(left, height / 2 - 12, 150, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Approve"), b -> approve()).dimensions(left + 160, height / 2 - 12, 70, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Build"), b -> build()).dimensions(left + 240, height / 2 - 12, 70, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Close"), b -> close()).dimensions(width / 2 - 45, height / 2 + 18, 90, 20).build());
    }
    private void sync() {
        LitematicaPlacementBridge.Snapshot snapshot = LitematicaPlacementBridge.selected();
        if (!snapshot.ready()) { message = snapshot.detail(); return; }
        JsonObject project = match(snapshot.placement()); if (project == null) return;
        message = "Syncing " + snapshot.placement().name() + " · " + pose(snapshot.placement());
        MineHiveClient.INSTANCE.api().syncLitematicaPlacement(project.get("id").getAsString(), snapshot.placement()).whenComplete((data, error) -> message = error == null ? "Pose synced. Approve then Build." : MineHiveClient.rootMessage(error));
    }
    private void approve() { JsonObject project = matchedSelected(); if (project == null) return; MineHiveClient.INSTANCE.api().approveBlueprint(project.get("id").getAsString()).whenComplete((data, error) -> message = error == null ? "Blueprint approved. You can Build now." : MineHiveClient.rootMessage(error)); }
    private void build() { JsonObject project = matchedSelected(); if (project == null) return; if (!project.has("target") || project.get("target").isJsonNull()) { message = "Sync a Litematica placement before Build"; return; } MineHiveClient.INSTANCE.api().buildBlueprint(project.get("id").getAsString(), project).whenComplete((data, error) -> message = error == null ? "Protected build started" : MineHiveClient.rootMessage(error)); }
    private JsonObject matchedSelected() { LitematicaPlacementBridge.Snapshot snapshot = LitematicaPlacementBridge.selected(); if (!snapshot.ready()) { message = snapshot.detail(); return null; } return match(snapshot.placement()); }
    private JsonObject match(LitematicaPlacementBridge.Placement placement) {
        List<JsonObject> candidates = new ArrayList<>(); String file = normalize(placement.schematicFile()), name = normalize(placement.name());
        for (JsonElement element : blueprints()) { JsonObject plan = element.getAsJsonObject(); String source = normalize(plan.has("sourceFile") && !plan.get("sourceFile").isJsonNull() ? plan.get("sourceFile").getAsString() : ""); String planName = normalize(plan.get("name").getAsString()); if ((!file.isEmpty() && file.equals(source)) || (!name.isEmpty() && name.equals(planName))) candidates.add(plan); }
        if (candidates.size() == 1) return candidates.getFirst();
        message = candidates.isEmpty() ? "No MineHive blueprint matches Litematica file/name. Import the same .litematic." : "Multiple MineHive blueprints match; rename the file or blueprint to make it unique.";
        return null;
    }
    private JsonArray blueprints() { JsonObject state = MineHiveClient.INSTANCE.api().state(); return state.has("blueprints") ? state.getAsJsonArray("blueprints") : new JsonArray(); }
    private static String normalize(String value) { String text = value == null ? "" : value.trim().toLowerCase(Locale.ROOT); int slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')); return slash >= 0 ? text.substring(slash + 1) : text; }
    private static String pose(LitematicaPlacementBridge.Placement p) { return p.origin().toShortString() + " · " + p.rotation() + "°" + (p.mirrorX() ? " · mirror X" : "") + (p.mirrorZ() ? " · mirror Z" : ""); }
    @Override public void blur() {}
    @Override public void renderBackground(DrawContext draw, int mouseX, int mouseY, float delta) {}
    @Override public void render(DrawContext draw, int mouseX, int mouseY, float delta) {
        int left = width / 2 - 190, top = height / 2 - 72; draw.fill(left, top, left + 380, top + 145, 0xD0101815); draw.drawBorder(left, top, 380, 145, 0xFF436953); draw.drawCenteredTextWithShadow(textRenderer, title, width / 2, top + 14, 0xFF75E6A4);
        LitematicaPlacementBridge.Snapshot snapshot = LitematicaPlacementBridge.selected(); String placement = snapshot.ready() ? snapshot.placement().name() + " · " + pose(snapshot.placement()) + " · regions " + snapshot.placement().subRegionCount() : snapshot.state().name() + ": " + snapshot.detail();
        draw.drawCenteredTextWithShadow(textRenderer, Text.literal(placement), width / 2, top + 35, 0xFFB7C9BE); draw.drawCenteredTextWithShadow(textRenderer, Text.literal(message), width / 2, top + 53, 0xFFFFC857); draw.drawCenteredTextWithShadow(textRenderer, Text.literal("Litematica ghost stays in-world; this panel only syncs and starts MineHive."), width / 2, top + 116, 0xFF94A89C); super.render(draw, mouseX, mouseY, delta);
    }
    @Override public void close() { client.setScreen(parent); }
}
