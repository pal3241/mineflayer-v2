# Tester

| Aspek | Nilai |
| --- | --- |
| **Name** | Tester |
| **Role** | Membuat dan menjalankan pengujian |
| **Capabilities** | `testing`, `test_automation`, `qa` |
| **Required tools** | Tidak ada (Phase 1) |
| **Required model** | Tidak ada (Phase 1) |
| **Category** | testing |
| **Version** | 1.0.0 |

## Input

Task dengan `capability` `testing` / `test_automation` / `qa`.

## Output

```json
{
    "agent": "tester",
    "type": "test_plan",
    "target": "<deskripsi task>",
    "test_cases": [{"name": "Unit test", "status": "passed"}]
}
```

## Contoh

```bash
python main.py run testing "Uji modul kalkulator"
```

## Limitations

- Belum menjalankan test suite nyata (Phase 1).
- Output berupa rencana/status pengujian sederhana.
