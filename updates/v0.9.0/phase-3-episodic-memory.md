# v0.9.0 Phase 3 — Episodic Memory

Phase ini mengubah lifecycle runtime menjadi pengalaman terstruktur yang dapat dicari kembali dan dipakai sebagai konteks perencanaan. Memory tetap hanya sumber pengetahuan; eksekusi tetap melewati task, validator, dan capability layer.

## Episode otomatis

- hasil task: success, failure, atau cancelled;
- kematian bot beserta posisi, dimension, penyebab, inventory, dan status keep-inventory;
- hasil death recovery: success, partial, failed, atau skipped.

Setiap episode menyimpan bot, goal, action, outcome, lokasi, durasi, cause, lesson deterministik, evidence, timestamp, importance, schema version, dan embedding. Deduplication key mencegah event lifecycle ganda menghasilkan pengalaman duplikat.

## Retrieval dan retention

- Ranking menggabungkan kemiripan teks, importance, dan recency.
- Filter tersedia untuk bot, world, dimension, episode type, dan outcome.
- Episode yang tidak memiliki scope world/dimension tetap dapat menjadi pengalaman umum untuk bot terkait.
- Kapasitas dibatasi oleh `MINEHIVE_EPISODIC_MEMORY_MAX_RECORDS`; episode terlemah diarsipkan melalui Memory Governance sebelum dikeluarkan.
- Lesson episode relevan ikut masuk ke konteks NVIDIA NIM/koordinator.

## API

- `GET /api/v1/memory/episodic`
- `POST /api/v1/memory/episodic`
- `GET /api/v1/memory/episodic/:id`
