# Analyst

| Aspek | Nilai |
| --- | --- |
| **Name** | Analyst |
| **Role** | Menganalisis masalah dan tugas secara terstruktur |
| **Capabilities** | `analysis`, `reasoning`, `problem_analysis` |
| **Required tools** | Tidak ada |
| **Required model** | `reasoning-model` |
| **Category** | specialized |
| **Version** | 1.0.0 |

## Input

Task dengan `capability` `analysis` / `reasoning` / `problem_analysis`.

## Output

```json
{
    "type": "analysis",
    "task": "<deskripsi task>",
    "summary": "...",
    "issues": [{"title": "...", "severity": "...", "detail": "..."}],
    "recommendation": "...",
    "model": "<model yang dipakai>"
}
```

Output divalidasi; jika LLM mengembalikan struktur invalid, muncul
`InvalidResponseError` yang jelas (bukan crash mentah).

## Contoh

```bash
python main.py run analysis "Analisis penyebab bug di modul auth"
```

## Limitations

- Bergantung pada LLM router; jika tidak ada router / model, gagal dengan
  error yang jelas.
- Belum membuat rencana task (itu tugas Planner).
