# MineHive 1.2.1 — Client Blur and Release Fix

- RTS and blueprint screens now override both `blur()` and `renderBackground()` so Minecraft cannot enable the menu blur pass.
- Client build artifacts use a version-independent wildcard instead of the stale 1.0.0 filename.
- The release workflow reads `mod_version` and publishes the matching JAR and tag automatically.
