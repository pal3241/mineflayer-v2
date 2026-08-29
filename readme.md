# MineHive

MineHive adalah framework Mineflayer modular dan event-driven untuk menjalankan serta mengoordinasikan banyak bot Minecraft. Sistem ini menggabungkan runtime multi-bot, dashboard berbasis web, viewer first-person dan 3D berbasis canvas, task queue, shared memory per server, HiveMind, semantic memory, pembelajaran dari outcome, logistik transaksional, dan koordinasi bahasa natural melalui OpenRouter atau LLM lokal.

MineHive dirancang agar keputusan AI tetap berada di belakang validasi deterministik. Core tidak bergantung langsung pada Mineflayer, tindakan penting harus diverifikasi, state bersama dilindungi lock, dan kegagalan bot atau layanan eksternal dibuat observable tanpa merusak seluruh fleet.

## Cakupan proyek

- Runtime Mineflayer multi-bot dengan lifecycle dan bounded reconnect
- Dashboard untuk join, monitoring, viewer first-person/3D, command, admin, settings, dan logistik
- Command individual, kelompok, dan global melalui alias bot atau class
- Movement, follow, home, collect, crafting, smelting, farming, forestry, dan combat
- Koordinator OpenRouter tiga-key atau LLM lokal kompatibel OpenAI
- Shared world memory, semantic memory, short-term memory, dan long-term memory
- ML outcome scoring, HiveMind consensus, state versioning, serta expiring lock
- Penyimpanan produksi SQLite, structured logging, backup, dan health monitoring
- Goal planner, dependency graph, task queue, retry, timeout, cancellation, dan checkpoint
- Logistik transaksional dengan storage registry, reservation, verified transfer, dan audit lifecycle

Panduan instalasi, konfigurasi, command, dashboard, dan API tersedia di [`PANDUAN_PENGGUNAAN.md`](PANDUAN_PENGGUNAAN.md).

## Roadmap

| Release | Cakupan | Status |
|---|---|---|
| 0.1.0 | Foundation dan core | Implemented |
| 0.2.0 | Runtime bot dan behavior engine | Implemented |
| 0.3.0 | Goal, task, recovery, advanced orchestration | Implemented |
| 0.4.0–0.4.1 | Safe AI, LLM key pool, crafting, movement, dan nearest-bot coordination | Implemented |
| 0.5.0 | Shared world memory, natural chat, farming, forestry, dan combat states | Implemented |
| 0.6.0 | Semantic memory, adaptive ML, HiveMind lanjutan, SQLite production, dan safe autonomy | Implemented |
| [0.7.0](updates/0.7.0-logistik-foundation.md) | Logistics Foundation | Implemented |
| 0.7.1 | Advanced Logistics | Planned |
| 0.8.0 | Territory Foundation | Planned |

Persyaratan roadmap lengkap berada di [`instruksi/roadmap.txt`](instruksi/roadmap.txt). Setiap release baru memiliki satu catatan tersendiri di folder [`updates/`](updates/README.md).
