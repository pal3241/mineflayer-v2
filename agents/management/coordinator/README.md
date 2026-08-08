# Coordinator

| Aspek | Nilai |
| --- | --- |
| **Name** | Coordinator |
| **Role** | Mengkoordinasikan task ke agent yang relevan via MessageBus |
| **Capabilities** | `coordination`, `task_coordination`, `agent_coordination` |
| **Required tools** | Tidak ada |
| **Required model** | Tidak ada |
| **Category** | manager |
| **Version** | 1.0.0 |

## Input

Task dengan `capability` `coordination`. Daftar capability subtask bisa
diberikan lewat `task.input_data["capabilities"]` (default `["research", "coding"]`).

## Output

```json
{
    "type": "coordination_report",
    "task": "<deskripsi>",
    "results": {
        "<capability>": {"agent": "<id>", "status": "ok", "answer": "..."}
    }
}
```

## Contoh

```bash
python main.py run coordination "Buat kalkulator Python"
```

## Detail

- Menemukan agent via `AgentRegistry.find_by_capability` (bukan nama).
- Mengirim `request` melalui `MessageBus` dan menggabungkan hasil.
- Tidak pernah meng-import agent tertentu.

## Limitations

- Satu subtask satu request yang diproses berurutan (belum paralel).
