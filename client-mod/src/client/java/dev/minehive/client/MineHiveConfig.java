package dev.minehive.client;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;
import java.nio.file.Files;
import java.nio.file.Path;

public final class MineHiveConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("minehive-client.json");
    public String baseUrl = "http://127.0.0.1:3000";
    public String apiToken = "";
    public int pollIntervalTicks = 10;
    public int controlIntervalTicks = 2;
    public boolean showHud = true;

    public static MineHiveConfig load() {
        try {
            if (Files.exists(FILE)) {
                MineHiveConfig value = GSON.fromJson(Files.readString(FILE), MineHiveConfig.class);
                if (value != null) return value.normalize();
            }
        } catch (Exception ignored) {}
        MineHiveConfig value = new MineHiveConfig(); value.save(); return value;
    }
    public MineHiveConfig normalize() {
        baseUrl = baseUrl == null || baseUrl.isBlank() ? "http://127.0.0.1:3000" : baseUrl.strip().replaceAll("/+$", "");
        apiToken = apiToken == null ? "" : apiToken.strip();
        pollIntervalTicks = Math.max(5, Math.min(100, pollIntervalTicks));
        controlIntervalTicks = Math.max(1, Math.min(10, controlIntervalTicks));
        return this;
    }
    public void save() {
        try { Files.createDirectories(FILE.getParent()); Files.writeString(FILE, GSON.toJson(normalize())); }
        catch (Exception error) { throw new IllegalStateException("Could not save MineHive client config", error); }
    }
}
