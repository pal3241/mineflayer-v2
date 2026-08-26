# MINEHIVE — MASTER PROMPT VOL 21
## CODING STANDARD, PROJECT GOVERNANCE & ENGINEERING QUALITY

VOL 21 memperdalam:
- 21 Coding Standard.md
- 03 Non Functional Requirements.md
- 04 Architecture.md
- 05 Folder Structure.md
- 06 Core Engine.md
- 07 Module SDK.md
- 08 Plugin SDK.md
- 09 Service Layer.md
- 22 Testing.md

Tujuan utama VOL 21 adalah memastikan seluruh codebase MineHive konsisten, modular, maintainable, testable, observable, dan mudah dikembangkan oleh banyak developer atau coding agent.

---

# 1. CORE ENGINEERING PRINCIPLES

Wajib gunakan prinsip:

```text
Single Responsibility
Explicit Dependencies
Loose Coupling
High Cohesion
Clear Contracts
Deterministic Core
Observable Runtime
Fail-Safe Defaults
No Hidden Global State
No Circular Dependencies
```

---

# 2. MODULE SYSTEM

Gunakan ESM secara konsisten.

Contoh:

```js
export class TaskService {
  constructor({ repository, eventBus, logger }) {
    this.repository = repository
    this.eventBus = eventBus
    this.logger = logger
  }
}
```

Jangan mencampur CommonJS dan ESM.

---

# 3. FILE NAMING

Gunakan:

```text
kebab-case.js
```

Contoh:

```text
task-service.js
memory-manager.js
behavior-tree.js
llm-router.js
```

Class menggunakan PascalCase.

Function dan variable menggunakan camelCase.

Constant menggunakan UPPER_SNAKE_CASE jika benar-benar constant global.

---

# 4. FOLDER RULES

Setiap folder harus memiliki satu responsibility yang jelas.

Hindari:

```text
utils/
helpers/
misc/
common/
```

sebagai tempat dumping code.

Jika utility memiliki domain yang jelas, tempatkan pada domain tersebut.

---

# 5. DEPENDENCY DIRECTION

Gunakan arah dependency:

```text
UI
 ↓
API
 ↓
Services
 ↓
Domain
 ↓
Ports / Interfaces
 ↓
Adapters
```

Domain tidak boleh bergantung ke Dashboard.

Domain tidak boleh bergantung langsung ke provider LLM.

Core tidak boleh bergantung langsung ke database driver.

---

# 6. SERVICE CONTRACTS

Setiap service public harus:
- terdokumentasi
- memiliki input schema
- memiliki output contract
- memiliki error contract
- dapat di-mock
- tidak expose internal mutable state

---

# 7. ERROR HANDLING

Buat error hierarchy:

```text
MineHiveError
├── ValidationError
├── ConfigurationError
├── CapabilityError
├── PermissionError
├── ResourceError
├── TaskError
├── PluginError
├── LLMError
├── DatabaseError
└── RecoveryError
```

Jangan melempar string.

---

# 8. LOGGING STANDARD

Gunakan structured log:

```js
{
  level,
  timestamp,
  service,
  event,
  correlationId,
  botId,
  taskId,
  metadata
}
```

Jangan log:
- passwords
- API keys
- access tokens
- secrets

---

# 9. EVENTS

Event harus immutable setelah dibuat.

Format:

```js
{
  id,
  type,
  version,
  source,
  timestamp,
  correlationId,
  causationId,
  payload
}
```

---

# 10. ASYNC STANDARD

Gunakan async/await.

Semua long-running operation harus mendukung:
- timeout
- cancellation
- error propagation
- cleanup

Jangan menggunakan unbounded Promise creation.

---

# 11. VALIDATION

Validasi:
- config
- API request
- LLM output
- plugin manifest
- module manifest
- task parameters
- tool parameters
- database data boundary

Gunakan schema validation terpusat.

---

# 12. CONFIGURATION

Configuration hierarchy:

```text
defaults
 ↓
environment profile
 ↓
environment variables
 ↓
runtime read-only config
```

Jangan hardcode:
- credentials
- provider keys
- database passwords
- server secrets

---

# 13. DOCUMENTATION

Public class/function harus memiliki JSDoc bila contract tidak jelas dari nama.

Setiap major subsystem harus mempunyai:
- README
- architecture note
- public interfaces
- failure behavior
- test strategy

---

# 14. CODE REVIEW RULES

Review wajib memeriksa:
- architecture boundaries
- duplicate logic
- circular imports
- missing validation
- missing tests
- missing error handling
- missing cleanup
- unsafe LLM/tool boundary
- secret leakage

---

# 15. STATIC QUALITY

Tambahkan:
- linter
- formatter
- import checks
- dependency cycle detection
- dead code checks

CI harus gagal jika quality gate critical gagal.

---

# 16. PERFORMANCE RULES

Hindari:
- blocking event loop
- infinite polling
- unbounded cache
- unbounded queue
- repeated expensive serialization
- LLM call untuk event kecil
- database write untuk setiap tick

Gunakan batching, throttling, caching, dan backpressure.

---

# 17. SECURITY RULES

Tidak boleh ada:
- arbitrary eval
- arbitrary shell execution dari LLM
- arbitrary filesystem access dari tool
- provider secret di prompt
- unsafe dynamic import dari user input

---

# 18. VERSIONING

Gunakan Semantic Versioning:

```text
MAJOR.MINOR.PATCH
```

Module SDK, Plugin SDK, API, dan database schema harus version-aware.

---

# 19. DEPRECATION POLICY

Jika contract berubah:
- tandai deprecated
- dokumentasikan replacement
- tentukan removal version
- jaga compatibility selama transition

---

# 20. DEFINITION OF DONE

[ ] ESM konsisten
[ ] Naming standard
[ ] Dependency rules
[ ] Error hierarchy
[ ] Structured logs
[ ] Validation standard
[ ] Configuration standard
[ ] Documentation standard
[ ] Static analysis
[ ] Security rules
[ ] Performance rules
[ ] Versioning
[ ] Deprecation policy
