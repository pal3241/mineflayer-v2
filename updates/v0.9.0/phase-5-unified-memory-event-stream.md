# v0.9.0 Phase 5 — Unified Memory Event Stream

Phase ini menyatukan seluruh perubahan memory ke event log persisten. World, working, short/long semantic, episodic, dan procedural/strategic knowledge tetap memiliki storage masing-masing, tetapi perubahan lifecycle mereka sekarang dapat dibaca ulang dalam urutan global yang sama.

## Envelope dan urutan

- sequence global yang naik monotonik;
- event ID asli untuk deduplication;
- type, layer, source, timestamp, correlation ID, dan payload;
- schema version untuk evolusi format;
- SHA-256 hash dan previous hash untuk mendeteksi perubahan data historis.

Event non-memory tidak disimpan, dan event internal `memory.stream.*` dikecualikan agar tidak membentuk loop.

## Cakupan lifecycle

- world memory: remember/update dan forget;
- working memory: activate, update, release, TTL purge, restart purge, dan capacity purge;
- semantic memory: remember/update, promotion, expiration, retention, explicit forget, consolidation, dan policy update;
- episodic memory: record dan archive karena retention;
- knowledge: create, revise, feedback, synthesis result, dan archive karena retention.

## Replay dan checkpoint

Consumer dapat membaca event berdasarkan `afterSequence`, `beforeSequence`, type, layer, atau correlation ID. Checkpoint consumer hanya boleh bergerak maju sehingga restart tidak diam-diam mengulang state lama. Replay ditolak bila integrity check startup menemukan sequence gap, hash-chain rusak, atau payload berubah.

Retention menyimpan event terbaru hingga batas konfigurasi tanpa mengulang sequence. Record pertama yang tersisa mempertahankan previous hash sebagai anchor historis.

## Konfigurasi

- `MINEHIVE_MEMORY_EVENT_STREAM_MAX_RECORDS`, default `50000`, minimum `100`.

## API

- `GET /api/v1/memory/events`
- `GET /api/v1/memory/events/status`
- `POST /api/v1/memory/events/replay`
- `POST /api/v1/memory/events/checkpoints`
- `GET /api/v1/memory/events/checkpoints/:consumerId`

Memory event stream hanya menyediakan evidence dan sinkronisasi. Ia tidak menjalankan procedure, task, atau perintah Minecraft.
