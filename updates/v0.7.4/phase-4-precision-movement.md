# 0.7.4 Phase 4 — Precision Movement

Phase 4 menambahkan tahap pendekatan akhir yang terpisah dari perjalanan jarak jauh.

- Mode `PRECISE` otomatis mengaktifkan final approach setelah navigasi utama selesai.
- Final approach mematikan sprint dan parkour, memakai tolerance presisi antara 0,05–1 blok, dan mencoba ulang secara terbatas.
- Posisi tidak langsung dianggap berhasil. Bot harus tetap berada di dalam tolerance selama beberapa sampel stabil berurutan.
- Pergerakan lebih dari 0,08 blok ketika stabilisasi menghasilkan `PRECISION_UNSTABLE`; kegagalan mencapai radius menghasilkan `PRECISION_POSITION_FAILED`.
- Alignment opsional dapat membuat bot menghadap koordinat tertentu setelah posisi stabil.
- Hasil final approach masuk ke diagnostics session, termasuk jarak akhir, jumlah sampel stabil, jumlah percobaan, alignment, dan status verifikasi.
- Event `navigation.precision.started` dan `navigation.precision.completed` serta metric `navigation.precision.success` tersedia untuk audit.
- Policy memvalidasi `exactTolerance`, `stableDurationMs`, `sampleIntervalMs`, `maxAttempts`, dan target facing sebelum bot bergerak.

Phase ini belum menambahkan formasi, collision avoidance antarbot, atau reservasi koridor. Fitur tersebut menjadi scope Phase 5.
