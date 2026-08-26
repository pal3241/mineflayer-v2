# MINEHIVE — MASTER PROMPT VOL 12
## ADVANCED AI DECISION SYSTEM

VOL 12 memperdalam:
- 12 AI System.md
- 10 State Machine.md
- 11 Behavior Tree.md
- 14 Memory System.md
- 15 Machine Learning.md
- 16 HiveMind.md
- 17 Multi Bot.md

Tujuan utama adalah membangun AI decision architecture berlapis yang menggabungkan deterministic rules, heuristic, planning, memory, ML, dan LLM tanpa memberikan kontrol langsung kepada model generatif.

---

# 1. DECISION ARCHITECTURE

```text
Observation
 ↓
Context Builder
 ↓
Candidate Generator
 ↓
Policy Filter
 ↓
Risk Evaluation
 ↓
Utility Scoring
 ↓
Planner
 ↓
Decision Validator
 ↓
Execution
 ↓
Verification
```

---

# 2. FOLDER STRUCTURE

```text
src/ai/
├── decision/
│   ├── decision-engine.js
│   ├── decision.js
│   ├── candidate.js
│   └── candidate-generator.js
├── context/
│   ├── context-builder.js
│   ├── context-selector.js
│   └── context-budget.js
├── policy/
├── utility/
├── risk/
├── planning/
├── verification/
├── self-model/
└── ai-service.js
```

---

# 3. DECISION OBJECT

```js
{
  id,
  goalId,
  taskId,
  botId,
  intent,
  parameters,
  confidence,
  expectedOutcome,
  cost,
  risk,
  source,
  createdAt
}
```

---

# 4. DECISION SOURCES

Gunakan prioritas:

```text
Hard Safety Rules
↓
System Policies
↓
Deterministic Planner
↓
Heuristics
↓
ML Recommendation
↓
LLM Recommendation
```

LLM dan ML tidak boleh melewati hard safety rules.

---

# 5. CANDIDATE GENERATION

Candidate dapat berasal dari:
- rule engine
- planner
- behavior tree
- ML
- LLM
- recovery system

Candidate harus menggunakan schema yang sama agar dapat dibandingkan.

---

# 6. RISK ENGINE

Buat:

```text
src/ai/risk/
├── risk-engine.js
├── risk-factor.js
├── risk-score.js
└── risk-policy.js
```

Evaluasi:
- death risk
- health risk
- resource loss
- equipment loss
- distance
- unknown area
- hostile entities
- task complexity
- reversibility
- uncertainty

---

# 7. UTILITY ENGINE

Contoh:

```text
utility =
expectedReward
- timeCost
- resourceCost
- riskCost
- opportunityCost
```

Weight harus configurable.

---

# 8. SELF MODEL

Self Model menyimpan:

```text
known capabilities
plugin availability
bot availability
historical success
historical failures
resource limits
latency
known weaknesses
```

Planner harus menggunakan Self Model agar tidak membuat rencana mustahil.

---

# 9. CONTEXT ENGINE

Context tidak boleh berisi semua data.

Pilih berdasarkan:
- current task
- goal
- location
- recent observations
- relevant memory
- relevant knowledge
- bot capabilities
- current risks

---

# 10. CONFIDENCE

Setiap recommendation harus memiliki confidence.

Confidence harus berasal dari:
- evidence
- source reliability
- model confidence
- historical performance
- uncertainty

---

# 11. DECISION VALIDATION

Flow:

```text
Decision
 ↓
Schema Validation
 ↓
Policy Validation
 ↓
Capability Validation
 ↓
Resource Validation
 ↓
Risk Threshold
 ↓
Execution Permission
```

---

# 12. FALLBACK

Jika:
- LLM unavailable
- ML unavailable
- memory unavailable
- planner fails

gunakan:
- deterministic rule
- simple heuristic
- safe idle
- return-to-base

---

# 13. DECISION AUDIT

Simpan:
```js
{
  decisionId,
  alternatives,
  selected,
  reason,
  confidence,
  risk,
  result,
  timestamp
}
```

Tidak perlu menyimpan private chain-of-thought model.

---

# 14. MULTI-BOT DECISION

Untuk fleet:
```text
Global Goal
 ↓
HiveMind
 ↓
Candidate Team Plans
 ↓
Score
 ↓
Select
 ↓
Assign
```

---

# 15. TESTING

Uji:
- conflicting goals
- low health
- resource shortage
- invalid LLM recommendation
- low confidence
- high risk
- ML unavailable
- planner failure
- safe fallback

---

# 16. DEFINITION OF DONE

[ ] Decision Engine
[ ] Context Engine
[ ] Candidate Generator
[ ] Risk Engine
[ ] Utility Engine
[ ] Self Model
[ ] Decision Validation
[ ] Confidence
[ ] Fallback
[ ] Audit
[ ] Multi-Bot integration
[ ] Tests
