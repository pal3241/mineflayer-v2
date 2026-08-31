# 0.7.3 Phase 3 — Helping: Manual Helping

Phase 3 menyelesaikan manual helping agar helper dapat bergabung, keluar, dan menyerahkan hasil kerja dengan aman pada parent task yang sedang berjalan.

- Collaborative takeover menghentikan executor parent terlebih dahulu sebelum task berubah menjadi `COLLABORATIVE`.
- Cancellation khusus takeover tidak membatalkan HelpSession yang baru dibuat.
- Resolver hanya memilih task aktif yang benar-benar mendukung helping, lalu mengurutkan status, prioritas, dan usia task.
- `addHelpers` dan `joinMany` memakai serialisasi per owner/session, validasi duplicate helper, batas helper, serta `minimumChunk` yang selalu dihitung dari preview terbaru.
- First join memakai authoritative progress dari output policy, sehingga kerja tambahan tidak dibuat bila target hampir selesai.
- `stop help` dan remove helper otomatis menghentikan pekerjaan baru, melakukan handoff output yang belum terkirim, memverifikasi credit, lalu mengeluarkan helper.
- Helper hanya boleh berstatus `READY` atau `ACTIVE`; bot yang sedang recovery, emergency, critical combat, atau user-critical task ditolak.
- HelpSession dibatalkan kembali bila collaborative takeover parent gagal, agar tidak ada session aktif tanpa parent task kolaboratif.

Pengujian mencakup takeover parent yang sedang berjalan, race cancellation, pemilihan task helpable, batas multi-helper, remaining aktual saat first join, auto handoff, busy helper, serta join command secara bersamaan. CI GitHub Actions menjalankan `npm test` pada push dan pull request.
