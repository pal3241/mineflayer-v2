# 📘 Panduan Penggunaan — Modular Multi-Agent Team

Dokumen ini menjelaskan cara **memasukkan API key** dan **menggunakan sistem**.
Framework ini berbasis Python (>=3.10) dan memakai `httpx` untuk provider LLM.

---

## 1. Prasyarat

```bash
# Python 3.10+
python --version

# Install dependency (httpx untuk LLM)
python -m pip install "httpx>=0.27"
```

> Tidak ada file `requirements.txt` di repo ini; dependency dideklarasi di
> `pyproject.toml` (`httpx>=0.27`).

---

## 2. Cara Memasukkan API Key (OpenRouter)

API key **hanya** dibaca dari environment / file `.env`. Key TIDAK pernah
disimpan di kode, manifest, atau `config/models.json`.

### Opsi A — Lewat file `.env` (disarankan)

1. Salin template:
   ```bash
   cp .env.example .env
   ```
   (Di Windows PowerShell: `Copy-Item .env.example .env`)

2. Buka `.env` dan isi **satu atau lebih** key:
   ```env
   OPENROUTER_API_KEY_1=sk-or-v1-XXXXXXXXXXXXXXXXXXXXXXXX
   OPENROUTER_API_KEY_2=
   OPENROUTER_API_KEY_3=
   ```
   - Semakin banyak key, semakin baik: sistem melakukan **rotasi** dan
     **failover** otomatis jika satu key kena rate-limit.
   - `.env` sudah ada di `.gitignore` → **jangan pernah commit**.

3. Jalankan dari folder project (`d:\agent team`). Sistem otomatis membaca `.env`.

### Opsi B — Lewat environment variable

**Windows (PowerShell):**
```powershell
$env:OPENROUTER_API_KEY_1="sk-or-v1-XXXXXXXXXXXXXXXXXXXXXXXX"
$env:OPENROUTER_API_KEY_2="sk-or-v1-YYYYYYYYYYYYYYYYYYYYYYYY"
python main.py agents
```

**Linux / macOS (bash):**
```bash
export OPENROUTER_API_KEY_1="sk-or-v1-XXX"
export OPENROUTER_API_KEY_2="sk-or-v1-YYY"
python main.py agents
```

### Dapatkan key dari OpenRouter
1. Buat akun di <https://openrouter.ai>.
2. Buka **Keys** → **Create Key**.
3. Salin key berawalan `sk-or-v1-...` ke `.env`.

### Verifikasi key terbaca
Sistem tidak mencetak key (keamanan). Cara memastikan tersambung — jalankan
agent LLM (lihat bagian 4). Jika key salah / kosong akan muncul:
```
ERROR: OpenRouter API key tidak tersedia (periksa .env / environment)
```
atau error auth `HTTP 401`.

---

## 3. Model yang Dipakai (alias)

Agent memakai **alias**, bukan model ID provider. Konfigurasi ada di
`config/models.json`:

```json
{
    "research-model":  { "provider": "openrouter", "model": "meta-llama/llama-3.3-70b-instruct" },
    "coding-model":    { "provider": "openrouter", "model": "anthropic/claude-3.5-sonnet" },
    "reasoning-model": { "provider": "openrouter", "model": "openai/gpt-4o" }
}
```

Anda dapat mengganti baris `model` sesuai model favorit di OpenRouter.
Pengaturan lain (timeout, retry, provider default) ada di `config/llm.json`.

| Agent            | Model alias        |
|------------------|--------------------|
| researcher       | research-model     |
| coder / tester   | coding-model       |
| reviewer / analyst / planner | reasoning-model |

> Agent Phase 3 (communicator / coordinator / supervisor) tidak memakai LLM.

---

## 4. Cara Menjalankan

### 4a. Lihat daftar agent
```bash
python main.py agents
```
Contoh output (9 agent target + demo):
```
analyst        READY    analysis, reasoning, problem_analysis
communicator   READY    communication, messaging, coordination
coordinator    READY    coordination, task_coordination, agent_coordination
supervisor     READY    supervision, monitoring, quality_control
... (planner, researcher, reviewer, tester, coder ...)
```

### 4b. Jalankan task per capability

**Tanpa LLM (Phase 1) — tidak butuh API key:**
```bash
python main.py run research "Pelajari framework asyncio"
python main.py run coding "Buat fungsi rata-rata"
python main.py run testing "Uji modul kalkulator"
python main.py run review "Review solusi coder"
```

**Dengan LLM (Phase 2) — butuh API key di `.env`:**
```bash
python main.py run analysis "Analisis penyebab bug di modul auth"
python main.py run planning "Buat kalkulator Python"
```

**Komunikasi (Phase 3) — tidak butuh API key:**
```bash
python main.py run communication "Ringkas komunikasi saat ini"
python main.py run task_coordination "Buat kalkulator Python"
python main.py run supervision "Pantau kualitas sistem"
```

> Catatan: `run coordination` di-handle Communicator karena keduanya berbagi
> capabilitas `coordination`. Untuk menargetkan Coordinator gunakan
> `task_coordination` / `agent_coordination`.

---

## 5. Demo Script

Tanpa API key, Anda bisa mencoba alur LLM & komunikasi dengan provider palsu:

```bash
# LLM (FakeProvider)
python -m scripts.llm_demo

# Komunikasi (direct, broadcast, request/reply)
python -m scripts.communication_demo
```

---

## 6. Menjalankan Test

```bash
python -m pytest -q
```
Hasil hingga Phase 3: **121 passed**.

---

## 7. Menambah Agent Baru (tanpa ubah Core)

1. Salin template:
   ```
   templates/agent_template  ->  agents/custom/my_agent
   ```
2. Edit `agent.py` (id, role, capabilities, logika `run`).
3. Edit `manifest.json` (id, capabilities, enabled, model, dst).
4. Jalankan ulang — Agent Discovery otomatis mendaftarkannya.

Contoh agent yang memakai LLM cukup menambah `"model": "reasoning-model"` di
manifest, lalu di `run()` panggil `await self.llm([...])`.

---

## 8. Troubleshooting

| Gejala | Penyebab & Solusi |
| --- | --- |
| `OpenRouter API key tidak tersedia` | Belum isi `.env` / environment. Isi `OPENROUTER_API_KEY_1`. |
| `HTTP 401 AuthenticationError` | Key salah / kedaluwarsa. Buat key baru di OpenRouter. |
| `HTTP 429 RateLimitError` | Kena rate limit — tambahkan key ke-2/ke-3 untuk failover, atau perbesar `max_retries` di `config/llm.json`. |
| `ModelNotFoundError` | Model ID di `config/models.json` tidak tersedia di OpenRouter. |
| `RequestTimeoutError` (koordinasi) | Agent target tidak mengimplementasikan `handle_message`. |
| Agent LLM lambat | Perkecil `timeout_seconds` atau pakai model lebih cepat. |

---

## 9. Keamanan

- `.env` masuk `.gitignore` — **jangan commit**.
- Jangan pernah hard-code key di `agent.py`, `manifest.json`, atau `models.json`.
- Sistem tidak mencetak/menge-log key maupun header `Authorization`.
- Body error HTTP dipotong agar tidak membocorkan kredensial.

---

## 10. Referensi Struktur Penting

```
main.py                 # CLI
config/models.json      # alias model -> provider + model ID
config/llm.json         # default_provider, timeout, max_retries
.env.example            # template API key
GUIDE.md                # dokumen ini
README.md               # dokumentasi arsitektur per fase
tests/                  # seluruh test (121)
scripts/                # demo (llm_demo, communication_demo)
```
