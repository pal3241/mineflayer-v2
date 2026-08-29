# Identitas chest dan rename storage

Registrasi logistik kini menganggap kombinasi server, dimension, dan koordinat sebagai identitas permanen sebuah chest atau barrel. Percobaan mendaftarkan lokasi yang sama dengan nama lain ditolak dengan konflik yang menjelaskan nama storage dan koordinat yang sudah terdaftar. Proses registrasi juga diserialkan agar dua bot tidak dapat mendaftarkan chest yang sama secara bersamaan.

Nama storage dapat diubah secara eksplisit melalui tombol **Rename** pada tab **Logistics** atau endpoint `PATCH /api/v1/logistics/storages/:id` dengan body `{ "name": "nama baru" }`. Rename mempertahankan ID, posisi, inventory, dan histori storage serta tetap menolak nama duplikat dalam dunia dan dimension yang sama.

Sebelum sync atau transfer, bot memeriksa block storage pada koordinat registry. Jika block tidak ditemukan, pemeriksaan diulang sampai tiga kali. Registry baru dihapus setelah ketiga pemeriksaan memastikan chest atau barrel sudah tidak ada; setiap percobaan dan penghapusan dipublikasikan ke event logistik. Kegagalan pathfinder atau lock tidak dianggap sebagai bukti bahwa chest hilang. Reservation aktif yang menunjuk storage terhapus dipindahkan ke status `RECOVERY_REQUIRED` agar stok tidak dianggap aman secara keliru.
