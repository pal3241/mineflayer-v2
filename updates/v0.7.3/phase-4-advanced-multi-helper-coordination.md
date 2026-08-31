# 0.7.3 Phase 4 — Helping: Advanced Multi-Helper Coordination

Phase 4 menyelesaikan v0.7.3 Helping dengan koordinasi adaptif yang tetap manual dan deterministik.

- Coordination Monitor mengevaluasi HelpSession aktif melalui event progress dan rekonsiliasi berkala lima detik.
- Worker state menormalisasi status, kapasitas inventory, konektivitas, kelayakan tool, sisa assignment, dan laju progress tanpa membocorkan objek Mineflayer.
- Alokasi berbobot memprioritaskan helper yang siap, berkapasitas, memiliki tool sesuai, dan menunjukkan produktivitas lebih baik; alokasi tidak melebihi kapasitas slot inventory.
- Rebalance membuat WorkShare generation baru, mencatat relasi supersession dan alasan alokasi, serta tidak memodifikasi share lama secara destruktif.
- Work stealing memindahkan hanya assignment yang belum selesai kepada helper yang telah idle.
- Pause/resume menghentikan assignment baru, melakukan handoff output yang masih tertunda, dan melanjutkan dengan generation baru setelah validasi ulang.
- Rebalance memakai lock per HelpSession, cooldown, batas jumlah rebalance, dan `rebalanceKey` idempoten untuk mencegah thrashing atau generation ganda.
- Kehilangan helper membatalkan pekerjaan aktif, mempertahankan output yang belum terverifikasi untuk rekonsiliasi, lalu mendistribusikan sisa kerja hanya kepada worker yang tersedia.
- Event dan metrics koordinasi mencakup worker state, rebalance, work stealing, pause/resume, helper loss, dan generation share.

API menambahkan snapshot worker serta endpoint rebalance, work steal, pause, dan resume. Command game menambahkan `pause help` dan `resume help`.

Pengujian mencakup weighted splitting, capacity limit, rebalance idempoten, work stealing, dan pause/resume; seluruh perilaku helping Phase 2–3 tetap diuji sebagai regresi.
