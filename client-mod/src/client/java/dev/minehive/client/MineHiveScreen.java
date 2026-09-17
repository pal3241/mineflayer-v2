package dev.minehive.client;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;

public final class MineHiveScreen extends Screen {
    private final Screen parent; private TextFieldWidget endpoint, token;
    public MineHiveScreen(Screen parent) { super(Text.literal("MineHive Control Center")); this.parent = parent; }
    @Override protected void init() {
        int left = width / 2 - 150;
        endpoint = new TextFieldWidget(textRenderer, left, 58, 300, 20, Text.literal("API endpoint")); endpoint.setText(MineHiveClient.INSTANCE.config().baseUrl); addDrawableChild(endpoint);
        token = new TextFieldWidget(textRenderer, left, 92, 300, 20, Text.literal("API token")); token.setText(MineHiveClient.INSTANCE.config().apiToken); addDrawableChild(token);
        addDrawableChild(ButtonWidget.builder(Text.literal("Save & reconnect"), b -> { MineHiveClient.INSTANCE.saveConfig(endpoint.getText(), token.getText()); if (client != null && client.player != null) MineHiveClient.INSTANCE.api().connect(client.player.getGameProfile().getName()); }).dimensions(left, 126, 145, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("RTS map"), b -> client.setScreen(new RtsScreen(this))).dimensions(left + 155, 126, 145, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Blueprint preview"), b -> client.setScreen(new BlueprintScreen(this))).dimensions(left, 156, 145, 20).build());
        addDrawableChild(ButtonWidget.builder(Text.literal("Close"), b -> close()).dimensions(left + 155, 156, 145, 20).build());
    }
    @Override public void render(DrawContext draw, int mouseX, int mouseY, float delta) {
        renderBackground(draw, mouseX, mouseY, delta); super.render(draw, mouseX, mouseY, delta); draw.drawCenteredTextWithShadow(textRenderer, title, width / 2, 20, 0xFF75E6A4);
        draw.drawTextWithShadow(textRenderer, Text.literal("MineHive URL (use LAN IP, not localhost, from another device)"), width / 2 - 150, 45, 0xFFB7C9BE); draw.drawTextWithShadow(textRenderer, Text.literal("API token"), width / 2 - 150, 79, 0xFFB7C9BE);
        draw.drawCenteredTextWithShadow(textRenderer, Text.literal(MineHiveClient.INSTANCE.api().status()), width / 2, 193, 0xFFFFFFFF); JsonObject state = MineHiveClient.INSTANCE.api().state(); int bots = state.has("bots") ? state.getAsJsonArray("bots").size() : 0, plans = state.has("blueprints") ? state.getAsJsonArray("blueprints").size() : 0;
        draw.drawCenteredTextWithShadow(textRenderer, Text.literal("Fleet: " + bots + " bots · Blueprints: " + plans), width / 2, 211, 0xFF94A89C); draw.drawCenteredTextWithShadow(textRenderer, Text.literal("H menu · V switch · X release · R RTS · N Litematica build"), width / 2, height - 28, 0xFF94A89C);
    }
    @Override public void close() { client.setScreen(parent); }
}
