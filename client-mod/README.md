# MineHive Client 1.3.0

Fabric client mod for Minecraft Java 1.21.1. It connects directly to MineHive's authenticated v1 client bridge.

## Controls

- **V**: look at a registered MineHive bot and switch to its camera/body. While inside that bot, look at another bot and press **V** again.
- **X**: release the current bot and return to the player body.
- **R**: RTS top-down fleet map. Select multiple bots, choose a destination, then issue a safe group movement order.
- **B**: blueprint viewer using Building `preview3d`, with all-layer and per-layer views.
- **H**: configure the MineHive URL/API token and see connection state.

Movement, view, jump, sprint, sneak, attack, and use inputs are forwarded to the leased bot. A short server lease automatically clears input when the client disappears.

## Build and install

Requires JDK 21 and Gradle 9:

```bash
cd client-mod
gradle build
```

Install `client-mod/build/libs/minehive-client-1.3.0.jar` with Fabric Loader and Fabric API for Minecraft 1.21.1. Litematica is an optional compatibility provider, not a required dependency.

Use `http://127.0.0.1:3000` only when Minecraft and MineHive run on the same device. Otherwise set the MineHive device LAN address, for example `http://192.168.1.6:3000`. Copy `MINEHIVE_API_TOKEN` if API authentication is enabled.
