# Panduan Penggunaan MineHive

Panduan ini menjelaskan cara menjalankan dan mengontrol MineHive v0.3.2. MineHive membutuhkan Node.js 20 atau lebih baru dan sebuah server Minecraft Java Edition yang dapat diakses.

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
MINEHIVE_CHAT_PREFIX=!hive
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
- **Command Center** untuk menjalankan `goto`, `collect`, `follow`, `chat`, `status`, `inventory`, dan `stop`.
- **Admins** untuk menambah atau menghapus administrator command chat.

Profil bot dan admin yang ditambahkan melalui dashboard disimpan dalam folder `data/` dan dimuat kembali saat restart.

### Kamera live

1. Pastikan bot sudah berstatus `READY`.
2. Buka menu **Bots & Join**.
3. Tekan **Live camera** pada bot.
4. Dashboard berpindah ke menu **Live Cameras**.

Setiap bot memakai port kamera berbeda mulai dari `MINEHIVE_VIEWER_BASE_PORT`, default `3100`. Viewer kamera tidak memakai bearer-token API. Jangan membuka port kamera ke internet; batasi ke localhost atau LAN tepercaya menggunakan firewall/reverse proxy.

## 5. Command dari chat Minecraft

Command hanya diterima dari username yang terdaftar pada `MINEHIVE_ADMINS`.

### Melihat bantuan

```text
!hive help
```

### Melihat status bot

```text
!hive status
```

Bot akan menampilkan status, health, food, dan posisi.

### Memanggil bot ke posisi pemain

```text
!hive come
```

Pemain harus terlihat oleh bot.

### Bergerak ke koordinat

```text
!hive goto 100 64 -20
```

Urutan koordinat adalah `x y z`.

### Mengumpulkan block

```text
!hive collect oak_log 16
```

Gunakan nama registry Minecraft, misalnya:

```text
oak_log
stone
coal_ore
iron_ore
sand
```

MineHive mencari block dalam radius yang diizinkan, memilih alat, mendatangi block, menambangnya, lalu mengambil hasilnya.

### Melihat inventory

```text
!hive inventory
```

### Menghentikan aktivitas

```text
!hive stop
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
- prefix yang digunakan sesuai `MINEHIVE_CHAT_PREFIX`
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
- Dashboard grafis, AI/LLM, memory jangka panjang, ML, dan colony automation masih merupakan milestone berikutnya.
- Checkpoint task tersedia saat proses berjalan, tetapi recovery penuh setelah restart belum menjadi persistence production.
