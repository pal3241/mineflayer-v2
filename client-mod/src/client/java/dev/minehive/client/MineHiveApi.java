package dev.minehive.client;

import com.google.gson.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Collection;
import java.util.concurrent.*;

public final class MineHiveApi {
    private static final Gson GSON = new Gson();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private volatile MineHiveConfig config;
    private volatile String sessionId;
    private volatile JsonObject state = new JsonObject();
    private volatile JsonObject preview = new JsonObject();
    private volatile String status = "Disconnected";
    private volatile long sequence;

    public MineHiveApi(MineHiveConfig config) { this.config = config; }
    public void reconfigure(MineHiveConfig next) { config = next; sessionId = null; state = new JsonObject(); preview = new JsonObject(); status = "Disconnected"; }
    public boolean connected() { return sessionId != null; }
    public String status() { return status; }
    public JsonObject state() { return state.deepCopy(); }
    public JsonObject preview() { return preview.deepCopy(); }

    public CompletableFuture<JsonObject> connect(String playerName) {
        JsonObject body = new JsonObject(); body.addProperty("clientName", "MineHive Fabric 1.3.1"); body.addProperty("playerName", playerName); status = "Connecting";
        return request("POST", "/api/v1/client/sessions", body).thenApply(data -> { sessionId = data.get("id").getAsString(); status = "Connected"; return data; })
                .exceptionally(error -> { failed(error); return new JsonObject(); });
    }
    public CompletableFuture<JsonObject> poll() {
        if (sessionId == null) return CompletableFuture.completedFuture(state());
        return request("GET", "/api/v1/client/state?sessionId=" + encode(sessionId), null).thenApply(data -> { state = data; status = "Connected"; return data; })
                .exceptionally(error -> { failed(error); return state(); });
    }
    public CompletableFuture<JsonObject> switchBody(String botId) {
        JsonObject body = sessionBody(); body.addProperty("botId", botId);
        return request("POST", "/api/v1/client/switch", body).thenApply(data -> { status = "Controlling " + botId; return data; });
    }
    public CompletableFuture<JsonObject> release() {
        if (sessionId == null) return CompletableFuture.completedFuture(new JsonObject());
        return request("POST", "/api/v1/client/release", sessionBody()).thenApply(data -> { status = "Connected"; return data; });
    }
    public CompletableFuture<JsonObject> control(boolean forward, boolean back, boolean left, boolean right, boolean jump, boolean sprint, boolean sneak, float yaw, float pitch, boolean attack, boolean use) {
        JsonObject body = sessionBody(); body.addProperty("sequence", ++sequence); body.addProperty("forward", forward); body.addProperty("back", back); body.addProperty("left", left); body.addProperty("right", right);
        body.addProperty("jump", jump); body.addProperty("sprint", sprint); body.addProperty("sneak", sneak); body.addProperty("yaw", yaw); body.addProperty("pitch", pitch); body.addProperty("attack", attack); body.addProperty("use", use);
        return request("POST", "/api/v1/client/control", body).exceptionally(error -> { failed(error); return new JsonObject(); });
    }
    public CompletableFuture<JsonObject> rtsMove(Collection<String> botIds, double x, double y, double z) {
        JsonObject body = sessionBody(), target = new JsonObject(); JsonArray ids = new JsonArray(); botIds.forEach(ids::add); body.add("botIds", ids);
        target.addProperty("x", x); target.addProperty("y", y); target.addProperty("z", z); body.add("target", target); body.addProperty("formation", "GRID");
        return request("POST", "/api/v1/client/rts/move", body);
    }
    public CompletableFuture<JsonObject> loadPreview(String blueprintId) {
        return request("GET", "/api/v1/building/blueprints/" + encode(blueprintId) + "/preview3d", null).thenApply(data -> { preview = data; return data; });
    }
    public CompletableFuture<JsonObject> placeBlueprint(String blueprintId, int x, int y, int z) {
        JsonObject body = new JsonObject(), target = new JsonObject();
        target.addProperty("x", x); target.addProperty("y", y); target.addProperty("z", z);
        body.add("target", target); body.addProperty("source", "minehive-client");
        return request("POST", "/api/v1/building/blueprints/" + encode(blueprintId) + "/placement", body)
                .thenCompose(ignored -> loadPreview(blueprintId));
    }
    /** Applies the selected Litematica placement as one idempotent server sync. */
    public CompletableFuture<JsonObject> syncLitematicaPlacement(String blueprintId, LitematicaPlacementBridge.Placement placement) {
        JsonObject transform = new JsonObject();
        transform.addProperty("rotation", placement.rotation()); transform.addProperty("mirrorX", placement.mirrorX()); transform.addProperty("mirrorZ", placement.mirrorZ());
        return request("POST", "/api/v1/building/blueprints/" + encode(blueprintId) + "/transform", transform)
                .thenCompose(ignored -> placeBlueprint(blueprintId, placement.origin().getX(), placement.origin().getY(), placement.origin().getZ()));
    }
    public CompletableFuture<JsonObject> approveBlueprint(String blueprintId) {
        JsonObject body = new JsonObject(); body.addProperty("actor", "minehive-client-litematica");
        return request("POST", "/api/v1/building/blueprints/" + encode(blueprintId) + "/approve", body);
    }
    public CompletableFuture<JsonObject> buildBlueprint(String blueprintId, JsonObject project) {
        JsonObject body = new JsonObject(); body.addProperty("source", "minehive-client-litematica");
        if (project.has("target") && project.get("target").isJsonObject()) body.add("target", project.getAsJsonObject("target"));
        return request("POST", "/api/v1/building/blueprints/" + encode(blueprintId) + "/build", body);
    }
    private JsonObject sessionBody() { if (sessionId == null) throw new IllegalStateException("MineHive client has no session"); JsonObject body = new JsonObject(); body.addProperty("sessionId", sessionId); return body; }
    private CompletableFuture<JsonObject> request(String method, String path, JsonObject body) {
        MineHiveConfig current = config;
        final URI uri;
        try { uri = URI.create(current.baseUrl + path); }
        catch (Exception error) { return CompletableFuture.failedFuture(new IllegalArgumentException("Alamat MineHive tidak valid: " + current.baseUrl)); }
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5)).header("Accept", "application/json");
        if (!current.apiToken.isBlank()) builder.header("Authorization", "Bearer " + current.apiToken);
        if (body == null) builder.GET(); else builder.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(GSON.toJson(body), StandardCharsets.UTF_8));
        return http.sendAsync(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).thenApply(response -> {
            JsonElement parsed; try { parsed = JsonParser.parseString(response.body()); } catch (Exception error) { throw new CompletionException(new IllegalStateException("MineHive memberi respons bukan JSON (HTTP " + response.statusCode() + ")")); }
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw new CompletionException(new IllegalStateException("HTTP " + response.statusCode() + ": " + response.body()));
            JsonObject root = parsed.getAsJsonObject(); return root.has("data") && root.get("data").isJsonObject() ? root.getAsJsonObject("data") : root;
        });
    }
    private void failed(Throwable error) {
        Throwable cause = error; while (cause.getCause() != null) cause = cause.getCause();
        String message = cause.getMessage();
        if (message == null || message.isBlank()) {
            String type = cause.getClass().getSimpleName();
            message = type.isBlank() ? "koneksi ke MineHive gagal" : type + ": koneksi ke MineHive gagal";
        }
        if (message.contains("Client session") && message.toLowerCase().contains("not found")) {
            // The MineHive process restarted; its in-memory client sessions were cleared.
            sessionId = null; sequence = 0; status = "Server restarted · reconnecting"; return;
        }
        if (message.contains("ConnectException")) message = "Tidak bisa terhubung. Isi alamat LAN HP, misalnya http://192.168.1.6:3000";
        status = "Error: " + message;
    }
    private static String encode(String value) { return java.net.URLEncoder.encode(value, StandardCharsets.UTF_8); }
}
