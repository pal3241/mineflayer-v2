# MINEHIVE — MASTER PROMPT VOL 18
## DASHBOARD UX, MONITORING & CONTROL CENTER

VOL 18 memperdalam:
- 18 Dashboard.md
- 19 API.md
- 16 HiveMind.md
- 17 Multi Bot.md
- 20 Database.md
- 21 Coding Standard.md
- 22 Testing.md
- 23 Deployment.md

Tujuan utama adalah membuat dashboard sebagai control center yang aman, real-time, observable, dan tidak menembus service boundaries.

---

# 1. DASHBOARD ARCHITECTURE

```text
Browser
 ↓
Dashboard Frontend
 ↓
API Client
 ↓
API Gateway
 ↓
Service Layer
 ↓
MineHive Core
```

Dashboard tidak boleh mengakses domain internals secara langsung.

---

# 2. FOLDER STRUCTURE

```text
dashboard/
├── src/
│   ├── app/
│   ├── components/
│   ├── pages/
│   ├── charts/
│   ├── hooks/
│   ├── api/
│   ├── state/
│   ├── realtime/
│   └── utils/
├── tests/
└── package.json
```

---

# 3. MAIN PAGES

```text
Overview
Fleet
Bot Detail
Goals
Tasks
HiveMind
World
Memory
Knowledge
LLM
ML
Plugins
Modules
Resources
Infrastructure
Defense
Logs
Metrics
Settings
```

---

# 4. OVERVIEW PAGE

Tampilkan:
- fleet health
- active bots
- degraded bots
- task throughput
- failed tasks
- goal completion
- LLM health
- ML health
- database health
- plugin health
- system alerts

---

# 5. BOT DETAIL

Tampilkan:
- connection
- health
- food
- position
- state machine
- behavior tree
- active task
- capabilities
- plugin state
- recent events
- recent errors

---

# 6. CONTROL ACTIONS

Support:
- start
- stop
- restart
- pause
- resume
- drain
- assign goal
- cancel task

Flow:

```text
UI
 ↓
API
 ↓
Authentication
 ↓
Authorization
 ↓
Service
 ↓
Audit Log
```

---

# 7. REAL-TIME EVENTS

Gunakan event stream/WebSocket/SSE abstraction untuk:
- bot state
- task updates
- alerts
- logs
- metrics
- emergency events

UI harus:
- reconnect
- resubscribe
- detect stale data

---

# 8. ALERTS

Severity:
```text
INFO
WARNING
ERROR
CRITICAL
```

Alert:
```js
{
  id,
  severity,
  source,
  message,
  timestamp,
  acknowledged
}
```

---

# 9. UX SAFETY

Destructive action harus:
- confirmation
- clear target
- current status
- permission check
- audit record

Contoh:
```text
Stop 12 bots
```
harus lebih sulit dilakukan daripada membuka detail bot.

---

# 10. METRICS CHARTS

Charts:
- fleet uptime
- task success
- task duration
- queue depth
- LLM latency
- ML latency
- DB latency
- memory retrieval
- event throughput
- plugin failures

---

# 11. LOG VIEWER

Support:
- filter by level
- service
- bot
- correlationId
- timeframe
- search

Jangan tampilkan secrets.

---

# 12. MEMORY / KNOWLEDGE VIEW

Support:
- search
- filter
- confidence
- source
- age
- provenance
- verification status

---

# 13. LLM VIEW

Tampilkan:
- providers
- model health
- latency
- request counts
- budget usage
- errors
- fallback events

Jangan tampilkan API keys.

---

# 14. ML VIEW

Tampilkan:
- active models
- model status
- accuracy/metrics
- drift
- latest training
- production version

---

# 15. RESPONSIVE DESIGN

Dashboard harus usable pada:
- desktop
- laptop
- tablet

Mobile boleh read-only untuk fitur kompleks bila diperlukan.

---

# 16. TESTING

Wajib:
- component tests
- API mock tests
- permission tests
- reconnect tests
- stale event tests
- destructive action confirmation
- alert rendering
- smoke tests

---

# 17. DEFINITION OF DONE

[ ] Overview
[ ] Fleet View
[ ] Bot Detail
[ ] Task/Goal View
[ ] HiveMind View
[ ] Memory/Knowledge View
[ ] LLM View
[ ] ML View
[ ] Real-Time Updates
[ ] Alerts
[ ] Logs
[ ] Metrics
[ ] Safe Controls
[ ] Responsive UI
[ ] Tests
