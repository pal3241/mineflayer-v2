# MINEHIVE — MASTER PROMPT VOL 17
## MULTI-BOT FLEET MANAGEMENT & SCHEDULING

VOL 17 memperdalam:
- 17 Multi Bot.md
- 06 Core Engine.md
- 09 Service Layer.md
- 10 State Machine.md
- 11 Behavior Tree.md
- 16 HiveMind.md
- 18 Dashboard.md
- 19 API.md
- 22 Testing.md

Tujuan utama adalah mengelola banyak bot sebagai fleet dengan lifecycle isolation, capability-aware scheduling, workload balancing, dan recovery.

---

# 1. FLEET ARCHITECTURE

```text
Fleet Manager
    |
    +--> Bot Registry
    +--> Provisioning
    +--> Scheduler
    +--> Assignment
    +--> Health
    +--> Groups / Teams
    +--> Recovery
```

---

# 2. FOLDER STRUCTURE

```text
src/fleet/
├── fleet-manager.js
├── fleet-state.js
├── bot-registry.js
├── provisioning/
├── scheduler/
├── assignment/
├── health/
├── groups/
├── recovery/
└── fleet-service.js
```

---

# 3. BOT REGISTRY

```js
{
  id,
  username,
  status,
  capabilities,
  plugins,
  position,
  health,
  food,
  currentTask,
  groupId,
  reliability,
  lastHeartbeat
}
```

---

# 4. BOT LIFECYCLE

```text
REGISTERED
 ↓
STARTING
 ↓
CONNECTING
 ↓
READY
 ↓
ACTIVE
 ↓
DEGRADED
 ↓
RECOVERING
 ↓
READY
```

Stop path:

```text
ACTIVE
 ↓
STOPPING
 ↓
OFFLINE
```

---

# 5. PROVISIONING

Support:
- create runtime instance
- load config
- attach plugins
- register capabilities
- connect
- health check
- activate

Provisioning failure tidak boleh merusak fleet lain.

---

# 6. SCHEDULER

Scheduler mempertimbangkan:
- capability match
- distance
- workload
- health
- equipment
- reliability
- task priority
- current behavior
- resource availability

---

# 7. ASSIGNMENT SCORE

Contoh:

```text
score =
capabilityMatch
+ reliability
+ availability
+ equipmentScore
+ proximity
- workloadPenalty
- riskPenalty
```

Weight configurable.

---

# 8. GROUPS / TEAMS

Support:
```text
Mining Team
Building Team
Defense Team
Exploration Team
Logistics Team
Farming Team
```

Group:
```js
{
  id,
  name,
  members,
  leader,
  capabilities,
  activeGoal
}
```

---

# 9. WORKLOAD BALANCING

Fleet harus dapat:
- rebalance tasks
- redistribute queue
- avoid one overloaded bot
- detect idle capacity
- react to role demand

---

# 10. BOT SCALING

Support:
- add bot
- remove bot
- replace bot
- drain bot
- maintenance mode

Drain:
```text
Stop new assignments
 ↓
Finish / reassign current task
 ↓
Disconnect safely
```

---

# 11. FAILURE RECOVERY

```text
Bot Failure
 ↓
Detect
 ↓
Preserve Task State
 ↓
Release Resources
 ↓
Reassign Task
 ↓
Restart / Replace
 ↓
Verify
```

---

# 12. RELIABILITY

Track:
- success rate
- failure rate
- timeout rate
- disconnect rate
- average completion time

Reliability dipakai scheduler, tetapi jangan menjadi hukuman permanen.

---

# 13. MULTI-BOT ISOLATION

Setiap bot harus punya:
- own runtime
- own state machine
- own behavior context
- own plugin state
- own failure boundary

Shared services hanya melalui explicit contracts.

---

# 14. FLEET API

Sediakan:
- list bots
- inspect bot
- start
- stop
- restart
- drain
- assign group
- list groups
- rebalance
- health

---

# 15. DASHBOARD

Fleet view:
- total bots
- online
- degraded
- offline
- active tasks
- idle bots
- group membership
- average reliability

---

# 16. TESTING

Uji:
- registration
- duplicate identity
- start/stop
- assignment
- capability mismatch
- rebalance
- drain
- failure
- replacement
- group assignment
- isolation

---

# 17. DEFINITION OF DONE

[ ] Fleet Manager
[ ] Registry
[ ] Provisioning
[ ] Scheduler
[ ] Assignment Scoring
[ ] Groups
[ ] Workload Balancing
[ ] Scaling
[ ] Recovery
[ ] Reliability
[ ] Isolation
[ ] API
[ ] Dashboard integration
[ ] Tests
