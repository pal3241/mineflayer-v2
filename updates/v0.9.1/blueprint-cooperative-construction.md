# v0.9.1 — Blueprint & Cooperative Construction

MineHive v0.9.1 menambahkan modul building yang menyimpan Blueprint IR tervalidasi: blok, bounds, properties, material manifest, dan dependency dasar untuk blok yang memerlukan support.

Dashboard sekarang memiliki tab **Building** untuk mengatur safety policy, mengimpor blueprint JSON, memilih target, melihat preview layer, memberi approval, menjalankan, menjeda, melanjutkan, atau membatalkan proyek.

Eksekusi cooperative menggunakan status per blok, owner bot, retry terbatas, verifikasi block placement, dan state restart-safe (build aktif menjadi PAUSED setelah aplikasi restart). API v1 menawarkan `snapshot`, `deltas`, dan `revision`, sebagai kontrak stabil agar mod client v1.0.0 dapat menampilkan ghost schematic/progress tanpa menjadi otoritas build.

Format MineHive JSON didukung secara native. Format `.schem` dan `.litematic` ditandai sebagai decoder-adapter: mod client atau adapter eksternal dapat mengonversinya ke IR yang sama tanpa menduplikasi scheduler atau safety policy.
