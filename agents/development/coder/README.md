# Coder

| Aspek | Nilai |
| --- | --- |
| **Name** | Coder |
| **Role** | Menulis kode program |
| **Capabilities** | `coding`, `python`, `debugging` |
| **Required tools** | Tidak ada (Phase 1) |
| **Required model** | Tidak ada (Phase 1) — akan memakai coding model di Phase 2 |
| **Category** | development |
| **Version** | 1.0.0 |

## Input

Task dengan `capability` `coding` / `python` / `debugging`.

## Output

```json
{
    "agent": "coder",
    "type": "code",
    "requirement": "<deskripsi task>",
    "language": "python",
    "code": "# Implementasi untuk: ..."
}
```

## Contoh

```bash
python main.py run coding "Buat fungsi menghitung rata-rata"
```

## Limitations

- Belum menghasilkan kode nyata via LLM (Phase 1).
- Hanya menyiapkan kontrak hasil untuk pipeline.
