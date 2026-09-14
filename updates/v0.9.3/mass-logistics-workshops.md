# MineHive v0.9.3 — Mass Logistics & Workshops

## Material gate before building

Before a blueprint enters `BUILDING`, MineHive resolves every material through the existing acquisition chain: bot inventory, reserved registered storage, an idle fleet donor, crafting/smelting dependencies, then resource collection within the configured acquisition radius. Active reservations are excluded from available storage stock, so a builder cannot take items already allocated to another bot.

If a material cannot be obtained, the project becomes `FAILED` with `MATERIAL_UNAVAILABLE`, including the concrete acquisition reason. Verified placements are never rolled back or destroyed automatically. Any future demolition must remain an explicit dashboard/client command.

## Workshop discovery and memory

`POST /api/v1/logistics/workshops/scan` with `{ "botId": "...", "radius": 48 }` scans physical crafting tables, furnaces, blast furnaces, smokers, stonecutters, smithing tables, looms, cartography tables, and brewing stands. Each observation emits `logistics.workshop.observed` and is persisted as a verified `WORKSHOP` fact in Universal Task Memory, scoped by server and dimension.

`GET /api/v1/logistics/workshops?worldKey=...&dimension=...` retrieves remembered workshops. This is the coordination record used by acquisition/workshop-aware client phases; it prevents treating a temporary block placed in an arbitrary location as colony infrastructure.

## Operational examples

- Builder needs cobblestone: reserve/retrieve it from registered storage if unreserved; otherwise acquisition searches sources within its maximum radius. If no source is found, it fails safely without touching built blocks.
- Builder needs oak planks: acquisition resolves log/crafting dependencies and can use inventory, storage, a fleet donor, or collection according to its deterministic plan.
- A production bot scans and records the real crafting table/furnace coordinates once; later phases can route work to those remembered stations rather than placing ad-hoc utilities.
