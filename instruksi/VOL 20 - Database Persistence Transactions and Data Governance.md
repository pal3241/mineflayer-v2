# MINEHIVE — MASTER PROMPT VOL 20
## DATABASE, PERSISTENCE, TRANSACTIONS & DATA GOVERNANCE

VOL 20 memperdalam:
- 20 Database.md
- 14 Memory System.md
- 15 Machine Learning.md
- 16 HiveMind.md
- 17 Multi Bot.md
- 19 API.md
- 21 Coding Standard.md
- 22 Testing.md
- 23 Deployment.md

Tujuan utama adalah membuat persistence layer yang consistent, transactional, versioned, observable, recoverable, dan siap untuk data MineHive dalam skala besar.

---

# 1. DATABASE ARCHITECTURE

```text
Service Layer
 ↓
Repository Interface
 ↓
Transaction Manager
 ↓
Database Adapter
 ↓
Database
```

Domain tidak boleh bergantung pada SQL driver.

---

# 2. FOLDER STRUCTURE

```text
src/database/
├── adapters/
├── repositories/
├── models/
├── mappers/
├── migrations/
├── transactions/
├── backup/
├── restore/
├── seeds/
├── health/
└── database-service.js
```

---

# 3. TARGET STORAGE

Support:
- JSON adapter untuk dev/test ringan
- SQLite sebagai default local production
- future PostgreSQL adapter

Repository contract harus konsisten.

---

# 4. DATA DOMAINS

Persist:
```text
bots
bot_state
fleet
groups
goals
tasks
events
memory
knowledge
models
training_runs
metrics
audit_logs
plugins
modules
resources
infrastructure
territory
system_state
```

---

# 5. REPOSITORY CONTRACT

Contoh:

```js
{
  create(entity),
  findById(id),
  find(query),
  update(id, changes),
  delete(id),
  list(options)
}
```

---

# 6. TRANSACTIONS

Gunakan transaction untuk operasi atomic.

Contoh:

```text
Reserve Resource
+
Create Task
+
Update Goal
```

Jika satu gagal:
```text
ROLLBACK
```

---

# 7. CONCURRENCY

Handle:
- concurrent updates
- duplicate tasks
- resource reservation race
- stale state

Gunakan optimistic concurrency/versioning jika sesuai.

---

# 8. IDEMPOTENCY

Command penting menyimpan:
- idempotency key
- result reference
- timestamp

Duplicate request harus mengembalikan result lama jika aman.

---

# 9. MIGRATIONS

Setiap migration harus:
- versioned
- ordered
- tested
- logged
- backward-aware

Jangan edit migration production lama setelah release.

---

# 10. SCHEMA VERSION

Simpan schema version secara eksplisit.

Startup:
```text
Read version
 ↓
Compare required version
 ↓
Migrate
 ↓
Validate
 ↓
Start services
```

---

# 11. BACKUP

Support:
- manual backup
- scheduled backup
- snapshot metadata
- verification
- retention
- restore test

---

# 12. RESTORE

Flow:

```text
Stop Writes
 ↓
Validate Backup
 ↓
Restore
 ↓
Run Migration if Needed
 ↓
Integrity Check
 ↓
Resume
```

---

# 13. DATA GOVERNANCE

Definisikan:
- data owner
- retention
- archival
- deletion
- provenance
- schema version
- backup policy

---

# 14. MEMORY DATA

Memory persistence harus menjaga:
- type
- confidence
- importance
- provenance
- timestamps
- version

Embedding data boleh disimpan melalui abstraction terpisah.

---

# 15. ML DATA

Persist:
- dataset metadata
- training runs
- model metadata
- metrics
- promotion history
- rollback history
- drift events

Binary model artifact tidak disimpan langsung ke row database jika tidak efisien.

---

# 16. EVENT DATA

Event table/index mendukung:
- type
- source
- timestamp
- correlationId
- entity ID

Critical events harus immutable.

---

# 17. AUDIT DATA

Audit log harus append-only secara logical.

Track:
- actor
- action
- target
- requestId
- result
- timestamp

---

# 18. INDEXING

Index query utama:
- task status
- bot status
- timestamps
- correlationId
- event type
- memory metadata
- model status
- audit actor

---

# 19. HEALTH

Database health:
- connectivity
- latency
- migration status
- storage usage
- write test/read test sesuai mode

---

# 20. TESTING

Wajib:
- repository
- transactions
- rollback
- concurrent writes
- idempotency
- migrations
- schema compatibility
- backup
- restore
- integrity
- index-critical queries

---

# 21. DEFINITION OF DONE

[ ] Database abstraction
[ ] JSON adapter
[ ] SQLite adapter
[ ] Repository layer
[ ] Transactions
[ ] Concurrency handling
[ ] Idempotency
[ ] Migrations
[ ] Schema Versioning
[ ] Backup
[ ] Restore
[ ] Data Governance
[ ] Memory Persistence
[ ] ML Persistence
[ ] Event Persistence
[ ] Audit Persistence
[ ] Health
[ ] Tests
