# 0.8.0 Phase 3 — Exploration & Scout Assignment

Phase 3 menambahkan exploration pipeline deterministik di atas Territory Map.

- Frontier generator membuat delapan kandidat arah mata angin di sekitar origin tanpa menduplikasi region yang sudah ada.
- Planner hanya memilih Frontier yang belum dieksplorasi dan berada dalam batas jarak request.
- Candidate scoring menggabungkan jarak serta Danger Zone yang menutupi target; lokasi berbahaya memperoleh penalti hingga 60 poin.
- Scout assignment memeriksa status runtime, server, dimension, posisi, mission aktif, health, food, jarak, dan class `scout`.
- Tie-break selalu memakai jarak lalu bot ID sehingga keputusan dapat direproduksi.
- ExplorationMission persisten memiliki lifecycle `ASSIGNED`, `RUNNING`, `COMPLETED`, `FAILED`, dan `CANCELLED`.
- Executor menggunakan NavigationService, menjalankan survey melalui adapter boundary, meneruskan discovery ke shared memory dan Territory Intelligence, lalu menandai Frontier explored.
- Mission `RUNNING` yang ditemukan setelah restart direkonsiliasi menjadi `FAILED` dengan kode `INTERRUPTED_BY_RESTART`, sehingga scout tidak terkunci selamanya.
- Event, health, status, filter mission, endpoint seed/plan/execute/cancel, dan failure diagnostics tersedia untuk audit.

Phase berikutnya akan menerima proposal ekspansi strategis tetapi tetap mewajibkan deterministic validator sebelum perubahan territory dilakukan.
