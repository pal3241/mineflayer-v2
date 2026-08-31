# 0.7.4 Phase 2 — Stuck Recovery & Safe Scaffolding

Phase 2 menambahkan batas aman untuk navigasi yang gagal bergerak dan konfigurasi scaffolding yang eksplisit.

- Movement monitor mengambil snapshot posisi dengan interval terbatas, mengenali perpindahan atau pengurangan jarak yang bermakna, dan meminta beberapa sampel konfirmasi sebelum menyatakan bot stuck.
- Navigasi yang benar-benar stuck masuk lifecycle `STUCK_SUSPECTED`, `STUCK`, `RECOVERING`, dan `REPLANNING`. Recovery menghentikan path aktif, membuat rute baru ke target yang sama, serta dibatasi oleh `maxRecoveryAttempts` dan `maxReplans` tanpa mengubah timeout global.
- Semua mode navigasi tetap menonaktifkan placement, scaffolding, tower, dan bridge secara default. Tower atau bridge hanya dapat aktif bersama `allowPlace` dan `allowScaffolding` yang eksplisit.
- Movement policy factory menerapkan konfigurasi yang sama pada Pathfinder dan CollectBlock: tidak ada tower otomatis, tidak ada parkour, dan daftar scaffold tidak pernah berasal dari seluruh inventori.
- Scaffold memakai lease resource quantity-aware. Hanya item dari `scaffoldPreference` yang tidak sedang di-lease dapat dipilih; lease dilepas pada terminal cleanup.
- Event `navigation.progress`, `navigation.stuck.suspected`, `navigation.stuck.detected`, `navigation.recovery.started`, dan event replanning membuat recovery dapat diaudit dari event stream. Diagnostics navigation menyimpan status movement, recovery, dan lease scaffold.

Regresi menguji tower/bridge opt-in, perlindungan kuantitas resource dari lease bersamaan, deteksi stuck yang dikonfirmasi lalu replan berhasil, serta pelepasan lease setelah navigasi selesai.
