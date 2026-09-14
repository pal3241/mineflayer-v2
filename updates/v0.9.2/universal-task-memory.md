# v0.9.2 — Universal Task Memory

Universal Task Memory menyatukan fakta operasional yang sudah terverifikasi untuk dipakai lintas task dan lintas bot. Event task yang selesai, chest/storage yang terdaftar atau tersinkron, dan placement blueprint tersimpan sebagai record ber-scope server dan dimensi.

Building membaca kembali record placement sebelum meletakkan blok. Bila sebuah blok untuk blueprint yang sama sudah tercatat terverifikasi, proyek resume menandainya selesai tanpa mencoba membangun ulang. API `GET /api/v1/memory/universal/context` menyediakan storage, task selesai, dan placement di sekitar posisi untuk dashboard serta mod client berikutnya.
