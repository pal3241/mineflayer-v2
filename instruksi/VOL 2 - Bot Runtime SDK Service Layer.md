# MINEHIVE — MASTER PROMPT VOL 2
## BOT RUNTIME, MODULE/PLUGIN ECOSYSTEM & SERVICE ORCHESTRATION

VOL 2 melanjutkan foundation VOL 1 dan harus memperkuat dokumen:
- 04 Architecture
- 05 Folder Structure
- 07 Module SDK
- 08 Plugin SDK
- 09 Service Layer
- 10 State Machine
- 11 Behavior Tree
- 17 Multi Bot
- 19 API
- 20 Database
- 22 Testing
- 23 Deployment

---

# 1. Goal

Bangun runtime bot MineHive yang benar-benar terhubung ke Mineflayer melalui Plugin SDK, tetapi tetap menjaga Core Engine bebas dari dependency detail Minecraft.

---

# 2. Runtime Architecture

```text
MineHive Application
        |
        v
Service Layer
        |
        +-------------------------------+
        |                               |
        v                               v
   Bot Manager                    Module Manager
        |                               |
        v                               v
   Bot Runtime                    Plugin Manager
        |
        v
Minecraft Adapter Layer
        |
        v
Mineflayer
```

---

# 3. Bot Runtime

Buat:

```text
src/bots/
├── bot.js
├── bot-runtime.js
├── bot-manager.js
├── bot-factory.js
├── bot-context.js
├── bot-health.js
└── bot-events.js
```

Bot Runtime bertanggung jawab atas:
- connection
- lifecycle
- state synchronization
- capability registration
- event forwarding
- plugin availability
- health
- shutdown

Bot harus menggunakan State Machine untuk lifecycle.

---

# 4. Mineflayer Adapter

Buat:

```text
src/plugins/minecraft/
├── mineflayer-adapter.js
├── mineflayer-factory.js
├── mineflayer-context.js
└── adapters/
```

Adapter bertugas:
- create bot
- connect
- disconnect
- expose normalized events
- expose normalized capabilities

Jangan membocorkan object Mineflayer mentah ke semua subsystem.

---

# 5. Official Plugin Adapters

Integrasikan melalui adapter contract:

- mineflayer-pathfinder
- mineflayer-pvp
- mineflayer-collectblock
- mineflayer-auto-eat
- mineflayer-tool
- mineflayer-armor-manager

Setiap plugin:
- optional
- version-aware
- health-aware
- capability-aware

Jika plugin gagal dimuat, core tetap hidup dan status plugin menjadi DEGRADED/FAILED.

---

# 6. Capability System

Buat:

```text
src/bots/capabilities/
├── capability.js
├── capability-registry.js
├── capability-provider.js
└── capability-matcher.js
```

Contoh capability:

```text
navigation
combat
collection
eating
tool-selection
armor-management
inventory
observation
```

Task tidak boleh mengakses plugin secara langsung. Task meminta capability.

---

# 7. Service Layer Expansion

Tambahkan:
- Bot Service
- Capability Service
- Task Service
- Runtime Service
- Plugin Service
- Event Service
- Configuration Service
- Persistence Service

Semua service harus:
- punya interface
- tervalidasi
- dapat di-mock
- dapat dipantau

---

# 8. Command & Query

Implementasikan CQRS ringan:

```text
Command
 -> Service
 -> Domain Change
 -> Event

Query
 -> Read Service
 -> DTO
```

Jangan gunakan CQRS secara berlebihan untuk operasi sederhana.

---

# 9. Behavior Tree Runtime

Bangun behavior tree untuk aktivitas bot:

Contoh:

```text
SurvivalRoot
├── EmergencySelector
│   ├── Eat
│   ├── Escape
│   └── Defend
└── NormalBehavior
    ├── FollowGoal
    ├── Idle
    └── Observe
```

Behavior Tree harus bisa pause/resume.

---

# 10. Runtime State Synchronization

Simpan normalized runtime state:

```js
{
  botId,
  connection,
  position,
  health,
  food,
  dimension,
  inventorySummary,
  activeBehavior,
  currentTask,
  timestamp
}
```

State snapshot tidak boleh menyimpan object Mineflayer mentah.

---

# 11. Multi-Bot Foundation

Buat:

```text
src/multi-bot/
├── fleet-manager.js
├── bot-group.js
├── bot-routing.js
├── bot-load-balancer.js
└── bot-selector.js
```

Mendukung:
- multiple bots
- unique bot IDs
- independent lifecycle
- shared read-only system services
- per-bot context
- per-bot state machine

Satu bot failure tidak boleh menjatuhkan bot lain.

---

# 12. Database Evolution

JSON store tetap didukung, tetapi repository layer harus siap untuk SQLite/PostgreSQL di masa depan.

Pisahkan:
- domain model
- repository
- serialization
- storage adapter

---

# 13. API

Tambahkan endpoint/contract:
- GET /health
- GET /bots
- GET /bots/:id
- POST /bots
- POST /bots/:id/start
- POST /bots/:id/stop
- GET /plugins
- GET /modules
- GET /capabilities
- GET /system/status

Gunakan DTO, validation, dan structured errors.

---

# 14. Dashboard Contract

Dashboard boleh membaca:
- bot status
- connection status
- plugin status
- health
- behavior
- active task
- metrics

Dashboard tidak boleh menjalankan arbitrary internal functions.

---

# 15. Testing

Tambah:
- real Mineflayer adapter integration tests bila environment tersedia
- mock adapter tests
- plugin failure tests
- multi-bot isolation tests
- state synchronization tests
- API contract tests

---

# 16. Deployment

Sediakan:
- development mode
- test mode
- production mode
- config profiles
- environment variables
- graceful shutdown
- crash recovery strategy
- structured logs

---

# 17. Definition of Done

[ ] Bot Runtime
[ ] Mineflayer Adapter
[ ] Plugin Adapter System
[ ] Capability System
[ ] Service Layer expansion
[ ] Command/Query layer
[ ] Behavior Tree runtime
[ ] Multi-bot foundation
[ ] API
[ ] Dashboard contract
[ ] Repository abstraction
[ ] Deployment profiles
[ ] Integration tests
