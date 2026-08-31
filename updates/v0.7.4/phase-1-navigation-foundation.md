# 0.7.4 Phase 1 — Advanced Navigation & Movement: Navigation Foundation

Phase 1 membangun satu navigation layer resmi untuk seluruh MineHive.

- `NavigationService` membuat NavigationSession runtime untuk setiap perpindahan, dengan lifecycle `CREATED`, `PLANNING`, `MOVING`, dan terminal `ARRIVED`, `FAILED`, `CANCELLED`, atau `TIMEOUT`.
- Target POSITION aktif dan target model BOT, PLAYER, BLOCK, serta ENTITY telah dinormalisasi untuk pengembangan fase berikutnya.
- Mode `FAST`, `SAFE`, dan `PRECISE` menyediakan policy tolerance, timeout, sprint, jump, dig, dan placement yang tervalidasi.
- Hanya satu NavigationSession aktif diizinkan per bot. Bot berbeda tetap dapat bergerak bersamaan.
- Arrival diverifikasi dari posisi runtime aktual; hasil pathfinder saja tidak cukup untuk menyatakan berhasil.
- Cancel dan timeout diteruskan sampai capability `minecraft.navigation-stop` di adapter agar pathfinder dihentikan dan lock dibersihkan.
- Event `navigation.requested`, `planning`, `started`, `arrived`, `failed`, `cancelled`, dan `timeout`, serta metrics navigation tersedia untuk observability.
- `goto` dan `come` pada command chat memakai NavigationService. API menyediakan status, move, dan cancel navigation.

Phase ini belum menambahkan stuck detector, replanning, terrain intelligence, safety map, group movement, atau path reservation. Fitur tersebut menjadi fondasi untuk Phase 2.
