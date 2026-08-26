# Panduan Penggunaan MineHive

Panduan ini menjelaskan cara menjalankan dan mengontrol MineHive v0.4.1. MineHive membutuhkan Node.js 20 atau lebih baru dan sebuah server Minecraft Java Edition yang dapat diakses.

## 1. Persiapan

Pastikan perangkat memiliki:

- Node.js 20 atau lebih baru
- npm
- Alamat dan port server Minecraft
- Username bot atau akun Microsoft yang akan digunakan

Periksa versi Node.js dan npm:

```powershell
node --version
npm --version
```

Pasang dependency proyek:

```powershell
Set-Location D:\mineflayer
npm install
npm test
```

Semua test seharusnya lulus sebelum bot dijalankan.

## 2. Membuat konfigurasi

Salin konfigurasi contoh menjadi `.env`:

```powershell
Copy-Item config\minehive.env.example .env
```

CLI juga membaca `config/minehive.env` sebagai fallback. Jika kedua file tersedia, nilai dari `.env` diprioritaskan.

Buka `.env`, kemudian sesuaikan nilainya.

### Server offline atau server lokal

```env
MINEHIVE_PROFILE=development
MINEHIVE_HOST=localhost
MINEHIVE_PORT=25565
MINEHIVE_USERNAME=MineHiveBot
MINEHIVE_AUTH=offline
MINEHIVE_AUTO_CONNECT=true

MINEHIVE_API_HOST=127.0.0.1
MINEHIVE_API_PORT=3000
MINEHIVE_API_TOKEN=ganti-dengan-token-rahasia

MINEHIVE_CHAT_COMMANDS=true
MINEHIVE_ADMINS=UsernameMinecraftAnda
```

### Server online dengan akun Microsoft

Gunakan:

```env
MINEHIVE_USERNAME=email-akun-microsoft@example.com
MINEHIVE_AUTH=microsoft
MINEHIVE_AUTO_CONNECT=true
```

Saat pertama dijalankan, ikuti petunjuk login perangkat Microsoft yang muncul di terminal. Jangan memasukkan password Microsoft ke dalam `.env`.

### Beberapa administrator

Pisahkan username dengan koma tanpa tanda kutip:

```env
MINEHIVE_ADMINS=PlayerSatu,PlayerDua,PlayerTiga
```

Jika `MINEHIVE_ADMINS` kosong, semua command dari chat Minecraft akan ditolak.

### Memilih koordinator LLM

MineHive tetap dapat menjalankan command sederhana tanpa LLM melalui parser deterministik. Untuk menggunakan OpenRouter, tambahkan konfigurasi berikut. Jangan membagikan atau commit API key.

```env
MINEHIVE_LLM_PROVIDER=openrouter
OPENROUTER_API_KEY_1=api-key-utama
OPENROUTER_API_KEY_2=api-key-cadangan-1
OPENROUTER_API_KEY_3=api-key-cadangan-2
MINEHIVE_LLM_MODEL=openrouter/auto
```

Ketiga key disimpan sebagai pool. Jika key aktif menerima HTTP `429` (rate limit), `402` (saldo/quota), atau `401` (key tidak valid), permintaan yang sama dipindahkan ke key berikutnya. Key yang terkena `429` mengikuti `Retry-After` atau cooldown 60 detik. Dashboard hanya menampilkan nomor key aktif dan jumlah key siap pakai, tidak pernah nilai key. Variabel lama `OPENROUTER_API_KEY` tetap didukung untuk satu key.

Untuk server LLM lokal yang menyediakan API kompatibel OpenAI `/v1/chat/completions`, gunakan:

```env
MINEHIVE_LLM_PROVIDER=local
MINEHIVE_LOCAL_LLM_ENDPOINT=http://127.0.0.1:11434/v1
MINEHIVE_LOCAL_LLM_MODEL=nama-model-lokal
MINEHIVE_LOCAL_LLM_API_KEY=
MINEHIVE_LOCAL_LLM_STRUCTURED=false
```

Mode `auto` memilih OpenRouter jika salah satu API key tersedia, memilih lokal jika endpoint dan model lokal diisi, lalu menggunakan parser deterministik bila keduanya belum dikonfigurasi. Dashboard menampilkan provider, model, dan kesehatan pool key yang benar-benar aktif.

## 3. Menjalankan sistem

Jalankan:

```powershell
npm start
```

Dengan `MINEHIVE_AUTO_CONNECT=true`, MineHive akan:

1. Memuat konfigurasi `.env`.
2. Menjalankan core dan API.
3. Membuat runtime bot.
4. Menghubungkan bot ke server Minecraft.
5. Memuat Pathfinder, CollectBlock, Tool Selection, dan AutoEat.
6. Mengaktifkan command chat setelah bot spawn.

Jangan tutup terminal selama bot digunakan.

## 4. Menggunakan dashboard

Buka browser pada:

```text
http://127.0.0.1:3000
```

Jika `MINEHIVE_API_TOKEN` telah diisi, masukkan token tersebut pada kolom **API token**, lalu pilih **Save token**. Token hanya disimpan pada penyimpanan lokal browser.

Dashboard menyediakan:

- **Overview** untuk health, jumlah bot online, goal aktif, dan status fleet.
- **Bots & Join** untuk menambah bot, join/disconnect server, membuka kamera, atau menghapus profil.
- **Live Cameras** untuk melihat kamera first-person setiap bot yang kameranya diaktifkan.
- **Command Center** untuk menjalankan `goto`, `collect`, `follow`, `sethome`, `home`, `craft`, command AI, `chat`, `status`, `inventory`, dan `stop`.
- **Admins** untuk menambah atau menghapus administrator command chat.

Profil bot dan admin yang ditambahkan melalui dashboard disimpan dalam folder `data/` dan dimuat kembali saat restart.

### Kamera live

1. Pastikan bot sudah berstatus `READY`.
2. Buka menu **Bots & Join**.
3. Tekan **Live camera** pada bot.
4. Dashboard berpindah ke menu **Live Cameras**.

Setiap bot memakai port kamera berbeda mulai dari `MINEHIVE_VIEWER_BASE_PORT`, default `3100`. Viewer kamera tidak memakai bearer-token API. Jangan membuka port kamera ke internet; batasi ke localhost atau LAN tepercaya menggunakan firewall/reverse proxy.

Live camera melakukan preflight native `canvas` sebelum viewer dibuka. Jika binding canvas gagal dimuat, dashboard menampilkan error kamera dan viewer tidak dijalankan setengah aktif.

## 5. Command dari chat Minecraft

Command hanya diterima dari username yang terdaftar pada `MINEHIVE_ADMINS`. Setiap bot memiliki **command alias** dan **class** yang dapat diatur ketika bot ditambahkan melalui dashboard.

Format selector:

```text
!aliasbot command
!class command
!global command
```

Contoh: `!bot1` hanya mengontrol bot dengan alias `bot1`, `!miner` mengontrol semua bot dalam class `miner`, sedangkan `!global` mengontrol seluruh bot yang menerima chat pada server tersebut.

### Melihat bantuan

```text
!bot1 help
```

### Melihat status bot

```text
!bot1 status
```

Bot akan menampilkan status, health, food, dan posisi.

### Memanggil bot ke posisi pemain

```text
!bot1 come
```

Pemain harus terlihat oleh bot.

Untuk terus mengikuti pemain yang bergerak:

```text
!bot1 ai follow PlayerSatu
```

### Bergerak ke koordinat

```text
!bot1 goto 100 64 -20
```

Urutan koordinat adalah `x y z`.

### Mengumpulkan block

```text
!bot1 collect oak_log 16
```

Gunakan nama registry Minecraft, misalnya:

```text
oak_log
stone
coal_ore
iron_ore
sand
```

Semua command `collect` otomatis melewati koordinator, termasuk command tanpa kata `ai`. MineHive mencari block dalam radius yang diizinkan, memeriksa persyaratan alat dari registry Minecraft, mendatangi block, menambangnya, lalu mengambil hasilnya.

### Menyimpan dan kembali ke home

```text
!bot1 sethome base
!bot1 home base
```

Home disimpan selama runtime bot aktif. Bot memakai Pathfinder untuk kembali ke koordinat tersebut dan menolak home yang berada di dimension berbeda.

### Crafting

```text
!bot1 craft wooden_pickaxe 1
```

Crafting menyelesaikan bahan turunan secara rekursif. Jika resep membutuhkan crafting table, bot membuatnya bila bahan cukup lalu menempatkannya pada ruang aman di samping bot.

### Koordinator AI untuk individu atau kelompok

```text
!bot1 ai collect stone 16
!miner ai collect stone 64
!global ai craft wooden_pickaxe 3
```

Selector tetap menggunakan alias bot, class, atau global. Sebelum bekerja, LLM menerima snapshot aman yang berisi posisi dan inventory masing-masing bot serta daftar bot terdekat yang sudah diurutkan berdasarkan jarak tiga dimensi.

Untuk setiap block yang tidak dapat dipanen dengan tangan, koordinator menjalankan pipeline otomatis:

1. Membaca daftar `harvestTools` block dari registry versi Minecraft bot.
2. Memeriksa inventory bot target.
3. Menyaring bot lain agar hanya server dan dimension yang sama, mengabaikan bot dengan task aktif, menghitung jarak Euclidean, lalu mencoba donor terdekat terlebih dahulu.
4. Meminjam alat yang valid atau bahan crafting yang masih kurang. Donor dapat memberi sebagian stack dan koordinator melanjutkan ke donor berikutnya.
5. Membuat crafting plan rekursif, termasuk crafting table dan furnace.
6. Jika tidak ada donor bahan, mencari block yang menjatuhkan item tersebut, menyiapkan alat untuk bahan itu secara rekursif, lalu mengumpulkannya sendiri.
7. Melakukan smelting otomatis untuk `iron_ingot`, `gold_ingot`, atau `copper_ingot` dengan raw material dan coal ketika dibutuhkan.
8. Memverifikasi alat di inventory, baru menjalankan pekerjaan collect utama.

Dengan demikian `!bot1 collect stone 16` sudah menjalankan seluruh alur peminjaman/crafting tersebut tanpa command tambahan. Jumlah pekerjaan class/global dibagi tepat di antara bot yang tersedia.

Output LLM hanya boleh menghasilkan intent terstruktur yang telah diizinkan. LLM tidak memperoleh akses shell, JavaScript, API internal bebas, atau API key dari prompt. Output yang rusak atau tidak valid otomatis jatuh kembali ke parser deterministik.

### Melihat inventory

```text
!bot1 inventory
```

### Menghentikan aktivitas

```text
!bot1 stop
```

Command ini menghentikan pathfinding, pengumpulan block, dan task aktif milik bot.

## 6. Menggunakan REST API

API default tersedia di:

```text
http://127.0.0.1:3000
```

Jika `MINEHIVE_API_TOKEN` diisi, tambahkan bearer token ke setiap request selain `/health`.

Simpan header PowerShell agar dapat dipakai ulang:

```powershell
$headers = @{ Authorization = 'Bearer ganti-dengan-token-rahasia' }
```

### Health check

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

### Melihat semua bot

```powershell
$bots = Invoke-RestMethod `
  -Uri http://127.0.0.1:3000/api/v1/bots `
  -Headers $headers

$bots.data
```

Catat nilai `id` bot. Contoh berikut menggunakan `BOT_ID`; ganti dengan ID sebenarnya.

### Melihat detail bot

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID `
  -Headers $headers
```

### Membuat bot melalui API

Gunakan cara ini apabila `MINEHIVE_AUTO_CONNECT=false`:

```powershell
$newBot = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/bots `
  -Headers $headers `
  -ContentType application/json `
  -Body '{
    "id": "worker-1",
    "username": "MineHiveWorker",
    "host": "localhost",
    "port": 25565,
    "auth": "offline"
  }'
```

### Menghubungkan bot yang dibuat lewat API

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/bots/worker-1/start `
  -Headers $headers
```

### Menjalankan navigasi

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID/actions/navigate `
  -Headers $headers `
  -ContentType application/json `
  -Body '{"x":100,"y":64,"z":-20}'
```

### Mengumpulkan block

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID/actions/collect `
  -Headers $headers `
  -ContentType application/json `
  -Body '{"block":"oak_log","count":16}'
```

### Mengirim chat melalui bot

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID/actions/chat `
  -Headers $headers `
  -ContentType application/json `
  -Body '{"message":"MineHive aktif"}'
```

### Menjalankan koordinator AI melalui API

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/ai/command `
  -Headers $headers `
  -ContentType application/json `
  -Body '{"selector":"class:miner","text":"collect stone 32"}'
```

Gunakan `bot:alias`, `class:nama`, `global`, atau `auto` sebagai selector. Status provider dan pool key dapat diperiksa melalui `GET /api/v1/ai/status`. Snapshot koordinasi berisi posisi, inventory, dan urutan bot terdekat tersedia melalui `GET /api/v1/ai/fleet`; endpoint ini dilindungi bearer token bila token API dikonfigurasi.

### Menghentikan bot

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID/stop `
  -Headers $headers
```

## 7. Goal terstruktur melalui API

Goal dapat berisi beberapa langkah dengan dependency berurutan.

```powershell
$goalResponse = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/goals `
  -Headers $headers `
  -ContentType application/json `
  -Body '{
    "description": "Pergi ke hutan dan kumpulkan kayu",
    "priority": 60,
    "steps": [
      {
        "name": "pergi",
        "type": "navigate",
        "input": {"x":100,"y":64,"z":-20},
        "requiredCapabilities": ["minecraft.navigation"]
      },
      {
        "name": "ambil-kayu",
        "type": "collect",
        "input": {"block":"oak_log","count":16},
        "requiredCapabilities": ["minecraft.collection"],
        "dependencies": ["pergi"]
      }
    ]
  }'

$goalId = $goalResponse.data.id
```

Jalankan goal:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3000/api/v1/goals/$goalId/run" `
  -Headers $headers
```

Periksa goal beserta task-nya:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:3000/api/v1/goals/$goalId" `
  -Headers $headers
```

## 8. Menghentikan MineHive dengan aman

Tekan `Ctrl+C` pada terminal tempat `npm start` berjalan. MineHive akan:

1. Berhenti menerima pekerjaan baru.
2. Membatalkan task aktif.
3. Menghentikan pathfinding dan mining.
4. Memutus koneksi semua bot.
5. Menutup API.

Hindari langsung mematikan proses dari Task Manager kecuali proses benar-benar tidak merespons.

## 9. Troubleshooting

### Bot tidak masuk server

Periksa:

- `MINEHIVE_AUTO_CONNECT=true`
- host dan port benar
- versi server kompatibel dengan Mineflayer
- firewall tidak memblokir koneksi
- mode `offline` atau `microsoft` sesuai konfigurasi server

Lihat log `bot.runtime.failure` atau `bot.runtime.reconnecting` pada terminal.

### Command chat tidak merespons

Periksa:

- username sama persis dengan nilai `MINEHIVE_ADMINS`
- `MINEHIVE_CHAT_COMMANDS=true`
- selector sesuai command alias, class, atau `global`
- bot sudah berstatus `READY`

### Bot tidak menemukan block

- Gunakan nama registry yang benar, misalnya `oak_log`, bukan `wood`.
- Pastikan block berada dalam radius pencarian.
- Pastikan area dapat dicapai oleh Pathfinder.
- Pastikan bot memiliki alat yang sesuai bila block membutuhkannya.

### API mengembalikan 401

Nilai bearer token tidak sama dengan `MINEHIVE_API_TOKEN`. Pastikan format header adalah:

```text
Authorization: Bearer token-anda
```

### Port API sudah digunakan

Ubah:

```env
MINEHIVE_API_PORT=3001
```

### Memeriksa sistem tanpa masuk Minecraft

```powershell
npm run health
npm test
```

## 10. Keamanan

- Jangan commit `.env`.
- Jangan menyimpan password Microsoft di konfigurasi.
- Gunakan API token panjang dan acak jika API diakses melalui jaringan.
- Jangan mengekspos port API langsung ke internet tanpa reverse proxy dan TLS.
- Batasi `MINEHIVE_ADMINS` hanya kepada pemain tepercaya.
- Command chat tidak dapat menjalankan shell, JavaScript, atau fungsi internal bebas.

## 11. Batasan versi ini

- Pengujian otomatis menggunakan fake Minecraft client; koneksi nyata tergantung server, jaringan, akun, dan versi protokol.
- Koordinator saat ini mendukung intent aman `collect`, `craft`, `follow`, `move`, `set_home`, `home`, dan `status`; perencanaan koloni umum serta memory LLM jangka panjang belum tersedia.
- Pertukaran item membutuhkan kedua bot berada pada server dan dimension yang sama serta cukup dekat untuk saling mendatangi.
- Checkpoint task tersedia saat proses berjalan, tetapi recovery penuh setelah restart belum menjadi persistence production.
