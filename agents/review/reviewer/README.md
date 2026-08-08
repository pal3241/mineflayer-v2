# Reviewer

| Aspek | Nilai |
| --- | --- |
| **Name** | Reviewer |
| **Role** | Meninjau hasil kerja agent lain |
| **Capabilities** | `review`, `code_review`, `quality` |
| **Required tools** | Tidak ada (Phase 1) |
| **Required model** | Tidak ada (Phase 1) — akan memakai reasoning model di Phase 2 |
| **Category** | specialized |
| **Version** | 1.0.0 |

## Input

Task dengan `capability` `review` / `code_review` / `quality`.

## Output

```json
{
    "agent": "reviewer",
    "type": "review",
    "subject": "<deskripsi task>",
    "verdict": "PASS",
    "notes": "..."
}
```

## Contoh

```bash
python main.py run review "Review solusi yang dihasilkan coder"
```

## Limitations

- Belum melakukan review nyata (Phase 1).
- Verdict selalu `PASS` pada implementasi dasar.
