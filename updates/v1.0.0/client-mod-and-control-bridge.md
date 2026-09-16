# MineHive v1.0.0 — Client Mod & Hivemind Control Bridge

- Authenticated client sessions with heartbeat leases and automatic release.
- Exclusive direct bot control and switch-by-look from one bot into another.
- Fabric 1.21.1 HUD, configuration, RTS fleet map, and blueprint preview.
- Safe formation navigation through the existing navigation service.
- Building preview uses the existing `preview3d` source of truth.

Endpoints: `GET /api/v1/client/protocol`, `POST /api/v1/client/sessions`, `GET /api/v1/client/state`, `POST /api/v1/client/switch`, `POST /api/v1/client/control`, `POST /api/v1/client/release`, and `POST /api/v1/client/rts/move`.
