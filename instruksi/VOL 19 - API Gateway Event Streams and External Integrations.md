# MINEHIVE — MASTER PROMPT VOL 19
## API GATEWAY, EVENT STREAMS & EXTERNAL INTEGRATIONS

VOL 19 memperdalam:
- 19 API.md
- 09 Service Layer.md
- 16 HiveMind.md
- 17 Multi Bot.md
- 18 Dashboard.md
- 20 Database.md
- 21 Coding Standard.md
- 22 Testing.md
- 23 Deployment.md

Tujuan utama adalah menyediakan API yang stabil, versioned, secure, observable, dan siap dipakai dashboard, CLI, automation, serta integration adapter.

---

# 1. API ARCHITECTURE

```text
Client
 ↓
API Gateway
 ↓
Middleware
 ↓
Controller
 ↓
Service Layer
 ↓
Domain
 ↓
Repository
```

---

# 2. FOLDER STRUCTURE

```text
src/api/
├── gateway/
├── routes/
├── controllers/
├── middleware/
├── schemas/
├── dto/
├── auth/
├── events/
├── webhooks/
├── docs/
└── api-service.js
```

---

# 3. VERSIONING

Gunakan:

```text
/api/v1/
```

Breaking change harus membuat versi baru.

---

# 4. CORE RESOURCES

```text
/bots
/fleet
/groups
/goals
/tasks
/hivemind
/memory
/knowledge
/llm
/ml
/plugins
/modules
/resources
/infrastructure
/territory
/defense
/metrics
/health
/system
```

---

# 5. REQUEST CONTEXT

Setiap request memiliki:
```js
{
  requestId,
  correlationId,
  actor,
  permissions,
  receivedAt
}
```

---

# 6. VALIDATION

Gunakan schema validation untuk:
- path params
- query params
- headers
- body
- responses

---

# 7. ERROR CONTRACT

```js
{
  code,
  message,
  requestId,
  details
}
```

Production API tidak boleh mengirim stack trace internal.

---

# 8. AUTHENTICATION

Buat abstraction:
- token-based auth
- future provider support

Jangan hardcode credential.

---

# 9. AUTHORIZATION

Roles contoh:
```text
VIEWER
OPERATOR
ADMIN
```

Permissions granular:
- bot.read
- bot.control
- task.cancel
- plugin.manage
- system.configure

---

# 10. RATE LIMITING

Apply berdasarkan:
- client
- identity
- route
- risk

Critical mutation routes lebih ketat.

---

# 11. IDEMPOTENCY

Mutation penting seperti:
- create bot
- create goal
- reserve resource

harus mendukung idempotency key.

---

# 12. EVENT STREAMS

Support event subscription:
- WebSocket
- SSE abstraction

Event:
```js
{
  id,
  type,
  version,
  timestamp,
  source,
  payload
}
```

---

# 13. WEBHOOKS

Support:
- registration
- secret/signature
- delivery ID
- retry
- timeout
- disable on repeated failure
- dead-letter queue

---

# 14. EXTERNAL INTEGRATIONS

Gunakan:

```text
MineHive
 ↓
Integration Interface
 ↓
Provider Adapter
```

Provider-specific code tidak boleh bocor ke Core Engine.

---

# 15. AUDIT

Catat:
- authentication
- bot controls
- task cancellation
- goal changes
- plugin changes
- module changes
- settings changes
- model promotion
- database restore

---

# 16. API DOCUMENTATION

Generate:
- endpoint descriptions
- request schemas
- response schemas
- error codes
- auth requirements
- examples

---

# 17. TESTING

Uji:
- route contract
- schema validation
- authentication
- authorization
- rate limiting
- idempotency
- event stream
- webhook retry
- signature
- error mapping

---

# 18. DEFINITION OF DONE

[ ] API v1
[ ] Validation
[ ] Authentication
[ ] Authorization
[ ] Rate Limiting
[ ] Idempotency
[ ] Event Streams
[ ] Webhooks
[ ] External Adapter Contract
[ ] Audit
[ ] API Docs
[ ] Tests
