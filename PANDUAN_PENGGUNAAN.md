# Panduan Penggunaan MineHive

Panduan ini menjelaskan cara menjalankan dan mengontrol MineHive v0.7.3 Phase 1. MineHive membutuhkan Node.js 22 atau lebih baru dan sebuah server Minecraft Java Edition yang dapat diakses.

## 1. Persiapan

Pastikan perangkat memiliki:

- Node.js 22 atau lebih baru
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
MINEHIVE_OPENROUTER_ENDPOINT=https://openrouter.ai/api/v1
MINEHIVE_OPENROUTER_MODEL=openrouter/auto
```

Ketiga key disimpan sebagai pool. Jika key aktif menerima HTTP `429` (rate limit), `402` (saldo/quota), atau `401` (key tidak valid), permintaan yang sama dipindahkan ke key berikutnya. Key yang terkena `429` mengikuti `Retry-After` atau cooldown 60 detik. Dashboard hanya menampilkan nomor key aktif dan jumlah key siap pakai, tidak pernah nilai key. Variabel lama `OPENROUTER_API_KEY` tetap didukung untuk satu key.

Provider kedua adalah NVIDIA NIM. Untuk NVIDIA-hosted API Catalog gunakan:

```env
MINEHIVE_LLM_PROVIDER=nvidia
NVIDIA_API_KEY_1=nvapi-key-utama
NVIDIA_API_KEY_2=nvapi-key-cadangan-1
NVIDIA_API_KEY_3=nvapi-key-cadangan-2
MINEHIVE_NVIDIA_NIM_ENDPOINT=https://integrate.api.nvidia.com/v1
MINEHIVE_NVIDIA_NIM_MODEL=meta/llama-3.1-8b-instruct
```

NIM mandiri juga didukung dengan endpoint seperti `http://127.0.0.1:8000/v1`; API key boleh kosong untuk endpoint non-hosted. Kedua provider memakai `/chat/completions`, pool maksimal tiga key, rotasi status `401`, `402`, atau `429`, dan fallback request tanpa JSON schema jika model menolak structured output. Gunakan `MINEHIVE_LLM_PROVIDER=none` untuk parser deterministik tanpa layanan LLM. Dashboard menampilkan provider, model, dan kesehatan pool key yang benar-benar aktif.

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
- **Live Cameras** untuk melihat viewer first-person atau daerah 3D di sekitar setiap bot.
- **Command Center** untuk menjalankan navigasi, collect, follow/come, farming, kehutanan, combat, memory, crafting, percakapan natural-language, inventory, dan stop.
- **Memory** untuk melihat seluruh world/semantic/short-term/long-term memory, memfilter record, mengatur lifecycle, serta menjalankan konsolidasi manual.
- **Admins** untuk menambah atau menghapus administrator command chat.

Profil bot dan admin yang ditambahkan melalui dashboard disimpan dalam folder `data/` dan dimuat kembali saat restart.

### Kamera live

1. Pastikan bot sudah berstatus `READY`.
2. Buka menu **Bots & Join**.
3. Tekan **First person** untuk sudut pandang bot atau **3D area** untuk melihat daerah di sekitar bot dari kamera bebas.
4. Dashboard berpindah ke menu **Live Cameras**.

Setiap bot memakai port kamera berbeda mulai dari `MINEHIVE_VIEWER_BASE_PORT`, default `3100`. Viewer kamera tidak memakai bearer-token API. Jangan membuka port kamera ke internet; batasi ke localhost atau LAN tepercaya menggunakan firewall/reverse proxy.

Live camera melakukan preflight native `canvas` sebelum viewer dibuka. Jika binding canvas gagal dimuat, dashboard menampilkan error kamera dan viewer tidak dijalankan setengah aktif.

Mode **3D area** memakai renderer `prismarine-viewer` third-person dengan chunk di sekitar bot, sehingga kamera dapat diputar dan diperbesar seperti world viewer. Satu bot menjalankan satu mode viewer pada satu waktu.

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

`come` hanya mengambil posisi pemain saat command diterima, berjalan ke posisi tersebut, lalu selesai. Pemain harus terlihat oleh bot.

Untuk terus mengikuti pemain yang bergerak gunakan command `follow` yang terpisah:

```text
!bot1 follow PlayerSatu
```

Follow tetap aktif sampai `!bot1 stop` atau diganti aktivitas lain.

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

### Survei area dan shared memory

```text
!bot1 survey 64
!scout jelajah 32
```

Survei memeriksa chunk yang sudah termuat di sekitar bot tanpa menggerakkan bot secara liar. Marker village, stronghold, ancient city, trial chamber, dan resource berharga yang ditemukan disimpan otomatis ke world memory server/dimension tersebut sekaligus semantic memory HiveMind. Hasil survei dapat dipakai oleh bot lain melalui command natural-language atau pencarian memory.

Bot juga menjalankan structure observer otomatis setelah spawn dan setelah berpindah cukup jauh. Village, stronghold, ancient city, dan trial chamber dipromosikan menjadi long-term Hive memory dengan posisi, confidence, sumber bot, waktu observasi, serta marker pembuktiannya. Resource berharga disimpan sebagai semantic memory. Pengamatan berulang memperbarui record yang sama, bukan membuat lokasi duplikat tanpa batas.

### Chest dan logistics backbone

Dekatkan bot ke chest, trapped chest, barrel, atau shulker box lalu daftarkan storage:

```text
!bot1 register_chest gudang 16
!bot1 store stone 64 gudang
!bot1 retrieve stone 32 gudang
!bot1 stock
```

Nama storage persisten per server dan dimension. Sebelum mengambil item, MineHive membaca ulang isi storage, membuat reservasi stok, dan mengunci chest melalui HiveMind agar dua bot tidak memakai stok yang sama. Deposit dan withdrawal menunggu sinkronisasi slot dari server sampai lima detik, lalu baru dianggap berhasil jika perubahan jumlah pada inventory bot dan storage sama persis. Setiap transfer tersimpan sebagai audit record. Tab **Logistics** menampilkan storage, stok tersedia, stok yang sedang direservasi, dan transfer terverifikasi.

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

Resolver membaca seluruh alternatif resep untuk setiap item, lalu memberi peringkat berdasarkan inventory nyata dan rantai bahan yang dapat dibuat. Contohnya, jika bot memiliki `birch_log`, resep wooden sword berbasis birch dipilih sebelum cherry; jika stone pickaxe membutuhkan varian stone ingredient dan bot memiliki `cobbled_deepslate`, resep tersebut dipilih. Hanya `selectedRecipe.missing` dari plan terbaik yang dianggap benar-benar kurang.

### Smelting

```text
!bot1 smelt iron_ingot 8
!bot1 smelt cooked_beef 4
!bot1 lebur besi 8
!bot1 masak daging sapi 4
!global smelt cooked_chicken 16
```

Bot mencari furnace dalam jarak enam block. Jika furnace belum tersedia, coordinator menyiapkan bahan, membuat furnace, dan menempatkannya pada lokasi aman. Input serta bahan bakar dicari dari inventory sendiri, bot terdekat, atau resource yang dapat dikumpulkan. Coal dan charcoal didukung sebagai bahan bakar.

Hasil yang didukung meliputi `iron_ingot`, `gold_ingot`, `copper_ingot`, seluruh cooked meat utama, `cooked_cod`, `cooked_salmon`, `baked_potato`, dan `dried_kelp`. Smelting baru dianggap selesai jika pertambahan output pada inventory sama persis dengan jumlah yang diminta.

### Bahasa natural dan teman ngobrol

Setelah selector, teks tidak harus berupa command baku:

```text
!bot1 tebang pohon
!bot1 tolong bertani wheat 16
!bot1 jaga desa-utara
!bot1 berapa 1+1
!bot1 halo, keadaanmu bagaimana?
```

OpenRouter atau NVIDIA NIM menerjemahkan teks menjadi intent JSON yang dibatasi. Pertanyaan atau percakapan memakai intent `converse` dan dibalas melalui chat Minecraft. Jika LLM tidak aktif, parser lokal masih memahami command umum dan operasi aritmetika sederhana.

### Shared world memory

Memory lokasi dipisahkan berdasarkan `host:port` dan dimension, sehingga lokasi overworld server A tidak tercampur dengan Nether atau server B.

```text
!bot1 ingat desa-utara
!bot2 tempat desa-utara
!bot1 ingat stronghold
!bot2 tempat stronghold
```

Bot kedua dapat memakai lokasi yang disimpan bot pertama selama berada di server dan dimension yang sama. Record menyimpan sumber bot, confidence, importance, timestamp, dan version, kemudian dipersistenkan ke `data/world-memory.json`.

### Short-term dan long-term memory

Hasil pekerjaan coordinator disimpan lebih dahulu sebagai `SHORT_TERM`. Setiap recall yang relevan menambah `accessCount`. Konsolidasi otomatis berjalan sesuai `MINEHIVE_MEMORY_CONSOLIDATION_INTERVAL_MS`; memory dipromosikan menjadi `LONG_TERM` jika importance mencapai batas atau sudah dipakai berulang kali. Memory sementara yang kedaluwarsa atau melewati kapasitas dilupakan secara terkontrol, sedangkan long-term memory tidak ikut kebijakan TTL.

Policy permanen dapat diatur melalui `MINEHIVE_MEMORY_MAX_RECORDS`, `MINEHIVE_SHORT_MEMORY_MAX_RECORDS`, `MINEHIVE_SHORT_MEMORY_TTL_MS`, `MINEHIVE_MEMORY_PROMOTION_ACCESSES`, `MINEHIVE_MEMORY_PROMOTION_IMPORTANCE`, dan `MINEHIVE_MEMORY_CONSOLIDATION_INTERVAL_MS`. Tab **Memory** menyediakan pencarian, filter category/type/world/dimension, pagination, jumlah record per jenis, pengaturan policy runtime, status lifecycle, konsolidasi manual, serta penghapusan satu record dengan konfirmasi. Endpoint gabungan tersedia melalui `/api/v1/memory/dashboard`, sedangkan runtime policy memakai `PATCH /api/v1/settings/memory`. Semua record tetap menyimpan provenance, visibility, world, dimension, confidence, importance, access count, dan metadata embedding tanpa mengirim vector mentah ke browser.

### Farming dan kehutanan

```text
!farmer farm wheat 16
!lumber tebang pohon 4
!lumber reboisasi 8
```

Farming memanen crop matang, menanam ulang lahan kosong, dan hanya menyiapkan hoe melalui sistem pinjam/crafting/resource gathering ketika tanah baru perlu dicangkul. Deforestasi menelusuri semua log yang terhubung dari pucuk hingga pangkal agar tidak meninggalkan batang melayang. Setelah ditebang, sapling yang sesuai langsung ditanam pada bekas pangkal bila tersedia. Lokasi pohon juga masuk shared memory sebagai `tree_site`, sehingga command reboisasi dapat mencoba lokasi tersebut lagi.

### Combat state

```text
!guard guard 16
!guard jaga desa-utara
!fighter combat
!hunter meat
!global stop
```

- `guard` menyerang hostile mob di sekitar anchor coordinate atau tempat dari shared memory, lalu kembali ke anchor.
- `full_combat`/`combat` memburu hostile mob yang termuat di sekitar bot.
- `meat` hanya memburu mob pasif penghasil makanan seperti sapi, domba, babi, ayam, kelinci, dan mooshroom.
- Bot tidak menargetkan pemain. Combat masuk state `RETREATING` bila health kurang dari 6 dan dapat dihentikan dengan `stop`.

Hoe, axe, atau sword diperiksa dan disiapkan melalui sistem inventory/donor/crafting yang sama dengan pickaxe.

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

### Survival capability 0.7.3 Phase 1

Bot mengevaluasi armor setelah spawn dan hanya memasang upgrade yang lolos policy durability serta curse. Wool dan milk terhubung ke Acquisition: permintaan `white_wool` akan menyiapkan shears lalu mencari sheep, sedangkan `milk_bucket` akan menyiapkan bucket lalu mencari cow. Kedua operasi memverifikasi delta inventory.

Policy permanen dapat diatur melalui `.env`:

```env
MINEHIVE_SURVIVAL_ENABLED=true
MINEHIVE_AUTO_ARMOR_ENABLED=true
MINEHIVE_ARMOR_MINIMUM_DURABILITY_PERCENT=10
MINEHIVE_ARMOR_ALLOW_BINDING_CURSE=false
MINEHIVE_SURVIVAL_ALLOW_ANIMAL_KILL=false
MINEHIVE_MINIMUM_SHEEP_RESERVE=2
MINEHIVE_MINIMUM_COW_RESERVE=2
MINEHIVE_INTERACTION_COOLDOWN_MS=500
MINEHIVE_ENTITY_SEARCH_DISTANCE=48
```

Capability survival dapat dipanggil sebagai action API, misalnya:

```powershell
$headers = @{ Authorization = 'Bearer ganti-dengan-token-rahasia' }

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID/actions/armor `
  -Headers $headers -ContentType application/json -Body '{}'

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID/actions/wool `
  -Headers $headers -ContentType application/json `
  -Body '{"item":"white_wool","count":3}'

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:3000/api/v1/bots/BOT_ID/actions/open_door `
  -Headers $headers -ContentType application/json `
  -Body '{"position":{"x":10,"y":64,"z":20}}'
```

Action lain yang tersedia adalah `equip`, `unequip`, `use_item`, `interact_entity`, `interact_block`, `shear`, `milk`, `sleep`, `wake`, `close_door`, `open_trapdoor`, dan `close_trapdoor`. Semua action masuk Goal/TaskExecutor dan menerima cancellation dari task context. Navigation otomatis membuka wooden/copper door yang menghalangi rute; iron door, iron trapdoor, dan trapdoor yang bukan door tidak akan diaktifkan sebagai door.

Policy runtime dapat diubah melalui `PATCH /api/v1/settings/survival`. Nilai aktif juga tersedia pada `GET /api/v1/settings` dan snapshot dashboard.

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

Gunakan `bot:alias`, `class:nama`, `global`, atau `auto` sebagai selector. Status provider dan pool key dapat diperiksa melalui `GET /api/v1/ai/status`. Snapshot koordinasi berisi posisi, inventory, dan urutan bot terdekat tersedia melalui `GET /api/v1/ai/fleet`. Shared memory memakai `GET|POST /api/v1/memory`, `DELETE /api/v1/memory/:id`, dan `POST /api/v1/bots/:id/memory`; endpoint ini dilindungi bearer token bila token API dikonfigurasi.

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

## 11. Intelligence dan production

Profil production wajib memakai API token dan secara default memakai SQLite:

```env
MINEHIVE_PROFILE=production
MINEHIVE_API_TOKEN=token-panjang-dan-acak
MINEHIVE_DATABASE_DRIVER=sqlite
MINEHIVE_DATABASE_FILE=./data/minehive.sqlite
MINEHIVE_AUTONOMY_ENABLED=false
```

Autonomy sengaja nonaktif secara default. Tambahkan objective aman melalui `POST /api/v1/autonomy/objectives`, aktifkan melalui `POST /api/v1/autonomy/enabled`, lalu monitor `/health`, `/api/v1/hivemind/status`, `/api/v1/ml/status`, dan `/api/v1/autonomy/status`. Aksi autonomy dibatasi pada `collect`, `survey`, `farm`, `reforest`, `deforest`, `guard`, dan `status` serta tetap melewati consensus dan safety coordinator.

Tab **Settings** pada dashboard dapat memilih OpenRouter atau NVIDIA NIM, mengubah model/endpoint masing-masing, mengganti hingga tiga key per provider, memilih level log, membaca log runtime yang sudah disensor, serta mengatur autonomy dan objective. Perubahan ini berlaku sampai proses direstart; gunakan `.env` untuk konfigurasi permanen. Nilai key tidak pernah dikirim kembali ke browser.

Tombol **Edit & inventory** pada setiap kartu bot membuka detail inventory dan editor display name, username Minecraft, server, port, authentication, protocol version, command alias, kelompok/class, dan auto-connect. Inventory di dialog ikut diperbarui oleh snapshot dashboard tanpa menutup dialog atau menimpa kolom editor. Pengaturan koneksi hanya dapat diganti ketika bot offline; hal ini mencegah profil tersimpan berbeda dari koneksi yang sedang aktif.

Form LLM menyimpan draft provider, model, endpoint, dan key selama polling dashboard berjalan. Key OpenRouter maupun NVIDIA tetap dikosongkan setelah berhasil disimpan agar secret tidak tampil kembali. Request LLM dibatasi maksimal lima output token.

Tombol **Reset runtime settings** mengembalikan konfigurasi LLM, pool key kedua provider, level log, autonomy, dan policy lifecycle memory ke nilai saat aplikasi pertama dijalankan. Reset ini tidak menghapus profil bot, admin, record world/semantic memory, database, saved log, atau API token.

## Task queue dan laporan pekerjaan

Setiap bot memiliki antrean terpisah. Task dan command coordinator baru menunggu sampai pekerjaan bot tersebut selesai sehingga pathfinding yang aktif tidak diganti mendadak. Bot lain tetap dapat bekerja paralel. Dashboard menampilkan jumlah task menunggu dan bot yang sedang aktif. Command `stop` tetap bersifat eksplisit dan membatalkan pekerjaan berjalan beserta antreannya.

Batas antrean dapat diatur melalui `MINEHIVE_MAX_QUEUE_PER_BOT` (default `100`). Ketika batas tercapai, task baru ditolak dengan error yang jelas dan health check task queue berubah menjadi `DEGRADED` mulai dari saturasi 80%. Dashboard memakai polling tunggal dengan exponential backoff agar tab lambat atau rate limit tidak membuat request bertumpuk.

Saat pekerjaan dimulai bot mengirim pesan `task baru`, lalu mengirim `task selesai`, `task gagal`, atau `task dibatalkan` sesuai hasil sebenarnya. Lifecycle yang sama juga tersimpan sebagai structured event dan log.

Movement tidak lagi menggunakan dirt, cobblestone, atau item lain sebagai scaffolding otomatis. Tower 1x1, parkour, dan free-motion dinonaktifkan. Jika route membutuhkan penempatan blok atau tidak menghasilkan progres selama 10 detik, task gagal dengan error yang jelas agar antrean dapat melanjutkan task berikutnya.

Log terstruktur juga disimpan ke `MINEHIVE_LOG_DIRECTORY` atau `data/logs`. Setiap proses membuat satu file JSONL dan sistem hanya mempertahankan tiga file sesi terbaru; file yang lebih lama dihapus otomatis. Dashboard mengambil seluruh status berkala melalui satu endpoint snapshot agar polling tidak menghabiskan API rate limit.

Backup SQLite dapat dibuat dengan `node src/cli.js backup nama-backup.sqlite` atau `POST /api/v1/database/backup`. Untuk Docker gunakan `docker compose up -d --build`; data disimpan dalam volume `minehive-data`.

## 12. Batasan versi ini

- Pengujian otomatis menggunakan fake Minecraft client; koneksi nyata tergantung server, jaringan, akun, dan versi protokol.
- Koordinator mendukung intent aman `collect`, `craft`, `smelt`, `follow`, `come`, `move`, `set_home`, `home`, `survey`, `register_storage`, `store`, `retrieve`, `stock`, `farm`, `deforest`, `reforest`, `combat`, `remember`, `place`, `status`, dan `converse`.
- ML contextual-beta v2 menggabungkan evidence bot sendiri dan fleet berdasarkan intent, class, health, food, kapasitas inventory, ketersediaan alat, recency, durasi, serta kemiripan feature. Prediction hanya menentukan ranking/decision support dan tidak melewati safety rules.
- Semantic memory memakai embedding hash lokal deterministik. Konsolidasi short-term ke long-term sudah terjadwal dan deterministik; model embedding neural eksternal serta peringkasan berbasis LLM belum tersedia.
- Farming mendukung wheat, carrots, potatoes, dan beetroot. Combat memakai mob allowlist dan hanya bekerja pada entity yang sedang termuat oleh client.
- Pertukaran item membutuhkan kedua bot berada pada server dan dimension yang sama serta cukup dekat untuk saling mendatangi.
- Goal/task runtime belum direkonstruksi otomatis setelah process restart; SQLite saat ini mempersist memory, ML, HiveMind, autonomy, admin, dan profil bot.
