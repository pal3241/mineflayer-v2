# Dashboard memory dan lifecycle settings

Dashboard memiliki tab **Memory** untuk membaca seluruh record world dan semantic memory yang tersimpan. Browser memory mendukung pencarian, filter category, type, server/world, dimension, pagination 50 record, ringkasan jumlah world, semantic, short-term, dan long-term, serta detail sumber, confidence, importance, lokasi, tag, dan lifecycle setiap record.

Tab yang sama menyediakan runtime settings untuk total record limit, short-term limit, TTL, jumlah recall dan importance yang memicu promosi, serta interval konsolidasi. Perubahan tervalidasi di server dan berlaku pada penulisan atau konsolidasi berikutnya. Tombol **Consolidate now** menjalankan lifecycle secara manual. Reset runtime settings mengembalikan policy ke konfigurasi startup tanpa langsung menghapus record memory.

Endpoint `GET /api/v1/memory/dashboard` menggabungkan record secara aman tanpa mengirim vector embedding mentah. Endpoint `PATCH /api/v1/settings/memory` mengubah policy runtime. Keduanya tetap dilindungi bearer token ketika autentikasi API aktif.
