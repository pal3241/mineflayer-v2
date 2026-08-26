# MINEHIVE — MASTER PROMPT VOL 13
## LLM GATEWAY, MULTI-MODEL ROUTING & SAFE TOOL USE

VOL 13 memperdalam:
- 13 LLM System.md
- 12 AI System.md
- 07 Module SDK.md
- 08 Plugin SDK.md
- 09 Service Layer.md
- 14 Memory System.md
- 16 HiveMind.md

Tujuan utama adalah membuat LLM menjadi provider-agnostic reasoning service yang aman, hemat biaya, dapat diobservasi, dan dapat digunakan banyak agent.

---

# 1. LLM ARCHITECTURE

```text
AI Decision Engine
 ↓
LLM Gateway
 ↓
Model Router
 ↓
Provider Adapter
 ↓
LLM Provider
 ↓
Structured Response
 ↓
Validator
 ↓
Decision Engine
```

LLM tidak mengendalikan Mineflayer langsung.

---

# 2. FOLDER STRUCTURE

```text
src/llm/
├── gateway/
│   ├── llm-gateway.js
│   └── request.js
├── providers/
├── routing/
├── prompts/
├── context/
├── output/
├── tools/
├── budget/
├── cache/
├── telemetry/
└── llm-service.js
```

---

# 3. PROVIDER CONTRACT

```js
{
  id,
  capabilities,
  generate(request),
  stream(request),
  embed(request),
  health()
}
```

Support:
- OpenAI-compatible provider
- OpenRouter-compatible provider
- local model
- future providers

Jangan mengikat core pada satu API.

---

# 4. MODEL ROUTER

Routing berdasarkan:
- task complexity
- latency
- model capability
- context length
- budget
- provider health
- historical reliability

Contoh:

```text
Simple classification
→ fast model

Planning
→ reasoning model

Summarization
→ cheap model

Critical strategy
→ stronger model + validation
```

---

# 5. REQUEST OBJECT

```js
{
  requestId,
  agentId,
  taskId,
  purpose,
  messages,
  context,
  tools,
  outputSchema,
  budget,
  timeout
}
```

---

# 6. STRUCTURED OUTPUT

Semua important output harus structured.

Contoh:

```json
{
  "intent": "gather_resource",
  "resource": "oak_log",
  "amount": 32,
  "confidence": 0.88
}
```

Flow:
```text
Parse
→ Schema Validate
→ Semantic Validate
→ Policy Validate
```

---

# 7. PROMPT SYSTEM

Pisahkan:
- base system instructions
- policy instructions
- task prompt
- retrieved memory
- world context
- tool schemas

Gunakan template/versioning.

---

# 8. CONTEXT BUDGET

Context selector harus membatasi:
- memory count
- event count
- world observations
- knowledge entries

Prioritaskan relevansi.

---

# 9. TOOL REGISTRY

Tool:

```js
{
  name,
  description,
  inputSchema,
  outputSchema,
  requiredCapabilities,
  permission,
  riskLevel,
  timeout,
  execute()
}
```

LLM hanya boleh menggunakan tool terdaftar.

---

# 10. TOOL EXECUTION FLOW

```text
LLM Tool Request
 ↓
Schema Validation
 ↓
Permission
 ↓
Capability
 ↓
Risk Policy
 ↓
Tool Execute
 ↓
Verify Result
 ↓
Return Structured Result
```

---

# 11. BUDGET

Track:
- request count
- token estimate
- latency
- cost estimate
- cache hits

Budget:
- per agent
- per task
- global

---

# 12. CACHING

Cache hanya untuk request yang aman dan context-compatible.

Jangan cache:
- emergency decision
- rapidly changing world state
- credential-dependent requests

---

# 13. FAILURE & FALLBACK

Handle:
- timeout
- malformed output
- rate limit
- provider down
- model unavailable

Fallback:
```text
same provider alternative
→ secondary provider
→ deterministic AI path
```

---

# 14. LLM TELEMETRY

Track:
- provider
- model
- latency
- request status
- parsing failures
- tool call count
- estimated cost

Jangan log secret.

---

# 15. TESTING

Uji:
- provider mocks
- router
- structured parser
- invalid JSON
- schema failure
- timeout
- rate limit
- budget
- tool permission
- fallback
- provider health

---

# 16. DEFINITION OF DONE

[ ] LLM Gateway
[ ] Provider Contract
[ ] Multi-model Router
[ ] Structured Output
[ ] Prompt Versioning
[ ] Context Budget
[ ] Tool Registry
[ ] Safe Tool Execution
[ ] Budget
[ ] Cache
[ ] Fallback
[ ] Telemetry
[ ] Tests
