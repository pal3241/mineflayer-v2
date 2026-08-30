# 0.7.3 Phase 1 — Helping: Survival Capability Completion

Release `0.7.3 Phase 1` melengkapi primitive survival yang dibutuhkan Helping Core. Semua interaksi dunia tetap melewati adapter Mineflayer, didaftarkan sebagai capability, dapat dijalankan melalui TaskExecutor, dan memverifikasi perubahan state atau inventory.

## Capability

- Generic equip, unequip, use-item, entity search, entity interaction, dan block interaction.
- Evaluasi serta auto-equip armor dengan perlindungan downgrade, batas durability, dan penolakan Curse of Binding secara default.
- Pencarian serta shearing sheep dengan verifikasi delta wool tanpa membunuh hewan.
- Pencarian serta milking cow dengan verifikasi perubahan bucket menjadi milk bucket.
- Pencarian bed, validasi dimension/waktu/occupancy, sleep, wake, dan status lifecycle.
- Open/close wooden serta supported copper door dan trapdoor dengan state verification dan cooldown. Pathfinder membuka wooden/copper door yang menghalangi rute lalu melanjutkan navigation. Iron door dan iron trapdoor ditolak karena membutuhkan mekanisme redstone.

## Acquisition dan task queue

Acquisition `0.7.2` memiliki registry special source. Item wool diarahkan ke source `sheep-wool` dengan dependency `shears`, sedangkan `milk_bucket` diarahkan ke `cow-milk` dengan dependency `bucket`. Dependency tetap diselesaikan melalui urutan inventory, storage, fleet, craft, smelt, atau collect. Eksekusi source menggunakan capability `minecraft.acquire-wool` atau `minecraft.acquire-milk`, sehingga task runner dan cancellation context tetap menjadi jalur operasional utama.

## Policy

Policy survival mengatur auto armor, durability minimum, prioritas protection/durability, cursed armor, animal-kill policy, minimum animal reserve, cooldown interaction, dan radius entity search. Animal killing nonaktif secara default.

Runtime policy tersedia melalui:

- `GET /api/v1/settings`
- `PATCH /api/v1/settings/survival`
- `GET /api/v1/dashboard/snapshot`

## Verifikasi

Test survival mencakup armor upgrade dan downgrade protection manual, enchanted armor comparison, low-durability rejection, prioritas sheep special-source terhadap recipe string, sheep/wool, cow/milk, sleep/wake/cancellation, door/trapdoor exact-type validation, automatic door navigation, generic interaction, serta iron openable rejection. Seluruh operation mengembalikan hasil terverifikasi atau structured error yang eksplisit.

## Scope

Phase ini menyiapkan capability survival reusable. Helping Core, koordinasi sleep multi-bot penuh, feeding, breeding, taming, trading, dan mounting berada pada phase berikutnya.
