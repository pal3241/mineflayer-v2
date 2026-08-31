# 0.7.3 Phase 2 — Helping: Output Ownership and Resource Handoff

Phase 2 menambahkan HelpSession untuk memastikan hasil kerja helper tidak dihitung selesai hanya karena berhasil dikumpulkan.

- Output policy `OWNER`, `SHARED_STORAGE`, dan `HELPER_KEEP`.
- Lifecycle `assigned`, `collected`, `delivered`, dan `credited` untuk setiap worker.
- Progress parent hanya bertambah dari output yang telah diverifikasi pada destination.
- Handoff OWNER memakai `FleetTransferService` yang juga dipakai Acquisition.
- Handoff SHARED_STORAGE memakai logistics deposit terverifikasi.
- Anti over-credit menyimpan surplus tanpa melebihi target.
- Helper yang mati sebelum delivery masuk recovery state tanpa false credit.

API:

- `POST /api/v1/help/sessions`
- `GET /api/v1/help/sessions`
- `POST /api/v1/help/sessions/:id/collected`
- `POST /api/v1/help/sessions/:id/handoff`
- `POST /api/v1/help/sessions/:id/recovery`
