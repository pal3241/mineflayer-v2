# Smelting iron dan makanan

Tanggal: 2026-08-29

Update ini membuka smelting sebagai action yang dapat dipanggil langsung melalui chat Minecraft, Command Center, natural language, dan HTTP API.

## Command

```text
!bot1 smelt iron_ingot 8
!bot1 smelt cooked_beef 4
!bot1 lebur besi 8
!bot1 masak daging sapi 4
!miner smelt iron_ingot 16
!global smelt cooked_chicken 16
```

Endpoint action:

```text
POST /api/v1/bots/:id/actions/smelt
```

Body menggunakan output item dan jumlah yang ingin dihasilkan:

```json
{
  "item": "iron_ingot",
  "count": 8
}
```

## Perilaku

- Coordinator membagi jumlah smelting ke bot yang dipilih untuk selector class atau global.
- Bot menggunakan furnace terdekat dalam radius enam block.
- Jika furnace belum tersedia, bot menyiapkan bahan, membuat furnace, lalu menempatkannya.
- Raw input dan fuel dipenuhi melalui inventory, donor terdekat, atau resource collection yang tersedia.
- Coal dan charcoal dapat digunakan sebagai fuel.
- Furnace yang sedang memiliki input atau output item lain ditolak dengan error spesifik agar item tidak tercampur.
- Output diverifikasi dari delta inventory sebelum task dilaporkan selesai.

## Hasil yang didukung

- `iron_ingot`, `gold_ingot`, dan `copper_ingot`
- `cooked_beef`, `cooked_porkchop`, `cooked_mutton`, `cooked_chicken`, dan `cooked_rabbit`
- `cooked_cod` dan `cooked_salmon`
- `baked_potato` dan `dried_kelp`

## Pengujian

- Parser deterministik memahami `lebur besi` dan `masak daging sapi`.
- Coordinator diuji menghasilkan iron ingot dan cooked beef dari input serta fuel.
- Adapter furnace diuji memindahkan raw input, memakai fuel, mengambil output, dan memverifikasi delta inventory.
