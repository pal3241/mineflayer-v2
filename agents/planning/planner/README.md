# Planner

| Aspek | Nilai |
| --- | --- |
| **Name** | Planner |
| **Role** | Membuat rencana task sederhana |
| **Capabilities** | `planning`, `task_planning`, `decomposition` |
| **Required tools** | Tidak ada |
| **Required model** | `reasoning-model` |
| **Category** | manager |
| **Version** | 1.0.0 |

## Input

Task dengan `capability` `planning` / `task_planning` / `decomposition`.

## Output

```json
{
    "type": "task_plan",
    "goal": "<tujuan keseluruhan>",
    "tasks": [
        {"title": "<nama task>", "capability": "<capability>"}
    ],
    "model": "<model yang dipakai>"
}
```

Output divalidasi (field wajib + jenis). Phase 2 hanya menghasilkan *simple
task plan* — TaskGraph/DAG akan datang di Phase 5.

## Contoh

```bash
python main.py run planning "Buat kalkulator Python"
```

## Limitations

- Bergantung pada LLM router; gagal dengan error jelas bila tidak tersedia.
- Tidak membuat DAG / dependency antar task (Phase 5).
