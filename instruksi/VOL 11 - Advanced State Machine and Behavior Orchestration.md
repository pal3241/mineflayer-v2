# MINEHIVE — MASTER PROMPT VOL 11
## ADVANCED STATE MACHINE & BEHAVIOR ORCHESTRATION

VOL 11 memperdalam:
- 10 State Machine.md
- 11 Behavior Tree.md
- 06 Core Engine.md
- 09 Service Layer.md
- 12 AI System.md
- 17 Multi Bot.md
- 22 Testing.md

Tujuan utama VOL 11 adalah membuat runtime behavior MineHive menjadi deterministic, interruptible, resumable, observable, recoverable, dan scalable untuk banyak bot.

---

# 1. TARGET ARSITEKTUR

```text
Goal
 ↓
Planner
 ↓
Behavior Tree
 ↓
Execution Context
 ↓
State Machine
 ↓
Tool / Capability
 ↓
Mineflayer Adapter
 ↓
Verification
 ↓
Result / Recovery
```

Behavior Tree menentukan strategi eksekusi.
State Machine mengontrol lifecycle dan valid transition.
Tool Layer menjadi boundary ke runtime Minecraft.

---

# 2. ADVANCED STATE MACHINE

Buat:

```text
src/orchestration/state-machine/
├── machine.js
├── state.js
├── transition.js
├── guard.js
├── state-context.js
├── transition-history.js
├── state-registry.js
├── timeout-manager.js
└── state-machine-service.js
```

State Machine wajib mendukung:
- hierarchical state
- entry action
- exit action
- transition guard
- timeout
- cancellation
- pause
- resume
- checkpoint
- recovery
- transition history
- invalid transition handling

---

# 3. HIERARCHICAL STATE

Contoh:

```text
ACTIVE
├── EXPLORING
│   ├── NAVIGATING
│   ├── SCANNING
│   └── RETURNING
├── MINING
│   ├── SEARCHING
│   ├── DIGGING
│   └── COLLECTING
└── COMBAT
    ├── TARGETING
    ├── ATTACKING
    └── RETREATING
```

Transition parent/child harus tervalidasi.

---

# 4. BOT RUNTIME STATE

Contoh lifecycle:

```text
REGISTERED
  ↓
STARTING
  ↓
CONNECTING
  ↓
CONNECTED
  ↓
READY
  ↓
ACTIVE
  ↓
PAUSED
  ↓
STOPPING
  ↓
OFFLINE
```

Failure path:

```text
ACTIVE
 ↓
DEGRADED
 ↓
RECOVERING
 ↓
READY
```

atau:

```text
RECOVERING
 ↓
FAILED
```

---

# 5. ADVANCED BEHAVIOR TREE

Buat:

```text
src/orchestration/behavior-tree/
├── tree.js
├── node.js
├── blackboard.js
├── execution-result.js
├── registry.js
├── composites/
│   ├── sequence.js
│   ├── selector.js
│   ├── parallel.js
│   └── random-selector.js
├── decorators/
│   ├── inverter.js
│   ├── retry.js
│   ├── timeout.js
│   ├── cooldown.js
│   └── repeat.js
├── conditions/
└── actions/
```

Node result:

```text
SUCCESS
FAILURE
RUNNING
CANCELLED
```

---

# 6. BLACKBOARD

Blackboard harus menyimpan runtime context sementara:

```js
{
  botId,
  taskId,
  goalId,
  target,
  position,
  inventorySummary,
  observations,
  temporaryFlags,
  timestamps
}
```

Jangan menyimpan seluruh database dalam blackboard.

---

# 7. INTERRUPT SYSTEM

Buat:

```text
src/orchestration/interrupts/
├── interrupt.js
├── interrupt-manager.js
├── priority.js
└── resume-policy.js
```

Default priority:

```text
EMERGENCY
>
SURVIVAL
>
COMBAT
>
CRITICAL_TASK
>
NORMAL_TASK
>
OPTIONAL
```

Contoh:

```text
Mining
 ↓
Health Critical
 ↓
Interrupt
 ↓
Eat / Escape
 ↓
Verify Safety
 ↓
Resume Mining
```

---

# 8. CHECKPOINT & RESUME

Simpan checkpoint pada task yang panjang.

Checkpoint minimal:
```js
{
  taskId,
  botId,
  behaviorNode,
  machineState,
  blackboardSnapshot,
  createdAt
}
```

Resume harus memverifikasi bahwa world state masih relevan.

---

# 9. CANCELLATION

Gunakan cancellation token/context.

Tidak boleh membiarkan:
- pathfinding terus berjalan
- mining terus berjalan
- tool action terus berjalan

setelah task dibatalkan.

---

# 10. TIMEOUT

Timeout harus tersedia untuk:
- state
- behavior node
- tool
- task

Timeout harus menghasilkan structured failure, bukan silent failure.

---

# 11. RECOVERY

Recovery flow:

```text
Failure
 ↓
Classify
 ↓
Retry?
 ↓
Fallback?
 ↓
Replan?
 ↓
Abort?
```

Retry harus bounded.

---

# 12. OBSERVABILITY

Catat:
- state transitions
- behavior node start/end
- duration
- cancellation
- timeout
- recovery
- failure reason

Gunakan correlationId.

---

# 13. TESTING

Wajib:
- valid transition
- invalid transition
- guard
- timeout
- pause/resume
- cancellation
- nested state
- selector
- sequence
- parallel
- retry decorator
- interrupt
- checkpoint restore
- recovery

---

# 14. DEFINITION OF DONE

[ ] Hierarchical State Machine
[ ] Advanced Behavior Tree
[ ] Blackboard
[ ] Interrupt System
[ ] Cancellation
[ ] Timeout
[ ] Checkpoint
[ ] Resume
[ ] Recovery
[ ] Observability
[ ] Unit Tests
[ ] Integration Tests
