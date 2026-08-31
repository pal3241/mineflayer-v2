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

Hardening penutup Phase 4 menambahkan eksekusi WorkShare paralel tanpa menahan lock selama capability berjalan, cancel aktif untuk helper `RUNNING`, dan batch collection maksimum 64 item yang dapat dilanjutkan dari status `PARTIAL`. Snapshot inventory sekarang menyediakan `inventorySlotsUsed`, `inventorySlotsFree`, serta `freeItemCapacity` dari slot Minecraft nyata termasuk stack parsial. Stall monitor memakai `progressStallThresholdMs`, tool suitability memeriksa kategori serta tier tool dari inventory, dan parent completion saat rebalance mencapai target selalu memakai lifecycle resmi GoalService.

Finalisasi menggunakan kapasitas khusus item target: hanya slot kosong dan ruang tersisa pada stack item target yang dapat dipakai untuk assignment. Recovery worker stalled kini membatalkan executor, menunggu pelepasan task, merekonsiliasi delta inventory yang sudah terkumpul, lalu hanya me-rebalance pekerjaan yang belum selesai. Monitor mengisolasi kegagalan setiap session sebagai event `help.rebalance.failed`. Requirement tool mengambil `harvestTools` dari registry Minecraft saat tersedia, dengan aturan tier deterministik sebagai fallback.

Penutupan Phase 4 menambahkan heartbeat inventori runtime untuk setiap WorkShare `RUNNING`. Timestamp `batchStartedAt`, `lastProgressAt`, dan `lastObservedCount` selalu dimulai ulang pada setiap batch, lalu heartbeat hanya memperbarui observasi ketika jumlah item target bertambah. Worker baru dianggap stalled apabila task executor masih aktif, inventori tidak bertambah, dan ambang `progressStallThresholdMs` terlewati. Recovery membatalkan task, merekonsiliasi output, melakukan handoff serta credit terverifikasi bila tujuan tersedia, kemudian me-rebalance hanya pekerjaan yang tersisa. Kegagalan heartbeat maupun recovery diisolasi sebagai event `help.rebalance.failed`.

Status v0.7.3 — Helping: **COMPLETE**. Regresi mencakup batch progres panjang, reset heartbeat, stall nyata, handoff output worker stalled, anti-duplikasi contribution, dan isolasi error monitor.
