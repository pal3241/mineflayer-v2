# MINEHIVE — MASTER PROMPT VOL 1
## FOUNDATION, CORE ENGINE & FRAMEWORK CONTRACT

### 0. Purpose

Bangun fondasi MineHive sebagai framework AI Autonomous Multi-Agent Minecraft Bot berbasis Node.js + Mineflayer.

VOL 1 harus menghasilkan kernel framework yang modular, testable, extensible, dan tidak bergantung langsung pada UI atau provider LLM.

Referensi arsitektur utama:
- 01 Project Vision
- 02 Functional Requirements
- 03 Non Functional Requirements
- 04 Architecture
- 05 Folder Structure
- 06 Core Engine
- 07 Module SDK
- 08 Plugin SDK
- 09 Service Layer
- 10 State Machine
- 11 Behavior Tree
- 19 API
- 20 Database
- 21 Coding Standard
- 22 Testing
- 23 Deployment
- 24 Roadmap

---

# 1. Project Vision

MineHive harus diperlakukan sebagai framework, bukan bot monolitik.

Prinsip:
1. Core Engine tidak boleh mengetahui detail plugin tertentu.
2. Module harus dapat dipasang/dilepas.
3. Plugin adapter harus terisolasi.
4. Service Layer menjadi boundary antar subsistem.
5. State Machine mengontrol lifecycle/runtime state.
6. Behavior Tree mengontrol behavior execution.
7. Event Bus menjadi mekanisme komunikasi internal.
8. Persistence harus diabstraksikan.
9. API harus dapat digunakan CLI, Dashboard, dan integrator lain.
10. Tidak boleh ada hard dependency terhadap satu provider LLM.

---

# 2. Functional Requirements

Implementasikan minimal:
- application lifecycle
- configuration loading
- dependency container
- event bus
- logger
- error system
- module registry
- plugin registry
- service registry
- bot registry
- state machine
- behavior tree runtime
- task abstraction
- command bus
- query bus
- persistence abstraction
- health checks
- metrics
- API foundation
- CLI foundation

---

# 3. Non-Functional Requirements

Target:
- modular
- deterministic core behavior
- async-safe
- observable
- restart-safe
- testable
- replaceable persistence
- provider-agnostic AI
- no arbitrary code execution from configuration
- graceful shutdown
- structured errors
- schema validation
- versioned contracts

Gunakan JavaScript modern dengan satu module system secara konsisten. Pilih ESM dan gunakan ESM di seluruh project.

---

# 4. Architecture

Gunakan:

```text
CLI / Dashboard / API Client
            |
            v
      Service Layer
            |
    +-------+--------+
    |       |        |
 Core    Registry   Bot Runtime
 Engine
    |
    +------------------------------+
    |              |               |
 Event Bus     State Machine   Behavior Tree
    |              |               |
    +--------------+---------------+
                   |
             Module System
                   |
             Plugin SDK / Adapters
                   |
               Mineflayer
```

Core tidak boleh memanggil Mineflayer secara langsung kecuali melalui adapter/plugin boundary.

---

# 5. Folder Structure

Target awal:

```text
minehive/
├── src/
│   ├── core/
│   │   ├── application/
│   │   ├── config/
│   │   ├── container/
│   │   ├── events/
│   │   ├── errors/
│   │   ├── logging/
│   │   ├── lifecycle/
│   │   ├── registry/
│   │   ├── commands/
│   │   ├── queries/
│   │   ├── state-machine/
│   │   └── behavior-tree/
│   ├── modules/
│   ├── plugins/
│   ├── services/
│   ├── bots/
│   ├── persistence/
│   ├── api/
│   └── index.js
├── tests/
├── docs/
├── scripts/
├── config/
├── data/
├── package.json
├── .env.example
└── README.md
```

---

# 6. Core Engine

Buat:
- Application
- Kernel
- Lifecycle Manager
- Dependency Container
- Event Bus
- Logger
- Config Manager
- Health Manager
- Metrics Manager
- Registry Base
- Command Bus
- Query Bus

Application lifecycle:

```text
CREATED
  -> BOOTSTRAPPING
  -> INITIALIZING
  -> READY
  -> RUNNING
  -> SHUTTING_DOWN
  -> STOPPED
```

Event envelope wajib memiliki:

```js
{
  id,
  type,
  source,
  timestamp,
  correlationId,
  payload
}
```

---

# 7. Module SDK

Buat contract Module:

```js
{
  name,
  version,
  dependencies,
  initialize(context),
  start(context),
  stop(context),
  dispose(context)
}
```

Module lifecycle harus tervalidasi.

Module tidak boleh mengakses singleton global tanpa melalui context/dependency container.

---

# 8. Plugin SDK

Plugin SDK harus mempunyai:
- plugin manifest
- lifecycle hooks
- capability declaration
- dependency declaration
- compatibility metadata
- health status
- adapter boundary

Contoh:

```js
{
  name: "mineflayer-pathfinder-adapter",
  version: "1.0.0",
  capabilities: ["navigation"],
  initialize(context),
  start(context),
  stop(context)
}
```

---

# 9. Service Layer

Buat:
- Service Registry
- Service Context
- Bot Service
- Module Service
- Plugin Service
- Persistence Service
- Health Service

Service hanya expose contract, bukan detail implementasi.

---

# 10. State Machine

Buat engine generic:

```text
StateMachine
├── State
├── Transition
├── Guard
├── Action
└── MachineContext
```

Contoh bot lifecycle:

```text
DISCONNECTED
 -> CONNECTING
 -> CONNECTED
 -> READY
 -> ACTIVE
 -> STOPPING
 -> STOPPED
```

Support:
- guard
- entry action
- exit action
- transition event
- invalid transition handling

---

# 11. Behavior Tree

Buat:
- Node
- Composite
- Sequence
- Selector
- Parallel
- Decorator
- Condition
- Action

Status:

```text
RUNNING
SUCCESS
FAILURE
```

Behavior Tree runtime harus independen dari Minecraft API.

---

# 12. Bot Foundation

Buat Bot abstraction:

```js
{
  id,
  name,
  status,
  capabilities,
  metadata
}
```

Mineflayer adapter menjadi implementasi, bukan bagian dari core bot model.

---

# 13. Persistence

Gunakan interface:

```text
Repository
  -> create
  -> find
  -> update
  -> delete
  -> list
```

Implementasi awal dapat JSON store.

Jangan menaruh logic domain langsung di file JSON.

---

# 14. API Foundation

Sediakan contract:
- health
- bots
- modules
- plugins
- system status

API tidak boleh mengakses internal objects langsung.

---

# 15. Testing

Wajib:
- unit test core engine
- state machine tests
- behavior tree tests
- registry tests
- module lifecycle tests
- plugin lifecycle tests
- persistence tests
- service tests

Gunakan mocks/fakes.

---

# 16. Coding Standard

Wajib:
- ESM
- async/await
- JSDoc untuk public contracts
- no hidden globals
- no duplicated manager
- no direct process.exit() inside domain services
- structured error classes
- schema validation
- dependency injection
- clear naming
- single responsibility

---

# 17. Definition of Done

[ ] Core Engine berjalan
[ ] Module SDK berjalan
[ ] Plugin SDK berjalan
[ ] Service Layer berjalan
[ ] State Machine berjalan
[ ] Behavior Tree berjalan
[ ] Persistence abstraction tersedia
[ ] API foundation tersedia
[ ] CLI foundation tersedia
[ ] Tests tersedia
[ ] README tersedia
[ ] Graceful shutdown bekerja
[ ] Project dapat start tanpa Minecraft server untuk mode test
