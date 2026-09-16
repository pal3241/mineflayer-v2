# MineHive v1.1.3 — Workshop Memory Learning

Acquisition now consumes the verified workshop facts already stored in Universal Task Memory.

## Decision order

1. Scan for the required workshop near the bot.
2. Read the nearest verified workshop of that kind in the same server and dimension.
3. Navigate to the remembered coordinates and verify that the block still exists.
4. Re-plan crafting or smelting while standing near the verified workshop.
5. Create and place a new utility block only when discovery and remembered locations both fail.

This prevents commands such as crafting a chest from making duplicate crafting tables when colony infrastructure already exists. Furnace-based acquisition follows the same path.

If a remembered workshop has been removed, its Universal Memory record becomes `STALE` and `verified: false`, so future tasks stop routing bots to an invalid location.

Supported remembered kinds remain crafting table, furnace, blast furnace, smoker, stonecutter, smithing table, loom, cartography table, and brewing stand.
