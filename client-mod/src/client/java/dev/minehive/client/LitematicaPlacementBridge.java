package dev.minehive.client;

import net.minecraft.util.math.BlockPos;
import java.lang.reflect.Method;
import java.util.Collection;

/**
 * Optional, reflection-only bridge. MineHive never links Litematica at build
 * time, so the client remains usable when Litematica/MaLiLib are absent.
 */
public final class LitematicaPlacementBridge {
    public record Placement(String name, BlockPos origin) {}
    private LitematicaPlacementBridge() {}

    public static Placement selected() {
        try {
            Class<?> managerClass = Class.forName("fi.dy.masa.litematica.data.DataManager");
            Object manager = managerClass.getMethod("getSchematicPlacementManager").invoke(null);
            Object placement = invokeOptional(manager, "getSelectedSchematicPlacement");
            if (placement == null) {
                Object all = invokeOptional(manager, "getAllSchematicsPlacements");
                if (all instanceof Collection<?> list && list.size() == 1) placement = list.iterator().next();
            }
            if (placement == null) return null;
            Object origin = placement.getClass().getMethod("getOrigin").invoke(placement);
            if (!(origin instanceof BlockPos position)) return null;
            Object name = invokeOptional(placement, "getName");
            return new Placement(name == null ? "Litematica placement" : String.valueOf(name), position);
        } catch (ClassNotFoundException ignored) { return null; }
        catch (ReflectiveOperationException ignored) { return null; }
    }
    private static Object invokeOptional(Object target, String name) throws ReflectiveOperationException {
        try { Method method = target.getClass().getMethod(name); return method.invoke(target); }
        catch (NoSuchMethodException ignored) { return null; }
    }
}
