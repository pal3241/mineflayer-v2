# Modular Multi-Agent Team

Framework **Modular Multi-Agent AI Team** berbasis Python. Sistem dirancang agar
agent diperlakukan seperti **plugin**: menambah/menghapus/mengganti agent TIDAK
mengharuskan perubahan pada Core System.

> **Prinsip utama:** menambahkan agent baru tidak boleh mengharuskan developer
> mengubah Core System. Core hanya mengenal interface `BaseAgent`.

---

## PHASE 1 — FOUNDATION

Fase ini membangun fondasi:

```
core/
├── agent.py          # BaseAgent, AgentStatus, AgentHealth, AgentContext
├── registry.py       # AgentRegistry
├── factory.py        # AgentFactory
├── task.py           # Task, TaskResult, TaskStatus
├── task_manager.py   # TaskManager
└── discovery.py      # AgentDiscovery (auto-discovery dari folder agents/)
```

Agent (belum memakai LLM, logic sederhana):

```
agents/
├── research/researcher/     # research, web_search, information_gathering
├── development/coder/       # coding, python, debugging
├── testing/tester/          # testing, test_automation, qa
└── review/reviewer/         # review, code_review, quality
```

Total: **4 agents**.

---

## PHASE 2 — LLM SYSTEM

Fase ini menambahkan lapisan LLM abstrak. Agent TIDAK pernah melihat
implementasi provider — hanya `LLMRouter`.

```
Agent
 ↓
LLM Router         (menerima model alias, baca config, pilih provider)
 ↓
LLM Client         (manajemen API key + retry terbatas)
 ↓
Provider           (BaseLLMProvider)
 ↓
OpenRouter
```

### Struktur baru

```
llm/
├── __init__.py            # export + build_llm_router() + loader .env
├── models.py              # LLMResponse + error hierarchy
├── client.py              # ApiKeyManager + LLMClient
├── router.py              # LLMRouter
├── utils.py               # parse_json_object (validasi JSON LLM)
└── providers/
    ├── __init__.py
    ├── base.py            # BaseLLMProvider (interface)
    └── openrouter.py      # OpenRouterProvider (httpx async)
config/
├── models.json            # alias -> {provider, model}
└── llm.json               # default_provider, timeout, max_retries
.env.example               # OPENROUTER_API_KEY_1..3
```

Agent baru (total 6):

```
agents/
├── analysis/analyst/      # analysis, reasoning, problem_analysis  (reasoning-model)
└── planning/planner/      # planning, task_planning, decomposition  (reasoning-model)
```

### Model alias

Agent memakai **alias**, bukan model ID provider:

| Agent | Model alias |
| --- | --- |
| researcher | `research-model` |
| coder / tester | `coding-model` |
| reviewer / analyst / planner | `reasoning-model` |

Alias dipetakan ke provider + model ID di `config/models.json`.

### Multiple API key & retry

- API key dibaca dari environment / `.env`: `OPENROUTER_API_KEY_1..3`
  (+ `OPENROUTER_API_KEY`).
- `ApiKeyManager` melakukan rotasi round-robin, melacak kegagalan per key,
  menandai `mark_failure` / `mark_success`.
- `LLMClient` melakukan retry **terbatas** (default 3) hanya untuk error
  transient (`RateLimitError`, `TimeoutError`). Error lain
  (`AuthenticationError`, `ModelNotFoundError`, `InvalidResponse`) langsung
  dilempar, tanpa retry otomatis.


---

## Arsitektur

```
USER
 │
 ▼
TASK MANAGER          (menerima Task, memilih agent berdasarkan capability)
 │
 ▼
AGENT REGISTRY        (menyimpan agent, memilih terbaik via scoring)
 │
 ▼
AGENT DISCOVERY ──► AGENT FACTORY ──► BaseAgent (dynamic agent)
```

Alur startup:

```
START
  ↓
Scan agents/            (cari manifest.json + agent.py)
  ↓
Load & validasi manifest
  ↓
Import kelas agent      (harus 1 subclass BaseAgent)
  ↓
Register ke Registry    (status READY)
```

Satu agent rusak **tidak menjatuhkan seluruh sistem** — error dicatat dan agent
lain tetap dimuat.

---

## Cara Menjalankan

```bash
# Menampilkan semua agent yang terdeteksi
python main.py agents

# Menjalankan task berdasarkan capability
python main.py run research "Pelajari framework asyncio"
python main.py run coding "Buat fungsi menghitung rata-rata"
python main.py run testing "Uji modul kalkulator"
python main.py run review "Review solusi coder"

# Agent LLM (Phase 2) — butuh API key di .env / environment
python main.py run analysis "Analisis penyebab bug di modul auth"
python main.py run planning "Buat kalkulator Python"

# Agent komunikasi (Phase 3) — memakai MessageBus / EventBus (tanpa perlu LLM)
python main.py run communication "Ringkas komunikasi saat ini"
python main.py run coordination "Buat kalkulator Python"
python main.py run supervision "Pantau kualitas sistem"
```

Contoh output:

```bash
python main.py agents
analyst        READY    analysis, reasoning, problem_analysis
coder          READY    coding, python, debugging
planner        READY    planning, task_planning, decomposition
researcher     READY    research, web_search, information_gathering
reviewer       READY    review, code_review, quality
tester         READY    testing, test_automation, qa
```

### Konfigurasi API key (`.env`)

```bash
# Salin lalu isi
cp .env.example .env
```

Isi minimalnya:

```env
OPENROUTER_API_KEY_1=sk-or-v1-xxxx
OPENROUTER_API_KEY_2=
OPENROUTER_API_KEY_3=
```

- Key TIDAK pernah disimpan di source code / manifest / `models.json`.
- `.env` masuk `.gitignore` — jangan pernah di-commit.
- Tanpa key, agent LLM (analyst/planner) gagal dengan pesan jelas
  `OpenRouter API key tidak tersedia` — bukan crash tanpa informasi.

### Menggunakan LLM dari agent

```python
# di dalam agent (subclass BaseAgent) dengan manifest model alias:
response = await self.llm([
    {"role": "user", "content": "Analisis masalah berikut..."},
])
data = parse_json_object(response.content)   # JSON divalidasi
```

Contoh runnable: `python -m scripts.llm_demo` (memakai FakeProvider, tanpa key).

---

## Cara Menambahkan Agent Baru

Core tidak perlu diubah. Cukup:

1. Salin template:
   ```
   templates/agent_template  ->  agents/custom/my_agent
   ```
2. Edit `agent.py` (id, role, capabilities, logika `run`).
3. Edit `manifest.json` (id, capabilities, enabled, model, dst).
4. Jalankan ulang / reload — Agent Discovery otomatis mendaftarkannya.

Contoh `agents/custom/my_agent/agent.py`:

```python
from core import BaseAgent

class MyAgent(BaseAgent):
    id = "my_agent"
    name = "My Agent"
    role = "Mengerjakan tugas tertentu"
    capabilities = ["custom_task"]
    version = "1.0.0"
    category = "custom"

    async def run(self, task):
        return {"agent": self.id, "value": "hasil", "task": task.description}
```

Contoh `manifest.json`:

```json
{
    "id": "my_agent",
    "name": "My Agent",
    "version": "1.0.0",
    "role": "Mengerjakan tugas tertentu",
    "capabilities": ["custom_task"],
    "model": null,
    "category": "custom",
    "enabled": true
}
```

Agent langsung dapat ditemukan oleh Discovery dan dipilih Planner berdasarkan
`capability`.

---

## Menjalankan Test

```bash
python -m pytest
```

Test mencakup: registri, discovery, task manager, dan test per-agent.

---

## PHASE 3 — COMMUNICATION SYSTEM

Fase ini menambahkan komunikasi antar-agent + event system.

```
Agent
 ↓
MessageBus
 ├── direct message    (send)
 ├── broadcast         (broadcast)
 └── request/reply     (request + handle_message, cocokkan via correlation_id)
```

```
Agent
 ↓
EventBus
 ├── task.*      (created, started, completed, failed)
 ├── agent.*     (discovered, registered, ready, failed, disabled)
 └── message.*   (sent, delivered, failed)
```

### Modul baru (`core/`)

| File | Isi |
| --- | --- |
| `message.py` | `Message`, `MessageType`, `MessageStatus`, errors |
| `message_bus.py` | `MessageBus` (send/broadcast/request/reply, inbox, bounded history) |
| `event.py` | `Event`, `EventType` (katalog nama event konsisten) |
| `event_bus.py` | `EventBus` (subscribe/emit, isolasi error subscriber) |

### Non-breaking perubahan core

- `AgentContext` + `message_bus`, `event_bus` (opsional, default-safe).
- `BaseAgent` + `send_message()`, `emit_event()`, `handle_message()` (default `None`).
- `AgentRegistry` / `AgentDiscovery` emit lifecycle events jika diberi `event_bus`.
- `TaskManager` emit event `task.*` saat eksekusi.

### Agent baru (total 9)

```
agents/
├── communication/communicator/   # communication, messaging, coordination
├── management/coordinator/       # coordination, task_coordination, agent_coordination
└── management/supervisor/        # supervision, monitoring, quality_control
```

Semua agent baru hanya memakai `AgentRegistry` + `MessageBus` — **tidak pernah
meng-import agent lain** (prinsip plugin).

### Prinsip

- Agent TIDAK berkomunikasi langsung (`researcher.coder.run(...)` dilarang).
- Semua lewat `MessageBus`; sistem hanya mengenal interface.
- `request` WAJIB punya timeout (bukan infinite wait) dan mencocokkan
  response lewat `correlation_id`.
- Satu subscriber event yang rusak tidak menghentikan subscriber lain
  (isolasi error).
- History message dibatasi (bounded, in-memory) — SQLite masuk Phase 6.

Contoh runnable: `python -m scripts.communication_demo`.

---

## Struktur Folder (Phase 3)

```
main.py
pyproject.toml
.env.example
.gitignore
core/
├── __init__.py
├── agent.py          # + AgentContext.llm_router/message_bus/event_bus, helpers
├── discovery.py      # + event_bus (agent.discovered)
├── factory.py
├── registry.py       # + event_bus (agent.registered/ready/disabled)
├── task.py
├── task_manager.py   # + event_bus (task events)
├── message.py        # Message, MessageType, MessageStatus, errors
├── message_bus.py    # MessageBus
├── event.py          # Event, EventType
└── event_bus.py      # EventBus
llm/
├── __init__.py
├── client.py         # ApiKeyManager + LLMClient
├── models.py         # LLMResponse + errors
├── router.py         # LLMRouter
├── utils.py          # parse_json_object
└── providers/
    ├── __init__.py
    ├── base.py       # BaseLLMProvider
    └── openrouter.py # OpenRouterProvider
config/
├── models.json
└── llm.json
agents/
├── research/researcher/    (Phase 1)
├── development/coder/      (Phase 1)
├── testing/tester/         (Phase 1)
├── review/reviewer/        (Phase 1)
├── analysis/analyst/       (Phase 2, LLM)
├── planning/planner/       (Phase 2, LLM)
├── communication/communicator/   (Phase 3)
├── management/coordinator/       (Phase 3)
└── management/supervisor/        (Phase 3)
tests/
├── __init__.py
├── conftest.py          (FakeLLMProvider, ResponderAgent, SlowAgent, ...)
├── test_registry.py  test_discovery.py  test_task_manager.py
├── test_llm_*.py        (models, api_keys, client, router, providers, agents)
├── test_message.py  test_event.py  test_event_bus.py
├── test_message_bus.py  test_agent_communication.py
├── test_communication_agents.py  test_task_events.py  test_lifecycle_events.py
scripts/
├── llm_demo.py
└── communication_demo.py
templates/
└── agent_template/
```

---

## Catatan

- Agent dikelompokkan dalam kategori: `research`, `development`, `testing`,
  `specialized`, dst.
- Planner memilih agent berdasarkan **capability + scoring**, bukan nama.
- Fase berikutnya (LLM, komunikasi, paralel, planning, memory, tools, dst.)
  akan menambah agent baru sambil mempertahankan agent lama.
