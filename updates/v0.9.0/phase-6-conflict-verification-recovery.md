# v0.9.0 Phase 6 — Conflict, Verification & Recovery

Phase penutup v0.9.0 menambahkan authoritative claim registry di atas semua lapisan memory. Informasi baru tidak langsung menghapus klaim lama: setiap sumber memiliki kandidat sendiri, lalu resolver deterministik memilih klaim yang paling dapat dipercaya.

## Conflict resolution

Peringkat kandidat menggunakan:

- timestamp dan observation freshness;
- confidence;
- direct observation;
- source reliability;
- confirmation count.

Kandidat pemenang berstatus `AUTHORITATIVE`; kandidat valid lain menjadi `SUPERSEDED`. Setiap keputusan menyimpan kandidat, score, faktor penilaian, waktu, dan winner sehingga dapat diaudit. Update dari sumber yang sama memakai identitas kandidat serta version counter yang sama.

## Verification

- Direct observation dengan confidence memadai dapat diverifikasi otomatis.
- Klaim tidak langsung memerlukan confirmation count minimum atau verifier eksplisit.
- Visibility `SYSTEM` lebih ketat: auto-verification memerlukan direct observation sekaligus beberapa konfirmasi.
- Penolakan menyimpan verifier dan evidence lalu membuka recovery record.
- World memory dan procedural/strategic knowledge otomatis diteruskan sebagai candidate; semantic memory dapat ikut dengan `metadata.claimKey`.

## Visibility dan LLM context

- `PRIVATE` hanya terlihat oleh owner bot.
- `TEAM` hanya terlihat oleh team yang sama.
- `HIVE` dan `SYSTEM` tersedia bagi hive setelah authoritative.
- Context planner dibatasi maksimal lima memory dan 2500 karakter.

NVIDIA NIM hanya menerima hasil retrieval sebagai evidence perencanaan. Memory tidak mengeksekusi procedure, task, atau aksi Minecraft.

## Recovery

Record rusak saat startup diarsipkan dan dipindahkan ke recovery queue. Kandidat yang gagal verifikasi juga masuk queue. Koreksi berjalan dengan retry budget deterministik; keberhasilan menghasilkan candidate baru, sedangkan budget yang habis menjadi `DEAD_LETTER` tanpa loop tanpa batas.

## Konfigurasi

- `MINEHIVE_MEMORY_MINIMUM_CONFIDENCE`, default `0.7`.
- `MINEHIVE_MEMORY_MINIMUM_CONFIRMATIONS`, default `2`.
- `MINEHIVE_MEMORY_MAX_RECOVERY_ATTEMPTS`, default `3`, maksimum `10`.

## API

- `GET /api/v1/memory/integrity/status`
- `GET|POST /api/v1/memory/integrity/candidates`
- `POST /api/v1/memory/integrity/candidates/:id/verify`
- `POST /api/v1/memory/integrity/resolve`
- `GET /api/v1/memory/integrity/context`
- `GET /api/v1/memory/integrity/decisions`
- `GET /api/v1/memory/integrity/recovery`
- `POST /api/v1/memory/integrity/recovery/:id/retry`
