# MINEHIVE — MASTER PROMPT VOL 5
## ADVANCED MULTI-BOT, DASHBOARD, API, DATABASE & PRODUCTION ORCHESTRATION

VOL 5 mematangkan:
- 16 HiveMind
- 17 Multi Bot
- 18 Dashboard
- 19 API
- 20 Database
- 23 Deployment
- 22 Testing
- serta mengintegrasikan seluruh VOL 1–4.

---

# 1. Production Target

MineHive harus dapat menjalankan banyak bot sekaligus dengan:
- shared HiveMind
- per-bot isolation
- task coordination
- health monitoring
- persistent state
- API control
- dashboard visibility
- restart recovery

---

# 2. Multi-Bot Architecture

```text
                 MineHive Control Plane
                         |
          +--------------+--------------+
          |              |              |
       HiveMind       API Layer     Dashboard
          |
   +------+--------+--------+
   |      |        |        |
  Bot A  Bot B    Bot C    Bot N
   |      |        |        |
 Runtime Runtime  Runtime  Runtime
   |      |        |        |
 Plugin Plugin    Plugin   Plugin
```

---

# 3. Fleet Manager

Buat:

```text
src/multi-bot/
├── fleet-manager.js
├── fleet-state.js
├── bot-group.js
├── scheduler.js
├── load-balancer.js
├── bot-selector.js
└── isolation-manager.js
```

Support:
- start all
- stop all
- rolling restart
- bot groups
- maintenance mode
- per-bot resource limits

---

# 4. Task Scheduling

Gunakan:
- priority queue
- capability matching
- load score
- geographic distance
- current state
- health
- reliability

Scheduler harus mencegah:
- duplicate assignment
- conflicting assignment
- starvation
- unlimited retries

---

# 5. HiveMind

HiveMind production responsibilities:
- shared goal registry
- shared knowledge
- message routing
- consensus
- fleet health
- coordination
- conflict resolution
- synchronization

Hindari single giant shared mutable object.

Gunakan explicit interfaces.

---

# 6. Dashboard

Buat dashboard dengan halaman:

```text
Overview
Bots
Tasks
Goals
HiveMind
Memory
Knowledge
ML
LLM
Plugins
System Health
Logs
Metrics
```

Dashboard harus read-mostly dan command operations menggunakan API.

---

# 7. Dashboard Metrics

Overview harus menampilkan:
- online bots
- degraded bots
- active tasks
- queue depth
- task success rate
- goal progress
- LLM latency
- ML prediction health
- memory size
- plugin health

---

# 8. API Architecture

```text
src/api/
├── server.js
├── routes/
├── controllers/
├── services/
├── middleware/
├── schemas/
├── auth/
└── dto/
```

Pisahkan:
- route
- controller
- service
- domain
- repository

API harus memiliki:
- validation
- authentication boundary
- authorization
- rate limiting
- error mapping
- request id
- audit logging

---

# 9. API Resources

Minimal:
```text
/bots
/goals
/tasks
/modules
/plugins
/capabilities
/hivemind
/memory
/knowledge
/ml
/llm
/health
/metrics
/system
```

Jangan expose internal secrets.

---

# 10. Database Layer

Naikkan persistence abstraction menjadi database-ready.

```text
src/persistence/
├── repositories/
├── mappers/
├── migrations/
├── transactions/
├── adapters/
│   ├── json/
│   └── sqlite/
└── storage/
```

SQLite menjadi target default production ringan.

Harus ada:
- schema versioning
- migrations
- transaction boundary
- indexes
- backups

---

# 11. Data Domains

Persist minimal:
- bots
- bot state snapshots
- goals
- tasks
- events
- memory
- knowledge
- strategies
- ML metadata
- experiments
- plugin status
- audit events

---

# 12. Event Persistence

Event penting harus dapat dipersist.

Gunakan correlation IDs.

Contoh:

```text
goal.created
task.created
task.assigned
task.completed
bot.failed
plugin.failed
model.promoted
strategy.changed
```

Event log dapat dipakai untuk audit dan recovery.

---

# 13. Recovery

Implementasikan restart recovery:

```text
Process restart
    |
Load latest snapshot
    |
Replay critical events
    |
Validate state
    |
Reconnect bots
    |
Resume safe tasks
```

Task yang ambiguous harus masuk recovery queue, bukan langsung dianggap sukses.

---

# 14. Health System

Buat:

```text
System
Bot
Plugin
Service
Database
LLM
ML
HiveMind
```

Health states:
- HEALTHY
- DEGRADED
- UNAVAILABLE
- FAILED

Support dependency-aware health.

---

# 15. Deployment

Target deployment:

```text
Local Development
Docker
Linux Server
Cloud VM
```

Buat:
- Dockerfile
- docker-compose example
- environment profiles
- healthcheck
- graceful shutdown
- persistent volumes

Jangan menyimpan secret di image.

---

# 16. Observability

Gunakan:
- structured logs
- metrics
- traces/correlation IDs
- audit logs

Minimal metrics:
- bot uptime
- task latency
- task success
- goal completion
- LLM latency
- LLM error
- ML inference latency
- database latency
- event throughput
- memory retrieval latency

---

# 17. Security

Wajib:
- API authentication abstraction
- authorization roles
- input validation
- rate limiting
- audit logging
- secret isolation
- no arbitrary tool execution
- no arbitrary shell execution from LLM

---

# 18. Plugin/Module Lifecycle in Production

Support:
- install
- enable
- disable
- health check
- version check
- compatibility check
- rollback

Production runtime tidak boleh unload module berbahaya tanpa lifecycle control.

---

# 19. Coding Standard

Gabungkan seluruh standar:
- ESM
- TypeScript-ready contracts bila diinginkan
- JSDoc
- small functions
- explicit dependencies
- no magic globals
- typed schemas
- consistent errors
- immutable event objects
- testable services
- no circular dependencies

---

# 20. Testing Strategy

Buat test pyramid:

```text
Unit
  >
Integration
  >
Contract
  >
End-to-End
  >
Production Smoke
```

Coverage harus fokus ke business-critical paths, bukan angka coverage semata.

E2E minimal:
- start MineHive
- create bot
- connect adapter
- create goal
- assign task
- execute behavior
- persist result
- restart
- recover state

---

# 21. Performance

Target:
- non-blocking event loop
- bounded queues
- backpressure
- bounded cache
- controlled polling
- efficient persistence
- batch operations
- rate-limited LLM calls

Jangan membuat worker untuk setiap event secara tak terbatas.

---

# 22. Configuration

Sediakan:
```text
config/default.js
config/development.js
config/test.js
config/production.js
```

Gunakan environment variables untuk:
- credentials
- ports
- DB path
- LLM endpoints
- log level
- feature flags

---

# 23. CLI Production Commands

```bash
minehive start
minehive stop
minehive restart
minehive status
minehive health

minehive bot list
minehive bot start <id>
minehive bot stop <id>

minehive goal list
minehive task list

minehive plugin list
minehive module list

minehive db migrate
minehive db backup

minehive logs
minehive metrics
```

---

# 24. Documentation

Perbarui:
```text
docs/
├── architecture.md
├── modules.md
├── plugins.md
├── services.md
├── state-machine.md
├── behavior-tree.md
├── ai.md
├── llm.md
├── memory.md
├── ml.md
├── hivemind.md
├── multi-bot.md
├── dashboard.md
├── api.md
├── database.md
├── testing.md
└── deployment.md
```

README harus menjelaskan:
- installation
- architecture
- quickstart
- single bot
- multi bot
- modules
- plugins
- AI
- LLM
- memory
- ML
- HiveMind
- dashboard
- API
- database
- deployment

---

# 25. Roadmap Integration

VOL 5 harus memperbarui `24 Roadmap.md` dengan status implementasi:

```text
Foundation
 -> Runtime
 -> AI
 -> ML
 -> Production Orchestration
 -> Future Civilization Features
```

Jangan mengklaim fitur selesai jika hanya berupa placeholder.

---

# 26. Final Architecture

```text
                        MINEHIVE
                           |
                +----------+----------+
                |                     |
          CONTROL PLANE          DATA / MEMORY
                |                     |
          Service Layer          Persistence
                |
          +-----+-----+
          |           |
       HiveMind      API
          |           |
          |        Dashboard
          |
      Multi-Bot Fleet
          |
    +-----+-----+------+
    |     |     |      |
   BotA  BotB  BotC   BotN
    |     |     |      |
 Runtime Runtime Runtime
    |     |     |      |
 Module/Plugin Layer
          |
      Mineflayer
          |
      Minecraft
```

AI pipeline:

```text
Observation
 -> Memory
 -> Knowledge
 -> Rules / ML / LLM
 -> Decision
 -> Planner
 -> Behavior Tree
 -> State Machine
 -> Tool
 -> Mineflayer
 -> Verification
 -> Event
 -> Memory
```

---

# 27. Definition of Done

[ ] Production multi-bot runtime
[ ] Fleet Manager
[ ] HiveMind production layer
[ ] Dashboard
[ ] API production layer
[ ] Database-ready persistence
[ ] SQLite adapter
[ ] Event persistence
[ ] Restart recovery
[ ] Health system
[ ] Security boundary
[ ] Deployment artifacts
[ ] Observability
[ ] Production CLI
[ ] Documentation
[ ] Unit tests
[ ] Integration tests
[ ] Contract tests
[ ] E2E tests
[ ] Smoke tests
[ ] Config profiles
[ ] Backup/restore
[ ] Plugin lifecycle
[ ] Module lifecycle
[ ] No architectural duplication

---

# 28. Final Principle

MineHive harus tetap menjadi framework modular.

Jangan mengubahnya menjadi satu file besar atau satu "super-agent".

Gunakan:

```text
Core
+
Modules
+
Plugins
+
Services
+
State Machine
+
Behavior Tree
+
AI
+
LLM
+
Memory
+
Machine Learning
+
HiveMind
+
Multi-Bot
+
Dashboard
+
API
+
Database
```

Semua subsystem harus berkomunikasi melalui kontrak yang jelas dan dapat diuji.
