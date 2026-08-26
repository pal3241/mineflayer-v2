# MINEHIVE — MASTER PROMPT VOL 9
## DASHBOARD, API, OBSERVABILITY, DEBUGGING & OPERATIONS

VOL 9 mematangkan:
- 18 Dashboard
- 19 API
- 20 Database
- 21 Coding Standard
- 22 Testing
- 23 Deployment
- 16 HiveMind
- 17 Multi Bot

Target: MineHive dapat dipantau, dikontrol, di-debug, dan dioperasikan dengan aman.

---

# 1. DASHBOARD ARCHITECTURE

```text
Browser
  |
Dashboard Frontend
  |
API Gateway
  |
Service Layer
  |
MineHive Core
```

Dashboard tidak boleh mengakses internal state object secara langsung.

---

# 2. DASHBOARD PAGES

```text
Overview
Bots
Goals
Tasks
HiveMind
Memory
Knowledge
ML
LLM
Plugins
Modules
Infrastructure
Resources
Defense
Logs
Metrics
Settings
```

---

# 3. OVERVIEW

Tampilkan:
- online bots
- degraded bots
- active tasks
- failed tasks
- goals
- queue depth
- CPU/memory
- LLM latency
- ML status
- plugin health
- database health

---

# 4. BOT VIEW

Per bot:
- connection
- position
- health
- food
- current state
- behavior tree
- current task
- capabilities
- plugin status
- recent events

Action melalui API authorization:
- start
- stop
- restart
- pause
- resume
- assign goal
- inspect

---

# 5. TASK VIEW

Filter:
- status
- priority
- bot
- type
- createdAt

Detail:
- dependencies
- retries
- execution time
- result
- errors
- related events

---

# 6. HIVE MIND VIEW

Tampilkan:
- active decisions
- consensus
- active goals
- agent reliability
- shared knowledge
- pending messages
- conflicts

---

# 7. MEMORY VIEW

Support:
- search
- filter
- inspect
- confidence
- importance
- provenance

Jangan menyimpan provider secrets sebagai memory.

---

# 8. API DESIGN

Versioned API:
```text
/api/v1/
```

Routes:
```text
/bots
/goals
/tasks
/plugins
/modules
/capabilities
/hivemind
/memory
/knowledge
/ml
/llm
/resources
/infrastructure
/territory
/defense
/system
/metrics
```

---

# 9. API MIDDLEWARE

Gunakan:
- request ID
- authentication
- authorization
- rate limit
- validation
- error handler
- audit log
- CORS policy bila diperlukan

---

# 10. AUDIT LOG

```js
{
  id,
  actor,
  action,
  target,
  timestamp,
  requestId,
  result
}
```

Catat perubahan penting pada bot, goal, plugin, module, configuration, strategy, dan model.

---

# 11. OBSERVABILITY

Tiga pilar:
```text
Logs
Metrics
Traces
```

Metrics minimal:
- uptime
- task latency
- event rate
- queue depth
- API latency
- LLM latency
- DB latency
- ML latency
- memory retrieval latency
- error rate

---

# 12. STRUCTURED LOGGING

```json
{
  "level": "info",
  "timestamp": "...",
  "service": "task-service",
  "event": "task.completed",
  "requestId": "...",
  "correlationId": "...",
  "metadata": {}
}
```

Tidak boleh log API keys, passwords, tokens, atau private credentials.

---

# 13. DEBUG MODES

Support:
```text
normal
core
bot
behavior
planner
llm
memory
ml
hivemind
database
api
```

Debug mode harus configurable dan tidak mengubah business logic.

---

# 14. OPERATIONS CLI

```bash
minehive status
minehive health
minehive dashboard

minehive bot list
minehive bot inspect <id>

minehive goal list
minehive task list

minehive memory search <query>
minehive knowledge search <query>

minehive logs
minehive metrics

minehive db migrate
minehive db backup
minehive db restore
```

---

# 15. CONFIGURATION MANAGEMENT

Sediakan:
- schema validation
- environment overrides
- profile loading
- reload policy

Jangan mengizinkan arbitrary runtime config mutation.

---

# 16. TESTING

API:
- unit
- contract
- integration
- auth tests
- authorization tests
- rate-limit tests

Dashboard:
- component tests
- API mocking
- smoke tests

Observability:
- log schema
- metric emission
- trace context

---

# 17. DEFINITION OF DONE

[ ] Dashboard
[ ] API v1
[ ] Authentication boundary
[ ] Authorization
[ ] Audit Log
[ ] Logging
[ ] Metrics
[ ] Tracing
[ ] Debug Modes
[ ] Operations CLI
[ ] Config Management
[ ] API Tests
[ ] Dashboard Tests
