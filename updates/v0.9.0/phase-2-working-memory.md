# v0.9.0 Phase 2 — Working Memory

Phase ini menambahkan ruang kerja sangat sementara untuk task yang sedang aktif. Working memory menyimpan konteks operasional, tetapi tidak mengeksekusi tindakan dan tidak menggantikan HiveMind lock maupun deterministic validator.

## Isi workspace

- action dan target saat ini;
- progress terstruktur;
- snapshot inventory dan cargo sementara;
- route aktif;
- control lease sebagai referensi;
- checkpoint dan metadata task.

Setiap record diisolasi berdasarkan `taskId` dan `botId`, memiliki schema version, TTL, version counter, batas ukuran 64 KiB, serta kapasitas global terbatas.

## Lifecycle otomatis

- `task.started` membuka workspace.
- `task.retrying` mencatat retry dan error terakhir.
- `task.completed`, `task.failed`, `task.cancelled`, dan `task.collaborative` melepas workspace.
- Startup menghapus semua workspace lama sebagai `restart-stale`, sehingga state aktif palsu tidak hidup kembali setelah crash atau restart.
- TTL dan capacity eviction memberikan cleanup tambahan.
- Semua aktivasi, update, release, dan purge masuk ke audit memory governance Phase 1.

## Konfigurasi

- `MINEHIVE_WORKING_MEMORY_MAX_RECORDS`, default `1000`.
- `MINEHIVE_WORKING_MEMORY_TTL_MS`, default `1800000` (30 menit).

## API

- `GET|POST /api/v1/memory/working`
- `GET|PATCH|DELETE /api/v1/memory/working/:taskId`

Endpoint daftar mendukung filter `botId`, `goalId`, dan `limit`.
