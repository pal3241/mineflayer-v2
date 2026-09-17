# Survival overnight E2E

This test uses a real Minecraft server. It is intentionally excluded from the normal CI test path because one natural Minecraft night can take several minutes.

Prepare an Overworld test spawn with a nearby bed or a bed in the bot inventory. Give the bot bread, torches, at least one armor item, and enough cobblestone, dirt, stone, or netherrack for an emergency pillar. Ensure a collectable stone block is within 16 blocks.

Run:

```bash
MINEHIVE_E2E_HOST=127.0.0.1 \
MINEHIVE_E2E_PORT=25565 \
MINEHIVE_E2E_USERNAME=MineHiveSurvivalE2E \
npm run test:survival-e2e
```

Optional variables:

- `MINEHIVE_E2E_AUTH`, default `offline`
- `MINEHIVE_E2E_VERSION`, default Mineflayer auto-detection
- `MINEHIVE_E2E_COLLECT_BLOCK`, default `stone`

The test fails if the initial supplies are missing, the bot does not observe a night-to-day transition, it dies, or it cannot resume collection after sunrise.
