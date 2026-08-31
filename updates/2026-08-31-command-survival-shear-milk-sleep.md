# 2026-08-31 — Command survival shear, milk, dan sleep

Command chat survival berikut tersedia untuk selector bot, class, dan global:

- `shear` mencari domba yang belum dicukur lalu memverifikasi wool hasil interaksi.
- `milk` mencari sapi lalu memverifikasi perubahan bucket menjadi `milk_bucket`.
- `sleep` mencari bed kosong terdekat dan memvalidasi waktu, dimension, serta occupancy sebelum tidur.

Perintah menggunakan capability survival yang mencari target terdekat terlebih dahulu. Kegagalan alat, inventory, target, bed, atau kondisi tidur tetap dikembalikan sebagai error capability yang spesifik.
