# Handoff item antarbot

Pemenuhan material crafting dan tool dari bot lain kini memakai titik temu dua arah. Coordinator menghitung titik tengah aman dari posisi donor dan penerima, lalu menggerakkan keduanya secara bersamaan sebelum item dijatuhkan.

Jumlah inventory donor diverifikasi segera setelah drop. Donor kemudian mengirim pesan chat bahwa item sudah dijatuhkan dan event `coordinator.item.dropped` dipublikasikan dengan donor, penerima, item, jumlah, titik temu, serta pesan notifikasi. Penerima langsung menjalankan pickup dan perubahan inventory penerima harus sama persis dengan jumlah yang diberikan sebelum transfer dinyatakan selesai.

Transfer yang berhasil menghasilkan event `coordinator.item.transferred` dengan status verifikasi, titik temu, dan notifikasi. Selisih inventory donor atau penerima yang tidak sesuai sekarang menggagalkan handoff secara eksplisit agar coordinator tidak menganggap item sudah diterima.
