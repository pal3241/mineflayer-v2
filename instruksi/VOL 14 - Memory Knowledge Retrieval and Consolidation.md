# MINEHIVE — MASTER PROMPT VOL 14
## MEMORY, KNOWLEDGE, RETRIEVAL & CONSOLIDATION

VOL 14 memperdalam:
- 14 Memory System.md
- 12 AI System.md
- 13 LLM System.md
- 15 Machine Learning.md
- 16 HiveMind.md
- 20 Database.md

Tujuan utama adalah membangun memory architecture yang persistent, hierarchical, searchable, confidence-aware, provenance-aware, dan scalable.

---

# 1. MEMORY ARCHITECTURE

```text
Observation / Experience
          ↓
      Memory Intake
          ↓
       Validation
          ↓
    Short-Term Memory
          ↓
    Consolidation Engine
          ↓
 ┌────────┼─────────┐
 ↓        ↓         ↓
Episodic Semantic Procedural
 └────────┼─────────┘
          ↓
     Long-Term Memory
```

---

# 2. FOLDER STRUCTURE

```text
src/memory/
├── intake/
├── working/
├── short-term/
├── episodic/
├── semantic/
├── procedural/
├── long-term/
├── retrieval/
├── ranking/
├── consolidation/
├── forgetting/
├── provenance/
├── embeddings/
└── memory-service.js
```

---

# 3. MEMORY TYPES

```text
WORKING
SHORT_TERM
EPISODIC
SEMANTIC
PROCEDURAL
LONG_TERM
```

Working Memory:
context runtime.

Episodic:
kejadian spesifik.

Semantic:
fakta/general knowledge.

Procedural:
cara melakukan sesuatu.

---

# 4. MEMORY RECORD

```js
{
  id,
  type,
  content,
  source,
  botId,
  taskId,
  confidence,
  importance,
  tags,
  createdAt,
  updatedAt,
  version,
  metadata
}
```

---

# 5. MEMORY INTAKE

Tidak semua event harus menjadi memory.

Gunakan:
- importance threshold
- novelty
- success/failure relevance
- strategic relevance
- repeated event suppression

---

# 6. RETRIEVAL

Ranking:

```text
score =
semanticSimilarity
+ taskRelevance
+ importance
+ recency
+ confidence
+ sourceReliability
```

Weight configurable.

---

# 7. EMBEDDINGS

Embedding provider harus abstraction.

Jangan mengunci sistem ke satu embedding model.

Simpan:
- embedding model/version
- dimension
- generatedAt

---

# 8. CONSOLIDATION

Flow:

```text
Raw Memories
 ↓
Deduplicate
 ↓
Cluster
 ↓
Summarize
 ↓
Extract Lesson
 ↓
Promote
```

---

# 9. FORGETTING

Gunakan controlled forgetting:
- stale
- duplicate
- low importance
- low confidence
- superseded
- storage policy

Jangan menghapus critical memory tanpa policy.

---

# 10. PROVENANCE

Knowledge harus dapat menjawab:
- source siapa?
- kapan?
- bot mana?
- task mana?
- confidence?
- diverifikasi oleh siapa?
- version berapa?

---

# 11. CONFLICT RESOLUTION

Contoh:

```text
Memory A:
Area safe
Confidence 0.80

Memory B:
Area dangerous
Confidence 0.92
```

Flow:

```text
Detect Conflict
 ↓
Compare Freshness
 ↓
Compare Evidence
 ↓
Verification Task
 ↓
Resolve / Mark Unresolved
```

---

# 12. MEMORY SHARING

Support:
- private bot memory
- team memory
- HiveMind shared memory
- global knowledge

Permission harus jelas.

---

# 13. DATABASE

Persistence:
- metadata in database
- large vector/artifact storage abstraction bila diperlukan
- indexes
- migration
- backup

---

# 14. MEMORY + LLM

LLM menerima:
```text
Top Relevant Memories
+
Current Context
```

Bukan seluruh memory database.

---

# 15. MEMORY + ML

Memory dapat menjadi sumber:
- dataset
- feature history
- success labels
- failure labels

Training pipeline harus tetap terpisah.

---

# 16. TESTING

Uji:
- intake filter
- persistence
- retrieval ranking
- dedupe
- consolidation
- forgetting
- provenance
- conflicts
- shared memory permission
- embedding provider fallback

---

# 17. DEFINITION OF DONE

[ ] Hierarchical Memory
[ ] Intake Filter
[ ] Retrieval
[ ] Ranking
[ ] Embedding abstraction
[ ] Consolidation
[ ] Forgetting
[ ] Provenance
[ ] Conflict Resolution
[ ] Shared Memory
[ ] DB Integration
[ ] LLM Integration
[ ] ML Integration
[ ] Tests
