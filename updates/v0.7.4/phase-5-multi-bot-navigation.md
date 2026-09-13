# 0.7.4 Phase 5 — Multi-Bot Navigation

Phase 5 menutup v0.7.4 dengan koordinasi perpindahan beberapa bot menuju formasi yang deterministik.

- Formation planner menerima 2–32 bot dan menghasilkan target terpisah untuk formasi `LINE`, `COLUMN`, `WEDGE`, atau `GRID` dengan jarak 1–16 blok.
- `moveGroup()` menjalankan semua NavigationSession secara konkuren dengan satu identitas group dan tetap memakai validasi, terrain safety, stuck recovery, scaffolding opt-in, serta precision movement masing-masing bot.
- Corridor planner merasterisasi rute setiap anggota dan menempatkan rute yang berpotongan ke wave berbeda; rute aman tetap berjalan paralel sehingga anti-collision tidak menserialkan seluruh grup.
- Satu bot tidak dapat masuk group baru ketika masih memiliki session aktif.
- Eksekusi bersifat fail-fast: kegagalan satu anggota membatalkan anggota lain melalui shared abort signal dan group berakhir atomik sebagai `FAILED`.
- Status navigation sekarang menyertakan group aktif dan histori group terbaru beserta hasil per bot.
- Event `navigation.group.started`, `navigation.group.arrived`, dan `navigation.group.failed` serta metric request/success/failure tersedia untuk observability.
- Endpoint `POST /api/v1/navigation/group/move` membuka fitur yang sama melalui control API.

Reservasi koridor Phase 5 mencegah anggota grup memasuki sel rute yang sama secara bersamaan. Replanning collision avoidance dinamis terhadap entitas di luar grup tetap menjadi hardening lanjutan.
