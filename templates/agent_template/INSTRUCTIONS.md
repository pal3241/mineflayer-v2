"""Instruksi menambah agent baru.

Salin folder template ini ke lokasi mana pun di dalam `agents/`, misalnya:

    templates/agent_template  ->  agents/custom/my_agent

Langkah:
1. Salin folder template.
2. Ubah `id`, `name`, `role`, `capabilities` di `agent.py` dan `manifest.json`.
3. Perbarui `README.md` dan tambahkan `test_agent.py` jika perlu.
4. Jalankan ulang aplikasi / reload registry.

Agent Discovery akan memindai folder `agents/` secara rekursif
(mencari `manifest.json` + `agent.py`) dan mendaftarkan agent secara otomatis,
TANPA mengubah Core System.
"""
