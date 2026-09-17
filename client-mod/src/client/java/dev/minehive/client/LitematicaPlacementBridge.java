package dev.minehive.client;

import net.minecraft.util.math.BlockPos;
import java.io.File;
import java.lang.reflect.Method;
import java.util.Collection;
import java.util.Map;

/** Reflection-only adapter; Litematica/MaLiLib remain optional at compile time. */
public final class LitematicaPlacementBridge {
    public enum State { READY, NOT_LOADED, API_MISMATCH, NO_SELECTION, DISABLED }
    public record Placement(String name, BlockPos origin, int rotation, boolean mirrorX, boolean mirrorZ, boolean enabled, String schematicFile, int subRegionCount) {}
    public record Snapshot(State state, Placement placement, String detail) { public boolean ready() { return state == State.READY && placement != null; } }
    private LitematicaPlacementBridge() {}

    public static Snapshot selected() {
        try {
            Class<?> dataManager = Class.forName("fi.dy.masa.litematica.data.DataManager");
            Object manager = invokeStatic(dataManager, "getSchematicPlacementManager", "getPlacementManager");
            if (manager == null) return failure(State.API_MISMATCH, "placement manager getter is unavailable");
            Object placement = invoke(manager, "getSelectedSchematicPlacement", "getSelectedPlacement");
            if (placement == null) {
                Object all = invoke(manager, "getAllSchematicsPlacements", "getAllSchematicPlacements", "getAllPlacements");
                if (all instanceof Collection<?> list && list.size() == 1) placement = list.iterator().next();
                if (all instanceof Map<?, ?> map && map.size() == 1) placement = map.values().iterator().next();
            }
            if (placement == null) return failure(State.NO_SELECTION, "select exactly one Litematica placement");
            Object position = invoke(placement, "getOrigin", "getPosition", "getPos");
            if (!(position instanceof BlockPos origin)) return failure(State.API_MISMATCH, "placement position getter is unavailable");
            boolean enabled = truthy(invoke(placement, "isEnabled", "getEnabled"), true);
            if (!enabled) return failure(State.DISABLED, "the selected Litematica placement is disabled");
            Object schematic = invoke(placement, "getSchematic", "getSchematicHolder");
            Object file = first(invoke(placement, "getSchematicFile", "getFile"), schematic == null ? null : invoke(schematic, "getSchematicFile", "getFile"));
            Object regions = invoke(placement, "getSubRegionPlacements", "getSubRegionPlacementMap", "getSubRegionPlacementsMap");
            int regionCount = regions instanceof Map<?, ?> map ? map.size() : regions instanceof Collection<?> list ? list.size() : 0;
            String name = string(first(invoke(placement, "getName"), schematic == null ? null : invoke(schematic, "getMetadataName", "getName")), "Litematica placement");
            return new Snapshot(State.READY, new Placement(name, origin, rotation(invoke(placement, "getRotation")), mirrorX(invoke(placement, "getMirror")), mirrorZ(invoke(placement, "getMirror")), true, fileName(file), regionCount), "");
        } catch (ClassNotFoundException ignored) { return failure(State.NOT_LOADED, "Litematica is not loaded"); }
        catch (ReflectiveOperationException | LinkageError error) { return failure(State.API_MISMATCH, "Litematica API mismatch (sakura-ryoko 1.21.1?): " + error.getClass().getSimpleName()); }
    }
    private static Snapshot failure(State state, String detail) { return new Snapshot(state, null, detail); }
    private static Object invokeStatic(Class<?> type, String... names) throws ReflectiveOperationException { for (String name : names) try { return type.getMethod(name).invoke(null); } catch (NoSuchMethodException ignored) {} return null; }
    private static Object invoke(Object target, String... names) throws ReflectiveOperationException { if (target == null) return null; for (String name : names) try { Method method = target.getClass().getMethod(name); return method.invoke(target); } catch (NoSuchMethodException ignored) {} return null; }
    private static Object first(Object a, Object b) { return a != null ? a : b; }
    private static boolean truthy(Object value, boolean fallback) { return value instanceof Boolean result ? result : fallback; }
    private static String string(Object value, String fallback) { String result = value == null ? "" : String.valueOf(value).trim(); return result.isEmpty() ? fallback : result; }
    private static String fileName(Object value) { if (value instanceof File file) return file.getName(); String result = string(value, ""); int slash = Math.max(result.lastIndexOf('/'), result.lastIndexOf('\\')); return slash >= 0 ? result.substring(slash + 1) : result; }
    private static int rotation(Object value) { String name = String.valueOf(value); if (name.contains("CLOCKWISE_180")) return 180; if (name.contains("COUNTERCLOCKWISE_90")) return 270; if (name.contains("CLOCKWISE_90")) return 90; return 0; }
    // Litematica semantic mapping: LEFT_RIGHT -> MineHive X; FRONT_BACK -> MineHive Z.
    private static boolean mirrorX(Object value) { return String.valueOf(value).contains("LEFT_RIGHT"); }
    private static boolean mirrorZ(Object value) { return String.valueOf(value).contains("FRONT_BACK"); }
}
