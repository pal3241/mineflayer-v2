# v0.8.0 Phase 4 — Expansion Proposal & Deterministic Validation

Phase ini menambahkan alur proposal ekspansi territory yang aman. Proposal boleh berasal dari LLM, operator, atau sistem, tetapi sumber proposal tidak pernah menjadi sumber kebenaran untuk keputusan akhir.

## Perilaku baru

- Proposal dinormalisasi ke arah, jarak, prioritas, target resource, kebutuhan outpost/warehouse, dan origin yang tervalidasi.
- Validator deterministik selalu memeriksa resource, food, bot, guard, route, danger, kapasitas warehouse, biaya, dan batas ukuran.
- Semua kegagalan dikembalikan sekaligus sebagai blocker yang memiliki kode stabil.
- Ekspansi aman berukuran kecil menjadi `APPROVED`; ekspansi besar menjadi `APPROVAL_REQUIRED` dan membutuhkan identitas pemberi persetujuan.
- Proposal yang ditolak dapat divalidasi ulang dengan kondisi terbaru.
- Hanya proposal `APPROVED` yang dapat diterapkan, dan penerapan hanya boleh terjadi sekali.
- Penerapan membuat region `FRONTIER` atau `OUTPOST` secara asimetris sesuai arah proposal.
- Riwayat proposal, hasil pemeriksaan, approval, versi, dan region hasil disimpan secara persisten.

## API baru

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/territory/expansions/status` | Ringkasan proposal dan status keputusan. |
| `GET` | `/api/v1/territory/expansions` | Daftar proposal, dengan filter `status` dan `source`. |
| `POST` | `/api/v1/territory/expansions` | Membuat dan langsung memvalidasi proposal. |
| `GET` | `/api/v1/territory/expansions/:id` | Membaca proposal dan audit validasinya. |
| `POST` | `/api/v1/territory/expansions/:id/revalidate` | Memvalidasi ulang memakai context terbaru. |
| `POST` | `/api/v1/territory/expansions/:id/approve` | Memberi persetujuan manusia untuk ekspansi besar. |
| `POST` | `/api/v1/territory/expansions/:id/apply` | Menerapkan proposal yang telah disetujui. |
| `POST` | `/api/v1/territory/expansions/:id/cancel` | Membatalkan proposal yang belum diterapkan. |

## Batas scope

Phase ini membangun proposal, validasi, approval, dan pembentukan region. Pemilihan storage berbasis risiko, pertahanan territory, emergency system, degraded mode, dan resilience menjadi scope Phase 5.
