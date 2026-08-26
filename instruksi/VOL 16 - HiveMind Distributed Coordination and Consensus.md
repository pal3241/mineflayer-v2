# MINEHIVE — MASTER PROMPT VOL 16
## HIVEMIND DISTRIBUTED COORDINATION & CONSENSUS

VOL 16 memperdalam:
- 16 HiveMind.md
- 09 Service Layer.md
- 12 AI System.md
- 14 Memory System.md
- 15 Machine Learning.md
- 17 Multi Bot.md
- 19 API.md
- 20 Database.md
- 22 Testing.md

Tujuan utama adalah menjadikan HiveMind sebagai coordination layer terdistribusi untuk banyak bot tanpa membuat satu coordinator menjadi single point of failure.

---

# 1. ARCHITECTURE

```text
Bots / Agents
    |
    v
Membership Layer
    |
    v
Messaging Layer
    |
    v
Shared State
    |
    +--> Consensus
    +--> Coordination
    +--> Elections
    +--> Distributed Locks
    |
    v
HiveMind Service
```

---

# 2. FOLDER STRUCTURE

```text
src/hivemind/
├── membership/
│   ├── member.js
│   ├── membership-manager.js
│   └── heartbeat-monitor.js
├── messaging/
│   ├── message.js
│   ├── router.js
│   ├── inbox.js
│   ├── outbox.js
│   └── dead-letter.js
├── shared-state/
├── consensus/
├── coordination/
├── elections/
├── locks/
├── reconciliation/
└── hive-service.js
```

---

# 3. MEMBERSHIP

Member record:

```js
{
  id,
  role,
  status,
  capabilities,
  joinedAt,
  lastHeartbeat,
  version
}
```

Status:
```text
JOINING
ACTIVE
DEGRADED
SUSPECT
OFFLINE
LEAVING
```

Heartbeat timeout harus configurable.

---

# 4. MESSAGING

Message envelope:

```js
{
  id,
  sender,
  recipient,
  type,
  payload,
  timestamp,
  correlationId,
  causationId,
  ttl,
  priority
}
```

Support:
- direct
- broadcast
- group
- request/response
- emergency
- coordination
- knowledge sharing

---

# 5. IDEMPOTENCY

Duplicate message tidak boleh menghasilkan duplicate side effects.

Gunakan:
- message ID
- idempotency key
- processed-message cache
- persistence bila critical

---

# 6. DELIVERY

Delivery states:
```text
CREATED
QUEUED
SENT
DELIVERED
ACKNOWLEDGED
FAILED
EXPIRED
```

Gunakan retry terbatas.

---

# 7. SHARED STATE

Shared state harus versioned.

```js
{
  key,
  value,
  version,
  updatedAt,
  source
}
```

Conflict policy:
- latest valid version
- authority-based
- consensus
- merge strategy

---

# 8. CONSENSUS

Buat:

```text
src/hivemind/consensus/
├── proposal.js
├── vote.js
├── quorum.js
├── consensus-engine.js
└── decision-record.js
```

Flow:

```text
Proposal
 ↓
Evidence Collection
 ↓
Voting
 ↓
Quorum Check
 ↓
Decision
 ↓
Publish
```

Gunakan consensus hanya untuk keputusan penting.

---

# 9. VOTING WEIGHTS

Bobot dapat mempertimbangkan:
- agent reliability
- specialization
- evidence confidence
- data freshness
- authority
- current health

Jangan memberi weight permanen tanpa mekanisme recalibration.

---

# 10. DISTRIBUTED LOCKS

Gunakan untuk:
- resource reservation
- exclusive task
- shared chest transaction
- critical infrastructure action

Lock:
```js
{
  key,
  owner,
  expiresAt,
  version
}
```

Lock harus:
- expiring
- renewable
- releasable
- recoverable

---

# 11. LEADER ELECTION

Jika subsystem membutuhkan leader:
```text
Detect leader unavailable
 ↓
Election
 ↓
Candidate scoring
 ↓
Winner
 ↓
State transfer
 ↓
Resume
```

Jangan membuat seluruh HiveMind bergantung pada leader.

---

# 12. PARTITION HANDLING

Saat network partition:

```text
Detect
 ↓
Mark Degraded
 ↓
Local Safe Policy
 ↓
Queue Messages
 ↓
Reconnect
 ↓
Reconcile
```

Agent harus tetap dapat menjalankan behavior lokal yang aman.

---

# 13. RECONCILIATION

Setelah reconnect:
- compare versions
- resolve conflicts
- replay queued events
- invalidate expired commands
- verify resource locks

---

# 14. KNOWLEDGE COORDINATION

HiveMind dapat:
- publish knowledge
- request verification
- resolve conflicts
- distribute discoveries
- maintain shared confidence

---

# 15. AI COORDINATION

HiveMind dapat meminta:
- planner proposal
- ML prediction
- LLM recommendation
- memory retrieval

Final execution tetap melewati policy + validation.

---

# 16. TELEMETRY

Track:
- active members
- dropped messages
- retries
- consensus latency
- failed consensus
- lock contention
- partition events
- reconciliation time

---

# 17. TESTING

Uji:
- duplicate message
- delayed message
- expired TTL
- member timeout
- stale shared state
- failed leader
- lock expiry
- partition
- reconciliation
- consensus without quorum

---

# 18. DEFINITION OF DONE

[ ] Membership
[ ] Heartbeat
[ ] Messaging
[ ] Idempotency
[ ] Shared State
[ ] Consensus
[ ] Voting
[ ] Distributed Locks
[ ] Election
[ ] Partition Handling
[ ] Reconciliation
[ ] Knowledge Coordination
[ ] AI Integration
[ ] Telemetry
[ ] Tests
