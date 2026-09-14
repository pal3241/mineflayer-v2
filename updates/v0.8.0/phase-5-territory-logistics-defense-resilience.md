# v0.8.0 Phase 5 — Territory Logistics, Defense & Resilience

Phase 5 menutup v0.8.0 dengan menghubungkan peta territory ke keputusan logistik, defense, emergency, dan pemulihan sistem. Semua keputusan keselamatan tetap deterministik dan dapat diaudit ketika LLM tidak tersedia.

## Territory logistics

- Storage dipilih berdasarkan total cost, bukan jarak saja.
- Cost menggabungkan distance, danger, route failure probability, traffic, storage utilization, dan reservation pressure.
- Storage tanpa kapasitas yang dibutuhkan dikeluarkan dari kandidat.
- Urutan tetap deterministik ketika dua kandidat mempunyai cost sama.
- `reserve` dan `store` pada Logistics Service otomatis memakai ranking territory ini.

## Defense

- Threat detector menerima entity, jarak, kondisi health/equipment bot, jumlah musuh, waktu, bot teman, jarak dari base, escape route, dan kepentingan mission.
- Hasil diklasifikasikan menjadi `NONE`, `LOW`, `MEDIUM`, `HIGH`, atau `CRITICAL`.
- Respons dipilih dari `IGNORE`, `OBSERVE`, `AVOID`, `RETREAT`, `DEFEND`, `INTERCEPT`, `REQUEST_BACKUP`, dan `EVACUATE`.
- Ancaman high/critical membuat health defense menjadi degraded sampai ancaman ditutup.

## Emergency dan degraded mode

- Mode sistem: `NORMAL`, `DEGRADED`, `EMERGENCY`, `RECOVERY`, dan `SHUTDOWN`.
- Emergency mencakup bot death, critical food, base attack, resource crisis, plugin/communication/database/HiveMind failure, infrastructure damage, dan mass disconnect.
- Event `bot.death` otomatis membuka incident idempotent dan mengaktifkan emergency response.
- Dependency failure menurunkan sistem ke degraded mode tanpa mematikan policy deterministik yang sehat.

## Resilience

- Retry dibatasi 1–8 attempt dengan exponential backoff dan timeout.
- Circuit breaker mencegah pemanggilan dependency yang terus gagal.
- Operasi yang menghabiskan retry budget disimpan ke dead-letter queue dan recovery queue.
- Command sukses disimpan dengan idempotency key sehingga replay tidak mengeksekusi operasi kembali.
- Recovery memiliki status persisten dan mode sistem kembali normal hanya setelah incident, dependency, dan queue aman.

## API baru

API Phase 5 tersedia di kelompok `/api/v1/territory/logistics`, `/api/v1/territory/threats`, dan `/api/v1/resilience`. Daftar endpoint lengkap tersedia di `DAFTAR_COMMAND.md`.

## Pengujian

Pengujian mencakup pemilihan warehouse risk-aware, capacity exclusion, klasifikasi threat, lifecycle emergency idempotent, exponential retry, timeout budget, dead-letter/recovery queue, circuit breaker, dan degraded dependency health.
