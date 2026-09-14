# v0.9.0 Phase 1 — Short & Long-Term Memory Hardening

Phase ini memperkuat short-term dan long-term memory yang sudah ada sebagai fondasi Unified Hive Shared Memory. Tidak ada format memory baru yang diwajibkan untuk pemanggil lama.

## Implementasi

- Startup scan memvalidasi semua semantic memory sebelum runtime aktif.
- Record lama yang masih dapat dipulihkan dimigrasikan ke schema version 1 dan embedding yang hilang atau tidak kompatibel dibuat ulang.
- Record yang tidak dapat dipulihkan dipindahkan ke quarantine bersama alasan dan snapshot aslinya.
- Short-term memory yang sudah kedaluwarsa dibersihkan saat startup.
- Retention long-term sekarang bounded melalui `longTermMaxRecords`; record dengan prioritas terendah dipindahkan ke archive sebelum dihapus dari active memory.
- Lifecycle create, update, promotion, expiration, archive, migration, quarantine, dan explicit forget dicatat di audit repository.
- Scan bersifat idempotent sehingga restart tidak menggandakan migrasi.

## Konfigurasi

- `MINEHIVE_LONG_MEMORY_MAX_RECORDS` — batas active long-term memory, default mengikuti `MINEHIVE_MEMORY_MAX_RECORDS`.

## API observability

- `GET /api/v1/memory/governance/status`
- `POST /api/v1/memory/governance/scan`
- `GET /api/v1/memory/audit?limit=100`
- `GET /api/v1/memory/quarantine?limit=100`
- `GET /api/v1/memory/archive?limit=100`

Semua hasil daftar dibatasi antara 1 dan 500 record per permintaan.

## Verifikasi

Tes otomatis mencakup migrasi dan restart idempotent, quarantine record korup, pembersihan TTL, bounded long-term archive, serta audit lifecycle.
