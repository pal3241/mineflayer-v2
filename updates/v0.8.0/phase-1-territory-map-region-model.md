# 0.8.0 Phase 1 — Territory Map & Region Model

Phase 1 membangun sumber data spasial persisten untuk Autonomous Territory & Expansion.

- Region tidak dipaksa menjadi satu lingkaran global; peta tersusun dari banyak region yang dapat saling bertumpuk dan berkembang tidak simetris.
- Delapan tipe region tersedia: `BASE`, `SAFE`, `RESOURCE`, `INDUSTRIAL`, `DANGER`, `FRONTIER`, `LOGISTICS_ROUTE`, dan `OUTPOST`.
- Setiap region menyimpan world, dimension, pusat, radius, biome, resource, danger level, status eksplorasi, metadata, timestamp, dan version.
- Semua input dibatasi dan divalidasi sebelum disimpan, termasuk identitas world, koordinat, radius 1–2048, danger level 0–1, resource, serta dimension.
- TerritoryService menyediakan create, read, update, delete, filter per world/dimension/type, pencarian region pada suatu posisi, ringkasan map, health, event lifecycle, dan persistence JSON/SQLite melalui repository boundary.
- Control API tersedia di `/api/v1/territory/regions`, `/api/v1/territory/map`, dan `/api/v1/territory/at`.

Phase berikutnya akan mengubah discovery dan death/recovery signals menjadi Resource Zone dan Danger Zone yang terukur.
