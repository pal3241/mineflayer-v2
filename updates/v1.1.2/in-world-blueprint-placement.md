# MineHive v1.1.2 — In-world Blueprint Placement

Blueprint preview is being moved out of the dashboard-style isometric view and into the Minecraft world.

## Rendering strategy

- MineHive owns the blueprint IR, bot build progress, material planning, safety checks, and final target coordinates.
- The client mod will provide a built-in in-world ghost renderer so MineHive remains usable without another mod.
- The next renderer phase adds Litematica as an optional compatibility provider. When installed, it may provide its mature schematic renderer, layer controls, rotation/mirroring UI, and obstruction visualization while MineHive continues to own execution.
- MineHive must never require Litematica to start, connect, or build.

## Placement contract

`POST /api/v1/building/blueprints/:id/placement`

```json
{
  "target": { "x": 100, "y": 64, "z": -20 },
  "source": "minehive-client"
}
```

Changing placement is rejected while the project is actively building. The server recalculates protection bounds and records a `PLACEMENT_MOVED` revision so the dashboard, client mod, and builders share one exact origin.

## UI regression fix

The RTS screen no longer calls the vanilla screen background blur pass. It uses only a light translucent tint, matching the blueprint overlay behavior and leaving the live world readable.
