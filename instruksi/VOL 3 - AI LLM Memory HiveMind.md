# MINEHIVE — MASTER PROMPT VOL 3
## AI, LLM, MEMORY & AUTONOMOUS DECISION ENGINE

VOL 3 berfokus pada:
- 12 AI System
- 13 LLM System
- 14 Memory System
- 10 State Machine
- 11 Behavior Tree
- 16 HiveMind
- 17 Multi Bot
- 19 API
- 20 Database
- 22 Testing

Semua sistem harus terhubung melalui Service Layer dari VOL 1–2.

---

# 1. AI Architecture

```text
Observation
    |
    v
World Context
    |
    v
Memory Retrieval
    |
    v
Decision Engine
    |
    +--> Rule Engine
    +--> Planner
    +--> Behavior Tree
    +--> LLM
    |
    v
Validated Decision
    |
    v
Task / Action
    |
    v
State Machine / Behavior Tree
```

LLM hanya salah satu reasoning provider.

---

# 2. AI System

Buat:

```text
src/ai/
├── context/
├── decision/
├── planning/
├── policies/
├── validation/
├── tools/
└── evaluators/
```

Decision harus menghasilkan structured intent:

```js
{
  intent,
  confidence,
  goal,
  constraints,
  proposedActions,
  requiresLLM
}
```

---

# 3. LLM System

Buat:

```text
src/ai/llm/
├── llm-client.js
├── llm-provider.js
├── llm-router.js
├── prompt-builder.js
├── response-parser.js
├── schema-validator.js
├── token-budget.js
├── rate-limiter.js
├── retry-policy.js
└── cache.js
```

Provider-agnostic.

Dukung:
- OpenAI-compatible providers
- local models
- configurable routers

Jangan hardcode API key.

---

# 4. LLM Safety Boundary

Flow:

```text
LLM Output
   |
Schema Validation
   |
Policy Validation
   |
Capability Validation
   |
Task Validation
   |
Execution
```

LLM tidak boleh:
- menjalankan arbitrary JS
- menjalankan shell command
- mengedit file sistem
- memanggil Mineflayer object langsung

---

# 5. Tool System

Tool contract:

```js
{
  name,
  description,
  inputSchema,
  outputSchema,
  permissions,
  requiredCapabilities,
  execute(context, input)
}
```

Contoh:
- move_to
- collect_block
- mine_block
- craft_item
- equip_item
- eat
- attack
- place_block
- inspect_inventory

---

# 6. Planner

Buat:
```text
Goal
 -> Plan
 -> PlanStep
 -> Dependency Graph
 -> Task
```

Planner harus memakai:
- current world state
- memory
- capabilities
- resources
- constraints
- behavior tree availability

Plan harus berupa data terstruktur, bukan teks bebas.

---

# 7. Memory System

Gunakan:

```text
src/memory/
├── memory-entry.js
├── memory-manager.js
├── memory-store.js
├── retrieval.js
├── ranking.js
├── consolidation.js
└── stores/
    └── json/
```

Jenis memory:
- fact
- episode
- failure
- success
- location
- preference
- procedure

Setiap memory:
```js
{
  id,
  type,
  agentId,
  content,
  importance,
  confidence,
  tags,
  createdAt,
  updatedAt,
  metadata
}
```

---

# 8. Retrieval

Retrieval harus mempertimbangkan:
- relevance
- recency
- importance
- confidence
- task context

Jangan mengirim seluruh memory ke LLM.

---

# 9. HiveMind

Buat:

```text
src/hivemind/
├── hive-mind.js
├── shared-state.js
├── message-bus.js
├── shared-memory.js
├── agent-coordination.js
├── consensus.js
└── knowledge-sharing.js
```

HiveMind harus menjadi logical coordination layer, bukan satu giant agent.

---

# 10. Multi-Bot AI Coordination

Bot harus dapat:
- menerima goal
- mendapatkan task
- mengirim status
- request help
- share observations
- report failure
- release task
- recover

---

# 11. Goal / Task System

Buat:

```text
src/goals/
src/tasks/
```

Goal:

```js
{
  id,
  description,
  priority,
  status,
  constraints,
  deadline,
  progress
}
```

Task:

```js
{
  id,
  type,
  dependencies,
  assignedBot,
  status,
  retries,
  timeout,
  result,
  error
}
```

---

# 12. Autonomous Loop

```text
PERCEIVE
  ->
CONTEXT
  ->
RECALL
  ->
DECIDE
  ->
PLAN
  ->
VALIDATE
  ->
ACT
  ->
VERIFY
  ->
LEARN
```

State Machine menangani runtime state.
Behavior Tree menangani behavior execution.
Planner menangani goal decomposition.
LLM menangani reasoning kompleks jika diperlukan.

Jangan mencampur tanggung jawab tersebut.

---

# 13. Learning from Experience

Setelah task:
- simpan outcome
- hitung success/failure
- simpan error
- simpan lesson
- update confidence
- update policy hints

Belum mengubah model ML pada VOL ini. Machine Learning formal disiapkan untuk VOL berikutnya.

---

# 14. Observability

Catat:
- decision latency
- LLM latency
- prompt/response metadata secara aman
- task success
- recovery count
- memory retrieval hit rate
- tool failures

Jangan menyimpan API secrets di logs.

---

# 15. API

Tambah:
- POST /goals
- GET /goals
- GET /goals/:id
- POST /tasks
- GET /tasks
- GET /memory/search
- GET /hivemind/status
- GET /ai/status

---

# 16. Tests

Wajib:
- planner tests
- tool schema tests
- LLM parser tests
- memory tests
- retrieval ranking tests
- decision validation tests
- hive coordination tests
- autonomous loop tests
- recovery tests

LLM harus dapat di-test menggunakan deterministic fake provider.

---

# 17. Definition of Done

[ ] AI layer
[ ] LLM abstraction
[ ] Tool system
[ ] Planner
[ ] Goal/Task engine
[ ] Memory
[ ] Retrieval
[ ] HiveMind
[ ] Multi-bot coordination
[ ] Autonomous loop
[ ] Structured validation
[ ] Observability
[ ] API extensions
[ ] Deterministic LLM tests
