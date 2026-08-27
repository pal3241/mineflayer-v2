# MineHive

MineHive adalah framework Mineflayer modular dan event-driven. Versi operasional **0.6.0** menyediakan semantic memory, ML outcome scoring, HiveMind consensus, SQLite production persistence, autonomy terbatas, dashboard multi-bot, live camera berbasis canvas, dan natural-language coordinator.

Panduan instalasi dan penggunaan lengkap tersedia di [`PANDUAN_PENGGUNAAN.md`](PANDUAN_PENGGUNAAN.md).

## Cakupan saat ini

- Lifecycle aplikasi ESM dan graceful shutdown
- Dependency container, event envelope, structured/redacted logging
- Registry module/plugin/service serta command/query bus
- Health checks dan metrics
- State machine dan behavior tree deterministik
- Mineflayer adapter terisolasi serta runtime multi-bot
- Pathfinder, collect-block/tool selection, auto-eat, dan bounded reconnect
- Capability registry dan JSON repository
- Fondasi HTTP API versioned dan CLI
- Dashboard web untuk join, fleet monitoring, live camera, command, dan admin
- Follow dinamis, named home, smart movement, recursive crafting, dan transfer item antar-bot
- Koordinator OpenRouter tiga-key failover atau LLM lokal kompatibel OpenAI dengan fallback deterministik
- Fleet view berisi posisi, inventory, dan daftar donor terdekat; tool/material planning berlaku otomatis pada semua command collect
- Recursive resource gathering, crafting table, furnace, dan smelting bahan alat
- Recipe resolver semua alternatif kayu/stone ingredient dengan inventory-aware ranking
- Shared place memory terisolasi per server dan dimension
- Farming, full-tree deforestation/replanting, reforestation, guard/full-combat/meat states
- Semantic retrieval dengan provenance, confidence, dedupe, ranking, dan embedding provider abstraction
- ML success prediction yang belajar dari outcome tanpa mengeksekusi action langsung
- HiveMind membership, idempotent messaging, versioned state, expiring locks, dan weighted consensus
- SQLite production storage dengan migration, WAL, integrity health, serta backup
- Autonomy allowlist dengan objective, consensus gate, cooldown, health pause, dan hourly budget
- Docker Compose dan unit systemd untuk deployment produksi
- Structured goals, deterministic planning, task dependency graph, dan capability-aware scheduling
- Bounded retry, timeout, cancellation, verification, checkpoint, dan failure propagation
- Test tanpa kebutuhan server Minecraft

## Quick start

```powershell
npm install
npm test
Copy-Item config/minehive.env.example .env
# Edit .env: host, port, username, auth, MINEHIVE_ADMINS
npm start
```

CLI otomatis membaca `.env`. Secara default API berjalan di `http://127.0.0.1:3000`. Ubah `MINEHIVE_AUTO_CONNECT=true` agar bot langsung masuk ke server saat `npm start`.

Jika API diekspos ke jaringan, isi `MINEHIVE_API_TOKEN`. Semua endpoint selain `/health` kemudian membutuhkan header `Authorization: Bearer <token>`.

Untuk server offline/local gunakan `MINEHIVE_AUTH=offline`. Untuk akun resmi gunakan `MINEHIVE_AUTH=microsoft`; Mineflayer akan menampilkan alur login perangkat ketika dibutuhkan.

Pool OpenRouter menggunakan hingga tiga key dan berpindah otomatis saat key aktif terkena rate limit:

```env
MINEHIVE_LLM_PROVIDER=openrouter
OPENROUTER_API_KEY_1=key-utama
OPENROUTER_API_KEY_2=key-cadangan-1
OPENROUTER_API_KEY_3=key-cadangan-2
MINEHIVE_LLM_MODEL=openrouter/auto
```

## Command dari Minecraft

Isi `MINEHIVE_ADMINS` dengan username yang diizinkan. Setelah bot spawn, kirim melalui chat:

```text
!bot1 status
!bot1 come
!bot1 follow PlayerSatu
!bot1 collect oak_log 16
!miner collect stone 8
!bot1 sethome base
!bot1 home base
!miner ai collect stone 32
!bot1 tebang pohon
!bot1 berapa 1+1
!global status
```

Command tidak mendukung JavaScript, shell, atau pemanggilan fungsi bebas. Bila `MINEHIVE_ADMINS` kosong, semua command chat ditolak.

## Menjalankan action lewat API

```powershell
Invoke-RestMethod -Method Post -ContentType application/json `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID/actions/navigate `
  -Headers @{ Authorization = 'Bearer YOUR_TOKEN' } `
  -Body '{"x":100,"y":64,"z":-20}'

Invoke-RestMethod -Method Post -ContentType application/json `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID/actions/collect `
  -Headers @{ Authorization = 'Bearer YOUR_TOKEN' } `
  -Body '{"block":"oak_log","count":16}'
```

Nama block memakai registry Minecraft, misalnya `oak_log`, `stone`, atau `iron_ore`.

## API baseline

- `GET /health`
- `GET /api/v1/system/status`
- `GET /api/v1/metrics`
- `GET|POST /api/v1/bots`
- `GET /api/v1/bots/:id`
- `POST /api/v1/bots/:id/start`
- `POST /api/v1/bots/:id/stop`
- `POST /api/v1/bots/:id/actions/navigate`
- `POST /api/v1/bots/:id/actions/come`
- `POST /api/v1/bots/:id/actions/follow`
- `POST /api/v1/bots/:id/actions/collect`
- `POST /api/v1/bots/:id/actions/farm`
- `POST /api/v1/bots/:id/actions/deforest`
- `POST /api/v1/bots/:id/actions/reforest`
- `POST /api/v1/bots/:id/actions/combat`
- `POST /api/v1/bots/:id/actions/craft`
- `POST /api/v1/bots/:id/actions/sethome`
- `POST /api/v1/bots/:id/actions/home`
- `GET /api/v1/ai/status`
- `GET /api/v1/ai/fleet`
- `POST /api/v1/ai/command`
- `GET|POST /api/v1/memory`
- `DELETE /api/v1/memory/:id`
- `POST /api/v1/bots/:id/memory`
- `GET|POST /api/v1/memory/semantic`
- `GET /api/v1/ml/status`
- `GET /api/v1/ml/models`
- `GET /api/v1/hivemind/status`
- `GET|POST /api/v1/hivemind/state`
- `POST /api/v1/hivemind/proposals`
- `GET /api/v1/autonomy/status`
- `GET|POST /api/v1/autonomy/objectives`
- `POST /api/v1/autonomy/tick`
- `GET /api/v1/database/status`
- `POST /api/v1/database/backup`
- `POST /api/v1/bots/:id/actions/chat`
- `POST /api/v1/bots/:id/actions/observe`
- `GET /api/v1/modules`
- `GET /api/v1/plugins`
- `GET|POST /api/v1/goals`
- `GET /api/v1/goals/:id`
- `POST /api/v1/goals/:id/run`
- `POST /api/v1/goals/:id/cancel`
- `GET /api/v1/tasks`

## Aturan arsitektur

Core tidak mengimpor Mineflayer. Hanya `src/plugins/minecraft/mineflayer-adapter.js` yang memuatnya secara dinamis. Task domain harus meminta capability ternormalisasi dan tidak menerima client Mineflayer mentah.

## Status roadmap

| Release | Cakupan | Status |
|---|---|---|
| 0.1.0 | Foundation dan core | Implemented |
| 0.2.0 | Runtime bot dan behavior engine | Implemented |
| 0.3.0 | Goal, task, recovery, advanced orchestration | Implemented |
| 0.4.0-0.4.1 | Safe AI, LLM key pool, crafting, movement, dan nearest-bot coordination | Implemented |
| 0.5.0 | Shared world memory, natural chat, farming, forestry, dan combat states | Implemented |
| 0.6.0 | Semantic memory, adaptive ML, HiveMind lanjutan, SQLite production, dan safe autonomy | Implemented |

Dokumen di `instruksi/` tetap menjadi sumber persyaratan utama.
