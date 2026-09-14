# v0.9.0 Phase 4 — Procedural & Strategic Knowledge

Phase ini menyimpan pola kerja yang dapat digunakan kembali tanpa memberi memory kemampuan mengeksekusi tindakan. Procedure dan strategy hanya menjadi konteks perencanaan; seluruh tindakan tetap melewati task, capability, validator, verification, dan approval yang berlaku.

## Procedural knowledge

- intent dan scope world/dimension;
- precondition deklaratif;
- langkah terurut beserta expected result dan verification hint;
- status `DRAFT`, `ACTIVE`, atau `DEPRECATED`;
- visibility `PRIVATE`, `TEAM`, `HIVE`, atau `SYSTEM`.

## Strategic knowledge

- recommendation dan kondisi yang perlu dihindari;
- synthesis deterministik setelah minimal tiga episode untuk action yang sama;
- evidence berisi episode ID, sample, success, dan failure;
- confidence diperbarui dari outcome terverifikasi menggunakan smoothing agar sample kecil tidak langsung dipercaya penuh.

## Keamanan dan lifecycle

- Optimistic version check mencegah revisi bersamaan menimpa pengetahuan terbaru.
- Deduplication key menjaga satu identitas knowledge dengan revision history melalui version counter.
- Retention terbatas mengarsipkan knowledge deprecated atau confidence rendah terlebih dahulu.
- Record aktif yang relevan diberikan ke NVIDIA NIM sebagai konteks, bukan sebagai perintah langsung.

## Konfigurasi

- `MINEHIVE_KNOWLEDGE_MAX_RECORDS`, default `5000`.
- `MINEHIVE_KNOWLEDGE_MINIMUM_EVIDENCE`, default `3`, minimum `2`.

## API

- `GET|POST /api/v1/memory/knowledge`
- `GET|PATCH /api/v1/memory/knowledge/:id`
- `POST /api/v1/memory/knowledge/:id/feedback`
- `POST /api/v1/memory/knowledge/synthesize`
