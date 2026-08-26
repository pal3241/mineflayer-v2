# MINEHIVE — MASTER PROMPT VOL 15
## MACHINE LEARNING TRAINING, EVALUATION & MODEL REGISTRY

VOL 15 memperdalam:
- 15 Machine Learning.md
- 12 AI System.md
- 14 Memory System.md
- 16 HiveMind.md
- 20 Database.md
- 22 Testing.md
- 23 Deployment.md

Tujuan utama adalah membangun ML subsystem yang reproducible, versioned, measurable, safe, dan dapat digunakan sebagai decision-support MineHive.

---

# 1. ML ARCHITECTURE

```text
Experience / Telemetry
 ↓
Dataset Builder
 ↓
Validation
 ↓
Feature Pipeline
 ↓
Train
 ↓
Evaluate
 ↓
Model Registry
 ↓
Shadow / Limited Rollout
 ↓
Production
 ↓
Monitoring
```

---

# 2. FOLDER STRUCTURE

```text
src/ml/
├── datasets/
├── preprocessing/
├── features/
├── training/
├── evaluation/
├── inference/
├── registry/
├── deployment/
├── monitoring/
├── drift/
└── ml-service.js
```

---

# 3. DATASET SYSTEM

Dataset metadata:

```js
{
  id,
  version,
  source,
  schema,
  sampleCount,
  createdAt,
  featureVersion,
  labelVersion
}
```

Dataset harus reproducible.

---

# 4. FEATURE PIPELINE

Contoh features:
- distance
- health
- food
- armor
- task type
- task priority
- path length
- historical success rate
- nearby danger
- inventory capacity
- agent reliability
- tool availability

Feature extraction harus deterministic.

---

# 5. TRAINING PIPELINE

```text
Collect
 ↓
Validate
 ↓
Clean
 ↓
Transform
 ↓
Split
 ↓
Train
 ↓
Evaluate
 ↓
Register Candidate
```

---

# 6. TRAINING RUN

```js
{
  runId,
  datasetVersion,
  featureVersion,
  modelType,
  hyperparameters,
  metrics,
  artifact,
  createdAt
}
```

---

# 7. EVALUATION

Gunakan metric yang sesuai.

Classification:
- accuracy
- precision
- recall
- F1

Regression:
- MAE
- RMSE
- R²

System:
- latency
- memory
- failure rate

---

# 8. MODEL REGISTRY

Status:

```text
CANDIDATE
EVALUATED
APPROVED
SHADOW
LIMITED
PRODUCTION
DEPRECATED
FAILED
```

Model record:

```js
{
  id,
  version,
  task,
  datasetVersion,
  featureVersion,
  metrics,
  artifactPath,
  status,
  createdAt
}
```

---

# 9. PROMOTION

Model baru tidak langsung production.

Flow:

```text
Candidate
 ↓
Offline Evaluation
 ↓
Approval Gate
 ↓
Shadow
 ↓
Limited Rollout
 ↓
Production
```

---

# 10. ROLLBACK

Jika:
- performance drop
- unexpected error
- latency regression
- drift
- bad prediction rate

maka:
```text
rollback to previous production model
```

---

# 11. INFERENCE SERVICE

```text
Input
 ↓
Schema Validation
 ↓
Feature Build
 ↓
Model Load
 ↓
Prediction
 ↓
Confidence
 ↓
Decision Engine
```

Prediction tidak boleh mengeksekusi action secara langsung.

---

# 12. USE CASES

ML dapat digunakan untuk:
- task success prediction
- agent selection
- route quality
- resource demand
- threat prediction
- failure probability
- strategy comparison

---

# 13. DRIFT

Monitor:
- feature drift
- label drift
- prediction drift
- performance drift

Flow:

```text
Detect Drift
 ↓
Alert
 ↓
Evaluate
 ↓
Build New Candidate
 ↓
Retrain
```

---

# 14. ONLINE LEARNING BOUNDARY

Jangan melakukan uncontrolled continuous training.

Gunakan:
- buffer
- minimum sample count
- validation
- candidate model
- promotion gate

---

# 15. ML + HIVEMIND

HiveMind dapat menggunakan:
- agent reliability score
- task success probability
- resource forecast
- threat probability

Tetapi final decision tetap melewati policy dan safety.

---

# 16. ML + LLM

Gunakan prinsip:

```text
ML = prediction / scoring
LLM = reasoning / interpretation
Rules = safety
Planner = execution planning
```

Jangan mencampur tanggung jawab.

---

# 17. MODEL MONITORING

Track:
- prediction count
- latency
- error
- confidence
- real outcome
- accuracy over time
- drift

---

# 18. DATABASE

Persist:
- dataset metadata
- training runs
- models
- metrics
- promotion history
- rollback history
- drift events

Binary artifact gunakan storage abstraction.

---

# 19. TESTING

Wajib:
- dataset validation
- feature determinism
- training pipeline
- model registry
- inference schema
- fallback
- promotion
- rollback
- drift detection
- regression test

---

# 20. DEFINITION OF DONE

[ ] Dataset System
[ ] Feature Pipeline
[ ] Training Pipeline
[ ] Evaluation
[ ] Model Registry
[ ] Model Versioning
[ ] Promotion Pipeline
[ ] Shadow Deployment
[ ] Limited Rollout
[ ] Rollback
[ ] Inference Service
[ ] Drift Detection
[ ] Monitoring
[ ] HiveMind Integration
[ ] LLM Integration
[ ] Database Integration
[ ] Tests
