# MineHive

MineHive adalah framework Mineflayer modular dan event-driven. Implementasi saat ini merupakan baseline operasional tervalidasi **0.3.3** dari spesifikasi 24 volume, bukan klaim bahwa AI, ML, koloni, atau milestone produksi sudah selesai.

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

## Command dari Minecraft

Isi `MINEHIVE_ADMINS` dengan username yang diizinkan. Setelah bot spawn, kirim melalui chat:

```text
!bot1 status
!bot1 come
!bot1 collect oak_log 16
!miner collect stone 8
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
- `POST /api/v1/bots/:id/actions/follow`
- `POST /api/v1/bots/:id/actions/collect`
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
| 0.4.0 | Safe AI dan provider-agnostic LLM | Planned |
| 0.5.0+ | Memory, ML, HiveMind, dashboard, database, production, autonomy | Planned |

Dokumen di `instruksi/` tetap menjadi sumber persyaratan utama.
