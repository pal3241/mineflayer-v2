# Researcher

| Aspek | Nilai |
| --- | --- |
| **Name** | Researcher |
| **Role** | Mengumpulkan dan menganalisis informasi |
| **Capabilities** | `research`, `web_search`, `information_gathering` |
| **Required tools** | Tidak ada (Phase 1) |
| **Required model** | Tidak ada (Phase 1) — akan memakai research model di Phase 2 |
| **Category** | research |
| **Version** | 1.0.0 |

## Input

Task dengan `capability` yang mengandung `research` / `web_search` / `information_gathering`.

## Output

```json
{
    "agent": "researcher",
    "type": "research_report",
    "topic": "<deskripsi task>",
    "findings": ["..."]
}
```

## Contoh

```bash
python main.py run research "Pelajari framework asyncio"
```

## Limitations

- Belum terhubung ke LLM / web nyata (Phase 1).
- Output adalah struktur sederhana untuk integrasi pipeline.
