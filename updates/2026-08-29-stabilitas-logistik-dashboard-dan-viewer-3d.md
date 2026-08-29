# Stabilitas logistik, dashboard, dan viewer 3D

Tanggal: 2026-08-29

## Perbaikan logistik

- Verifikasi deposit dan withdrawal tidak lagi membaca chest tepat setelah request transfer selesai.
- Adapter membaca inventory pemain dari window chest aktif karena Mineflayer baru menyalin slot tersebut kembali ke `bot.inventory` ketika window ditutup.
- Adapter menunggu sinkronisasi slot pemain dan slot chest dari server sampai lima detik.
- Transfer hanya berhasil ketika jumlah bot dan chest sama-sama mencapai nilai yang diharapkan.
- Error timeout menyertakan jumlah expected dan observed agar masalah server dapat didiagnosis.
- Pengujian storage mensimulasikan update slot yang terlambat dan memastikan transfer tetap terverifikasi.

## Perbaikan dashboard

- Polling tidak lagi menimpa draft model, endpoint, atau OpenRouter key yang sedang diketik.
- OpenRouter key tetap dikosongkan setelah penyimpanan berhasil agar secret tidak ditampilkan kembali.
- Inventory pada dialog **Edit & inventory** diperbarui setiap snapshot tanpa menimpa field konfigurasi bot.
- Target command tetap dipertahankan saat daftar bot diperbarui.

## Viewer 3D

- Setiap bot menyediakan pilihan **First person** dan **3D area**.
- Mode 3D memakai `prismarine-viewer` dengan `firstPerson: false` agar chunk serta daerah sekitar bot dapat dilihat menggunakan kamera bebas.
- Mode aktif dan informasi kompatibilitas renderer ditampilkan pada kartu viewer.
- Port viewer tetap dialokasikan secara independen untuk setiap bot.

## LLM

- Batas output OpenRouter dan LLM lokal diturunkan dari 10 menjadi 5 token.
- Status settings melaporkan `maxTokens: 5`.
