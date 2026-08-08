# Supervisor

| Aspek | Nilai |
| --- | --- |
| **Name** | Supervisor |
| **Role** | Memantau agent/task, mendeteksi failure, dan meminta retry |
| **Capabilities** | `supervision`, `monitoring`, `quality_control` |
| **Required tools** | Tidak ada |
| **Required model** | Tidak ada |
| **Category** | manager |
| **Version** | 1.0.0 |

## Input

Task dengan `capability` `supervision`. Opsional `task.input_data`:
- `agent_id` — agent yang dipantau
- `capability` / `retry_task` / `retry_input` — konfigurasi task retry

## Output

```json
{
    "type": "supervisor_report",
    "actions": [{"type": "retry", "agent": "...", "success": true}],
    "agents": {"<id>": {"status": "READY", "success_rate": 1.0, "load": 0}}
}
```

## Contoh

```bash
python main.py run supervision "Pantau kualitas sistem"
```

## Detail

- Memantau health semua agent di Registry.
- Jika agent target `FAILED` atau punya `tasks_failed`, meminta retry melalui
  `TaskManager` (generic — tidak meng-import agent tertentu).
- Belum melakukan self-replanning (Phase 10).

## Limitations

- Retry masih satu langkah sederhana; belum ada dynamic team/replanning.
