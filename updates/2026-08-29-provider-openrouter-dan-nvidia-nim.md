# Provider OpenRouter dan NVIDIA NIM

LLM gateway kini memiliki dua provider: **OpenRouter** dan **NVIDIA NIM**. Opsi lama `auto` dan `local` dihapus; `none` tetap tersedia untuk mematikan LLM dan memakai parser deterministik. OpenRouter menggunakan endpoint default `https://openrouter.ai/api/v1`, sedangkan NVIDIA-hosted memakai `https://integrate.api.nvidia.com/v1`. Deployment NIM mandiri dapat memakai endpoint OpenAI-compatible sendiri dan tidak diwajibkan memiliki key jika endpoint bukan NVIDIA-hosted.

Setiap provider memiliki model, endpoint, dan pool maksimal tiga key yang terpisah. Status `401`, `402`, dan `429` memindahkan request ke key berikutnya. Dashboard tidak pernah menerima nilai key dan membersihkan seluruh input password setelah penyimpanan berhasil. Reset runtime memulihkan konfigurasi serta kedua pool key dari startup.

Konfigurasi NVIDIA memakai `NVIDIA_API_KEY_1..3`, `MINEHIVE_NVIDIA_NIM_ENDPOINT`, dan `MINEHIVE_NVIDIA_NIM_MODEL`. Variabel standar `NVIDIA_API_KEY` tetap didukung sebagai single-key. Konfigurasi OpenRouter memakai `OPENROUTER_API_KEY_1..3`, `MINEHIVE_OPENROUTER_ENDPOINT`, dan `MINEHIVE_OPENROUTER_MODEL`; nama lama `MINEHIVE_LLM_ENDPOINT` dan `MINEHIVE_LLM_MODEL` tetap dibaca sebagai alias OpenRouter.

Untuk migrasi tanpa downtime, nilai lama `auto` langsung dipetakan ke provider yang sudah memiliki konfigurasi dan nilai lama `local` dipetakan ke NVIDIA NIM mandiri. Variabel `MINEHIVE_LOCAL_LLM_ENDPOINT`, `MINEHIVE_LOCAL_LLM_MODEL`, dan `MINEHIVE_LOCAL_LLM_API_KEY` tetap dibaca saat startup, tetapi dashboard hanya menyimpan nama provider baru.
