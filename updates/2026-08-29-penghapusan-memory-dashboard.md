# Penghapusan memory dari dashboard

Setiap kartu pada tab **Memory** kini memiliki tombol **Delete**. Dashboard menampilkan konfirmasi yang menyebut jenis dan isi record sebelum mengirim penghapusan. Setelah server mengonfirmasi, daftar, pagination, statistik memory, dan ringkasan overview diperbarui.

World memory tetap dihapus melalui `DELETE /api/v1/memory/:id`, sedangkan semantic, short-term, dan long-term memory menggunakan endpoint baru `DELETE /api/v1/memory/semantic/:id`. Kedua endpoint mengembalikan `404 NOT_FOUND` untuk ID yang tidak ada sehingga dashboard tidak menampilkan sukses palsu. Penghapusan bersifat permanen dan tidak dapat dibatalkan.
