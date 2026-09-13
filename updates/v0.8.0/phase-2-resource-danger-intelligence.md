# 0.8.0 Phase 2 — Resource & Danger Intelligence

Phase 2 mengubah fakta runtime menjadi region Territory yang terukur dan dapat diaudit.

- Resource discovery otomatis membuat atau memperbarui `RESOURCE` region terdekat serta menggabungkan jenis resource tanpa duplikasi.
- Death manifest otomatis menghasilkan danger evidence. Penyebab seperti void, lava, hostile mob, dan fall memiliki severity deterministik yang berbeda.
- Danger evidence berulang menaikkan danger level secara monoton dengan rumus bounded sehingga nilainya tidak pernah melebihi 1.
- Evidence yang berjarak maksimal 32 blok digabung ke region yang sama; area lain tetap menjadi region asimetris terpisah.
- Signal menyimpan source, source ID, confidence, severity, posisi, waktu observasi, metadata, dan relasi ke region.
- Replay signal dengan source ID yang sama bersifat idempotent sehingga scan atau event ulang tidak menggandakan evidence.
- Riwayat signal dibatasi 1.000 record secara default agar persistence tidak tumbuh tanpa batas.
- Event `territory.resource.detected` dan `territory.danger.updated`, health status, serta API manual dan read-only tersedia untuk observability.

Phase berikutnya akan memakai Resource Zone, Danger Zone, dan Frontier untuk merencanakan eksplorasi serta memilih scout.
