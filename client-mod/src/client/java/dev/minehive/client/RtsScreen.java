package dev.minehive.client;

import com.google.gson.*;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;
import java.util.*;

public final class RtsScreen extends Screen {
    private final Screen parent; private final Set<String> selected = new LinkedHashSet<>();
    private double targetX, targetY = 64, targetZ; private boolean targetSet;
    private int mapLeft, mapTop, mapRight, mapBottom; private double centerX, centerZ, scale = 4;
    public RtsScreen(Screen parent) { super(Text.literal("MineHive RTS")); this.parent = parent; }
    // Keep the live world readable behind the tactical overlay. Calling the
    // vanilla Screen background here enables the post-processing blur pass.
    @Override public void renderBackground(DrawContext draw, int mouseX, int mouseY, float delta) {}
    @Override protected void init() {
        addDrawableChild(ButtonWidget.builder(Text.literal("Move selected"), b -> move()).dimensions(width / 2 - 104, height - 30, 100, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Close"), b -> close()).dimensions(width / 2 + 4, height - 30, 100, 20).build());
    }
    @Override public void render(DrawContext draw, int mouseX, int mouseY, float delta) {
        draw.fill(0, 0, width, height, 0x22000000); mapLeft = 24; mapTop = 42; mapRight = width - 24; mapBottom = height - 42;
        draw.fill(mapLeft, mapTop, mapRight, mapBottom, 0xE0101815); draw.drawBorder(mapLeft, mapTop, mapRight - mapLeft, mapBottom - mapTop, 0xFF436953);
        JsonArray bots = bots(); calculateView(bots); for (int x = mapLeft; x < mapRight; x += 32) draw.fill(x, mapTop, x + 1, mapBottom, 0x303C5E4A); for (int y = mapTop; y < mapBottom; y += 32) draw.fill(mapLeft, y, mapRight, y + 1, 0x303C5E4A);
        for (JsonElement element : bots) { JsonObject bot = element.getAsJsonObject(), pos = object(bot, "position"); if (pos == null) continue; int sx = sx(pos.get("x").getAsDouble()), sy = sy(pos.get("z").getAsDouble()); String id = bot.get("id").getAsString(); draw.fill(sx - 5, sy - 5, sx + 6, sy + 6, selected.contains(id) ? 0xFF75E6A4 : 0xFF5C8D70); draw.drawTextWithShadow(textRenderer, Text.literal(bot.get("username").getAsString()), sx + 8, sy - 4, 0xFFFFFFFF); }
        if (targetSet) { int x = sx(targetX), y = sy(targetZ); draw.fill(x - 7, y - 1, x + 8, y + 2, 0xFFFFC857); draw.fill(x - 1, y - 7, x + 2, y + 8, 0xFFFFC857); }
        super.render(draw, mouseX, mouseY, delta); draw.drawCenteredTextWithShadow(textRenderer, title, width / 2, 14, 0xFF75E6A4); draw.drawTextWithShadow(textRenderer, Text.literal("Left-click bot: select · empty: target · selected " + selected.size()), 24, 28, 0xFFB7C9BE);
    }
    @Override public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button == 0 && inside(mouseX, mouseY)) { String hit = hitBot(mouseX, mouseY); if (hit != null) { if (!selected.add(hit)) selected.remove(hit); } else { targetX = centerX + (mouseX - (mapLeft + mapRight) / 2.0) / scale; targetZ = centerZ + (mouseY - (mapTop + mapBottom) / 2.0) / scale; targetY = averageY(); targetSet = true; } return true; }
        return super.mouseClicked(mouseX, mouseY, button);
    }
    private void move() { if (selected.isEmpty() || !targetSet) { MineHiveClient.toast(client, "Select bots and a destination first"); return; } MineHiveClient.INSTANCE.api().rtsMove(selected, targetX, targetY, targetZ).whenComplete((result, error) -> client.execute(() -> MineHiveClient.toast(client, error == null ? "RTS order completed" : MineHiveClient.rootMessage(error)))); }
    private JsonArray bots() { JsonObject state = MineHiveClient.INSTANCE.api().state(); return state.has("bots") ? state.getAsJsonArray("bots") : new JsonArray(); }
    private void calculateView(JsonArray bots) { double x = 0, z = 0; int n = 0; for (JsonElement e : bots) { JsonObject p = object(e.getAsJsonObject(), "position"); if (p != null) { x += p.get("x").getAsDouble(); z += p.get("z").getAsDouble(); n++; } } if (n > 0) { centerX = x / n; centerZ = z / n; } }
    private double averageY() { double y = 0; int n = 0; for (JsonElement e : bots()) { JsonObject p = object(e.getAsJsonObject(), "position"); if (p != null) { y += p.get("y").getAsDouble(); n++; } } return n == 0 ? 64 : y / n; }
    private String hitBot(double mx, double my) { for (JsonElement e : bots()) { JsonObject b = e.getAsJsonObject(), p = object(b, "position"); if (p != null && Math.hypot(mx - sx(p.get("x").getAsDouble()), my - sy(p.get("z").getAsDouble())) <= 10) return b.get("id").getAsString(); } return null; }
    private int sx(double worldX) { return (int)((mapLeft + mapRight) / 2.0 + (worldX - centerX) * scale); } private int sy(double worldZ) { return (int)((mapTop + mapBottom) / 2.0 + (worldZ - centerZ) * scale); }
    private boolean inside(double x, double y) { return x >= mapLeft && x <= mapRight && y >= mapTop && y <= mapBottom; }
    private static JsonObject object(JsonObject source, String key) { return source.has(key) && source.get(key).isJsonObject() ? source.getAsJsonObject(key) : null; }
    @Override public void close() { client.setScreen(parent); }
}
