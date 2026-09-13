# 0.7.4 Phase 3 — Terrain & Safety Navigation

Phase 3 membuat pemilihan rute MineHive sadar terhadap bahaya terrain, bukan hanya kemampuan Pathfinder mencapai koordinat.

- Setiap target diperiksa sebelum pathfinder berjalan. Target dengan bahaya yang dilarang ditolak menggunakan kode `TERRAIN_UNSAFE` tanpa menggerakkan bot.
- Analyzer membedakan lava, api, campfire, cactus, magma block, sweet berry bush, powder snow, dan jurang yang melebihi batas jatuh.
- `NavigationMovements` memeriksa kaki, kepala, blok pijakan, dan empat blok sekitar untuk setiap kandidat langkah. Kandidat tidak aman tidak dimasukkan ke graph rute.
- Hostile mob standar ditambahkan ke `entitiesToAvoid` milik Pathfinder ketika perlindungan hostile aktif.
- Policy keselamatan bersifat eksplisit dan tervalidasi: toggle per bahaya, batas jatuh, radius hostile, minimum health, dan minimum food.
- Preset serta override bot menyimpan grup `safety` melalui navigation settings repository dan mengeksposnya melalui API settings yang sama.
- Hasil terrain masuk ke diagnostics session. Event `navigation.terrain.analyzed` dan `navigation.terrain.rejected`, beserta metric accepted/rejected, membuat keputusan rute dapat diaudit.

Phase ini belum mencakup precision landing, elytra, kendaraan, koordinasi formasi, atau reservasi koridor antarbot. Fitur tersebut tetap menjadi scope Phase 4 dan Phase 5.
