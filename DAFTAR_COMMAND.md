# Referensi Lengkap Command MineHive

Dokumen ini adalah referensi tunggal untuk menjalankan dan mengendalikan MineHive. Isinya mengikuti command yang benar-benar didukung oleh kode versi saat ini.

## 1. Persiapan

Jalankan MineHive dari folder proyek:

```powershell
npm install
npm start
```

Dashboard default tersedia di `http://127.0.0.1:3000`.

Command Minecraft hanya diterima dari username yang terdaftar sebagai admin. Tambahkan admin melalui tab **Bots & Admins** di dashboard atau isi konfigurasi berikut:

```env
MINEHIVE_ADMINS=NamaPemain1,NamaPemain2
MINEHIVE_CHAT_COMMANDS=true
```

Bot harus sudah terhubung dan berstatus `READY`, `ACTIVE`, atau `PAUSED` agar dapat dipilih koordinator.

## 2. Format command Minecraft

Semua command chat dimulai dengan `!`, lalu selector, command, dan argumen:

```text
!<selector> <command> [argumen]
```

Tiga jenis selector tersedia:

| Selector | Contoh | Fungsi |
| --- | --- | --- |
| Alias bot | `!bot1 status` | Mengendalikan satu bot dengan command alias `bot1`. |
| Class bot | `!miner collect stone 32` | Mengendalikan semua bot dalam class `miner`. |
| Global | `!global survey 64` | Mengendalikan seluruh bot yang tersedia. |

Selector lama `!hive` tidak digunakan. Alias dan class dapat diedit melalui tombol **Edit & inventory** pada kartu bot.

Untuk command yang dapat dibagi, jumlah pekerjaan class/global dibagikan ke beberapa bot. Command baru masuk antrean bot dan tidak menghentikan pekerjaan yang sedang berlangsung. Gunakan `stop` jika pekerjaan memang harus dibatalkan.

## 3. Command status dan bantuan

### `help`

Menampilkan ringkasan command yang tersedia.

```text
!bot1 help
!miner help
!global help
```

### `status`

Menampilkan status runtime, health, food, dan posisi bot.

```text
!bot1 status
```

### `inventory`

Menampilkan ringkasan inventory bot di chat. Tampilan inventory yang lebih lengkap dan realtime tersedia melalui **Edit & inventory** di dashboard.

```text
!bot1 inventory
```

### `stop`

Menghentikan pathfinding dan aksi bot, lalu membatalkan task aktif dan antrean bot tersebut.

```text
!bot1 stop
!miner stop
!global stop
```

### Manual helping

Manual helping membagi task collect aktif milik bot owner kepada beberapa bot. Selector menentukan bot yang menjalankan command, sehingga helper harus dipanggil melalui selector helper dan owner disebut sebagai argumen.

#### `help <owner>`

Menjadikan bot terpilih sebagai helper untuk task collect aktif milik owner. Task owner harus dapat dibantu dan berada pada server serta dimension yang sama.

```text
!bot2 help bot1
!bot3 help bot1
```

Saat helper pertama masuk, task owner diambil alih secara aman menjadi collaborative. Sistem menghitung sisa target dari progress terverifikasi, bukan dari target awal.

#### `add helper <bot...>`

Meminta owner menambahkan satu atau beberapa helper sekaligus.

```text
!bot1 add helper bot2 bot3
```

Setiap tambahan divalidasi secara atomik: helper tidak boleh duplikat, maksimum empat helper per session, dan pembagian kerja tiap peserta harus minimal empat item.

#### `remove helper <bot>`

Mengeluarkan helper dari session owner.

```text
!bot1 remove helper bot2
```

Jika helper masih membawa hasil collect, sistem menghentikan pekerjaan baru, melakukan handoff ke destination, memverifikasi credit, lalu mengeluarkannya. Jika destination owner offline atau mati, command berhenti dengan status `WAITING_TRANSFER` tanpa menjatuhkan item sembarangan.

#### `stop help`

Helper keluar dari session yang sedang diikutinya.

```text
!bot2 stop help
```

Output yang belum diserahkan otomatis dihandoff dan diverifikasi sebelum helper keluar.

#### `helpers` dan `help status`

Menampilkan daftar helper owner atau status helping bot terpilih.

```text
!bot1 helpers
!bot2 help status
```

Helper hanya dapat bergabung bila berstatus `READY` atau `ACTIVE`, tidak sedang recovery, emergency, critical combat, atau user-critical task.

## 4. Command movement

### `come`

Membuat bot mendatangi admin yang mengirim command satu kali. Command ini berbeda dari `follow`.

```text
!bot1 come
```

### `follow [pemain]`

Membuat bot terus mengikuti pemain. Jika nama pemain tidak diberikan, bot mengikuti admin yang mengirim command.

```text
!bot1 follow
!bot1 follow Steve
```

### `goto <x> <y> <z>`

Menggerakkan bot ke koordinat tertentu menggunakan smart movement.

```text
!bot1 goto 100 64 -20
```

Ketiga koordinat wajib berupa angka. Movement otomatis tidak memakai tower 1x1, parkour, atau scaffolding block. Route yang membutuhkan penempatan block akan gagal dengan pesan jelas agar bot tidak berulang kali mencoba gerakan yang sama.

### `sethome [nama]`

Menyimpan posisi bot saat ini sebagai home. Nama default adalah `home`.

```text
!bot1 sethome
!bot1 sethome base
```

### `home [nama]`

Menggerakkan bot ke home yang sudah disimpan.

```text
!bot1 home
!bot1 home base
```

Home hanya dapat digunakan pada dimension tempat home tersebut dibuat.

## 5. Command resource, crafting, dan smelting

Nama block dan item sebaiknya memakai nama registry Minecraft, misalnya `oak_log`, `cobbled_deepslate`, `wooden_pickaxe`, atau `iron_ingot`.

### `collect <block> [jumlah]`

Mengumpulkan block. Jumlah default adalah `1` dan jumlah command koordinator dibatasi antara 1 sampai 64.

```text
!bot1 collect stone 16
!miner collect iron_ore 32
!global collect oak_log 64
```

Jika block membutuhkan alat, koordinator akan:

1. Memeriksa alat dalam inventory bot.
2. Mencari alat atau bahan dari bot terdekat pada server dan dimension yang sama.
3. Membuat alat dari semua alternatif resep yang valid.
4. Mengumpulkan bahan yang kurang bila memungkinkan.
5. Melakukan smelting bahan alat bila diperlukan.
6. Memulai mining setelah alat terverifikasi.

Alias bahasa natural yang dikenali parser lokal: `ambil` dan `kumpulkan`.

### `craft <item> [jumlah]`

Membuat item menggunakan alternatif resep yang sesuai dengan bahan nyata dalam inventory.

```text
!bot1 craft wooden_sword 1
!bot1 craft stone_pickaxe 1
!builder craft chest 4
```

Bot dapat menyiapkan bahan turunan dan crafting table secara otomatis. Resolver tidak mengunci resep pada jenis kayu tertentu dan dapat memilih material alternatif seperti `birch_planks` atau `cobbled_deepslate` bila resep Minecraft mengizinkannya.

Alias bahasa natural yang dikenali parser lokal: `buat`.

### `smelt <hasil> [jumlah]`

Memasak atau melebur item menggunakan furnace. Parameter item adalah nama hasil, bukan bahan mentah.

```text
!bot1 smelt iron_ingot 8
!bot1 smelt cooked_beef 4
!bot1 lebur besi 8
!bot1 masak daging_sapi 4
!global cook cooked_chicken 16
```

Alias command: `cook`, `masak`, dan `lebur`.

Target yang didukung meliputi:

- `iron_ingot`, `gold_ingot`, dan `copper_ingot`.
- `cooked_beef`, `cooked_porkchop`, `cooked_mutton`, `cooked_chicken`, dan `cooked_rabbit`.
- `cooked_cod`, `cooked_salmon`, `baked_potato`, dan `dried_kelp`.

Nama sederhana seperti `besi`, `sapi`, `ayam`, `salmon`, dan `kentang` dinormalisasi ke hasil smelting yang sesuai. Bot mencari furnace terdekat, membuat furnace jika belum ada, lalu menyiapkan input dan fuel. Hasil harus bertambah sesuai jumlah yang diminta sebelum task dinyatakan selesai.

### `shear`, `milk`, dan `sleep`

Menjalankan interaksi survival terverifikasi pada bot terpilih.

```text
!bot1 shear
!bot1 milk
!bot1 sleep
```

- `shear` mencari domba dewasa yang belum dicukur, memakai shears, lalu memverifikasi wool masuk ke inventory.
- `milk` mencari sapi dewasa, memakai bucket, lalu memverifikasi perubahan bucket menjadi `milk_bucket`.
- `sleep` mencari bed kosong terdekat, berjalan ke sana, dan hanya tidur bila waktu serta dimension mengizinkan.

Command akan gagal dengan pesan spesifik bila alat tidak tersedia, hewan atau bed tidak ditemukan, bed ditempati, inventory penuh, atau tidur tidak diizinkan.

## 6. Command eksplorasi dan shared memory

### `survey [radius]`

Memindai chunk yang sudah termuat di sekitar bot dan menyimpan penemuan penting ke shared world memory serta semantic memory. Radius default `64`, minimum `4`, dan maksimum `64` block.

```text
!scout survey 64
!scout scan 32
!scout jelajah 48
```

Alias command: `scan` dan `jelajah`. Struktur seperti village, stronghold, ancient city, dan trial chamber dapat disimpan otomatis ketika markernya terdeteksi.

### `remember <nama>` / `ingat <nama>`

Menyimpan posisi bot saat ini ke shared memory server dan dimension tersebut.

```text
!bot1 remember desa-utara
!bot1 ingat stronghold
```

Parser menentukan tipe memory dari kata `village`, `stronghold`, `base`, `farm`, atau `place` bila ada; selain itu tipe default adalah `place`.

### `place <nama>` / `tempat <nama>`

Mencari lokasi bernama dari shared memory dan menggerakkan bot ke jarak dua block dari lokasi itu.

```text
!bot2 place desa-utara
!bot2 tempat stronghold
```

Memory hanya dibagikan kepada bot pada server dan dimension yang sama.

## 7. Command logistics dan chest

Bot harus berada dekat chest, trapped chest, barrel, atau shulker box.

### `register_chest <nama> [radius]`

Mendaftarkan storage terdekat dengan nama persisten. Radius default `16` block.

```text
!bot1 register_chest gudang 16
!bot1 daftar_chest bahan 8
```

Alias command: `daftar_chest`. Bentuk natural `register_storage` juga dikenali koordinator.

### `store <item> [jumlah] [storage]`

Menyimpan item dari inventory bot ke storage terdaftar.

```text
!bot1 store stone 64 gudang
!bot1 simpan cobbled_deepslate 32 bahan
```

Alias command: `simpan`. Jika nama storage tidak diberikan, sistem memilih storage yang sesuai. Deposit dianggap berhasil hanya setelah perubahan slot inventory bot dan storage terverifikasi.

### `retrieve <item> [jumlah] [storage]`

Mengambil item dari storage. Sistem membuat reservasi stok dan lock agar dua bot tidak mengambil stok yang sama.

```text
!bot1 retrieve stone 32 gudang
!bot1 withdraw coal 16 bahan
!bot1 ambil_chest iron_ingot 8 gudang
```

Alias command: `withdraw` dan `ambil_chest`. Withdrawal dianggap berhasil hanya setelah kedua sisi transfer terverifikasi.

### `stock`

Menampilkan status storage dan stok pada world serta dimension bot.

```text
!bot1 stock
!bot1 stok
```

Alias command: `stok`.

## 8. Command farming dan kehutanan

### `farm [crop] [jumlah]`

Memanen crop matang, menanam kembali, dan mencangkul tanah bila dibutuhkan. Crop default adalah `wheat` dan jumlah default `1` untuk command chat langsung.

```text
!farmer farm wheat 16
!farmer farming carrots 16
!farmer bertani potatoes 16
```

Alias command: `farming`; bahasa natural `bertani` dikenali parser. Crop yang didukung adalah `wheat`, `carrots`, `potatoes`, dan `beetroot`. Jika hoe atau seed kurang, koordinator memakai pipeline inventory, donor bot, crafting, dan pengumpulan bahan.

### `deforest [jenis_log] [jumlah]`

Menebang seluruh batang pohon yang terhubung agar tidak ada pohon melayang. Jenis default `any`. Bot menanam sapling yang sesuai pada bekas pangkal bila tersedia dan menyimpan lokasi pohon ke shared memory.

```text
!lumber deforest any 4
!lumber deforest oak_log 8
!lumber tebang pohon 4
```

Bahasa natural `tebang` dikenali parser. Bot menyiapkan axe melalui sistem alat bersama.

### `reforest [jumlah]`

Menanam sapling pada lokasi `tree_site` yang tersimpan dalam shared memory.

```text
!lumber reforest 8
!lumber reboisasi 8
```

Bahasa natural `reboisasi` atau frasa `tanam pohon` dikenali parser.

## 9. Command combat

Bot tidak menargetkan pemain dan akan mundur jika health terlalu rendah.

### `guard [radius]` atau `guard <nama_tempat>`

Menjaga posisi saat ini atau lokasi dari shared memory, menyerang hostile mob, lalu kembali ke anchor.

```text
!guard guard 16
!guard guard desa-utara
!guard jaga desa-utara
```

### `combat [radius]`

Mengaktifkan mode `full_combat` untuk memburu hostile mob yang termuat di sekitar bot.

```text
!fighter combat 16
!fighter full_combat 16
!fighter serang 16
```

### `meat [radius]`

Memburu mob pasif penghasil makanan, seperti sapi, domba, babi, ayam, kelinci, dan mooshroom.

```text
!hunter meat 16
!hunter daging 16
```

Ketiga mode menyiapkan sword melalui inventory, donor terdekat, atau crafting. Gunakan `stop` untuk menghentikan state combat.

## 10. Command AI dan bahasa natural

### `ai <permintaan>`

Mengirim permintaan natural-language secara eksplisit ke koordinator LLM.

```text
!bot1 ai collect stone 16
!miner ai tolong kumpulkan kayu untuk membuat chest
!global ai survei daerah sekitar dan laporkan struktur penting
```

Teks natural juga dapat ditulis langsung setelah selector tanpa kata `ai`:

```text
!bot1 tebang pohon
!bot1 tolong bertani wheat 16
!bot1 berapa 1+1
!bot1 halo, keadaanmu bagaimana?
```

Dengan OpenRouter atau NVIDIA NIM aktif, permintaan diterjemahkan ke intent aman. Tanpa LLM, parser lokal tetap mengenali command baku, beberapa kata Indonesia/Inggris, dan operasi aritmetika sederhana. Output LLM dibatasi maksimal 5 token dan tidak memiliki akses shell atau API key.

## 11. Command Console di dashboard

Buka tab **Command Console**, lalu:

1. Pilih target berupa bot, class, atau global.
2. Tulis command tanpa awalan `!selector`.
3. Kirim command.

Contoh isi kolom command:

```text
collect stone 16
craft wooden_pickaxe 1
smelt iron_ingot 8
store stone 32 gudang
tolong tebang pohon dan tanam kembali
```

Nilai target dashboard diterjemahkan menjadi selector API berikut:

| Target dashboard | Selector API |
| --- | --- |
| Bot `bot1` | `bot:bot1` |
| Class `miner` | `class:miner` |
| Semua bot | `global` |
| Bot otomatis | `auto` |

## 12. Kontrol bot dan viewer di dashboard

Kontrol berikut berbentuk tombol, bukan command chat:

| Tombol | Fungsi |
| --- | --- |
| Start/Join | Menghubungkan bot ke server. |
| Stop/Disconnect | Memutus koneksi bot. |
| Edit & inventory | Mengedit profil dan melihat inventory realtime. |
| First person | Menjalankan kamera dari pandangan bot. |
| 3D area | Menjalankan viewer bebas untuk melihat lingkungan sekitar bot. |
| Stop viewer | Menghentikan viewer bot. |
| Add bot | Membuat profil bot baru. |
| Add admin | Memberi izin command chat kepada pemain. |
| Reset runtime settings | Mengembalikan setting LLM, log, dan autonomy ke nilai awal proses. |

Setiap viewer memakai port berbeda. Alamat viewer ditampilkan pada kartu kamera setelah berhasil dimulai.

## 13. Command terminal

Jalankan dari root proyek.

| Command | Fungsi |
| --- | --- |
| `npm start` | Menjalankan aplikasi dan dashboard. |
| `npm run dev` | Menjalankan aplikasi dalam watch mode. |
| `npm test` | Menjalankan seluruh pengujian. |
| `npm run health` | Memeriksa health sistem tanpa menjalankan server permanen. |
| `node src/cli.js start` | Bentuk langsung dari `npm start`. |
| `node src/cli.js status` | Menampilkan status aplikasi dalam JSON. |
| `node src/cli.js health` | Menampilkan health check dalam JSON. |
| `node src/cli.js backup nama.sqlite` | Membuat backup database SQLite ke folder backup data. |

Backup hanya tersedia jika `MINEHIVE_DATABASE_DRIVER=sqlite`. Nama backup wajib aman dan berakhiran `.sqlite`.

Untuk Docker:

```powershell
docker compose up -d --build
docker compose logs -f
docker compose down
```

## 14. REST API

Base URL default:

```text
http://127.0.0.1:3000
```

Jika `MINEHIVE_API_TOKEN` dikonfigurasi, semua endpoint selain halaman dashboard dan `/health` membutuhkan header:

```text
Authorization: Bearer TOKEN_ANDA
```

Contoh header dan request PowerShell:

```powershell
$baseUrl = 'http://127.0.0.1:3000'
$headers = @{ Authorization = 'Bearer TOKEN_ANDA' }

Invoke-RestMethod -Uri "$baseUrl/health"
Invoke-RestMethod -Uri "$baseUrl/api/v1/bots" -Headers $headers
```

### API command AI

Cara termudah menjalankan command melalui API:

```powershell
$body = @{
  selector = 'class:miner'
  text = 'collect stone 32'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/api/v1/ai/command" `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body
```

Selector valid: `auto`, `global`, `bot:<alias>`, dan `class:<nama>`.

### API aksi langsung bot

Gunakan ID internal bot pada URL, bukan selalu command alias:

```powershell
$botId = 'worker-1'
```

| Action | Body JSON | Fungsi |
| --- | --- | --- |
| `navigate` | `{"x":100,"y":64,"z":-20}` | Navigasi Pathfinder. |
| `move` | `{"x":100,"y":64,"z":-20}` | Smart movement. |
| `collect` | `{"block":"stone","count":16}` | Collect melalui koordinator. |
| `survey` | `{"radius":64}` | Survei area termuat. |
| `follow` | `{"username":"Steve"}` | Mengikuti pemain. |
| `come` | `{"username":"Steve"}` | Mendatangi pemain satu kali. |
| `farm` | `{"crop":"wheat","count":16}` | Farming melalui koordinator. |
| `deforest` | `{"log":"oak_log","count":4}` | Menebang pohon. |
| `reforest` | `{"count":8}` | Menanam ulang. |
| `combat` | `{"mode":"guard","radius":16}` | Menjalankan combat state. |
| `sethome` | `{"name":"base"}` | Menyimpan home. |
| `home` | `{"name":"base"}` | Kembali ke home. |
| `craft` | `{"item":"chest","count":1}` | Crafting melalui koordinator. |
| `smelt` | `{"item":"iron_ingot","count":8}` | Smelting melalui koordinator. |
| `chat` | `{"message":"MineHive aktif"}` | Mengirim pesan chat. |
| `observe` | `{}` | Menjalankan capability observasi. |
| `stop` | `{}` | Menghentikan aksi dan task aktif. |

Format request:

```powershell
$body = @{ block = 'stone'; count = 16 } | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "$baseUrl/api/v1/bots/$botId/actions/collect" `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body
```

### Daftar seluruh endpoint

#### Sistem, dashboard, dan settings

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/health` | Health check tanpa bearer token. |
| `GET` | `/api/v1/system/status` | Status aplikasi. |
| `GET` | `/api/v1/dashboard/snapshot` | Snapshot gabungan dashboard. |
| `GET` | `/api/v1/metrics` | Metrics runtime. |
| `GET` | `/api/v1/modules` | Status module. |
| `GET` | `/api/v1/plugins` | Status plugin. |
| `GET` | `/api/v1/settings` | Semua runtime settings. |
| `PATCH` | `/api/v1/settings/llm` | Mengubah provider, model, endpoint, dan maksimal tiga key. |
| `PATCH` | `/api/v1/settings/log` | Mengubah level log. |
| `GET` | `/api/v1/settings/logs?limit=100` | Membaca log runtime terbaru. |
| `GET` | `/api/v1/settings/log-files` | Daftar file log tersimpan. |
| `GET` | `/api/v1/settings/log-files/:name?limit=1000` | Membaca satu file log. |
| `PATCH` | `/api/v1/settings/autonomy` | Mengubah setting autonomy. |
| `PATCH` | `/api/v1/settings/memory` | Mengubah limit, TTL, ambang promosi, dan interval konsolidasi memory. |
| `POST` | `/api/v1/settings/reset` | Reset runtime settings. |

Contoh mengatur LLM:

```powershell
$body = @{
  provider = 'openrouter'
  openRouterEndpoint = 'https://openrouter.ai/api/v1'
  openRouterModel = 'openrouter/auto'
  openRouterApiKeys = @('OR_KEY_1', 'OR_KEY_2', 'OR_KEY_3')
  nvidiaEndpoint = 'https://integrate.api.nvidia.com/v1'
  nvidiaModel = 'meta/llama-3.1-8b-instruct'
  nvidiaApiKeys = @('NV_KEY_1', 'NV_KEY_2', 'NV_KEY_3')
} | ConvertTo-Json

Invoke-RestMethod -Method Patch -Uri "$baseUrl/api/v1/settings/llm" -Headers $headers -ContentType 'application/json' -Body $body
```

Gunakan `{"clearOpenRouterKeys":true}` atau `{"clearNvidiaKeys":true}` untuk menghapus pool key provider terkait. API key tidak pernah dikirim kembali oleh endpoint settings.

#### Bot, admin, camera, dan memory bot

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/bots` | Daftar bot. |
| `POST` | `/api/v1/bots` | Membuat profil bot. |
| `GET` | `/api/v1/bots/:id` | Snapshot satu bot. |
| `PATCH` | `/api/v1/bots/:id` | Mengedit profil bot. |
| `DELETE` | `/api/v1/bots/:id` | Menghapus profil bot. |
| `POST` | `/api/v1/bots/:id/start` | Menghubungkan bot. |
| `POST` | `/api/v1/bots/:id/stop` | Memutus bot. |
| `POST` | `/api/v1/bots/:id/camera/start` | Menjalankan viewer dengan body `{"mode":"surrounding"}` atau `{"mode":"first_person"}`. |
| `POST` | `/api/v1/bots/:id/camera/stop` | Menghentikan viewer. |
| `POST` | `/api/v1/bots/:id/memory` | Menyimpan memory dari konteks posisi bot. |
| `POST` | `/api/v1/bots/:id/actions/:action` | Menjalankan action bot dari tabel sebelumnya. |
| `GET` | `/api/v1/admins` | Daftar admin. |
| `POST` | `/api/v1/admins` | Menambah admin dengan body `{"username":"Steve"}`. |
| `DELETE` | `/api/v1/admins/:username` | Menghapus admin. |

#### Goal dan task queue

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/goals` | Daftar goal. |
| `POST` | `/api/v1/goals` | Membuat goal terstruktur. |
| `GET` | `/api/v1/goals/:id` | Detail goal dan task. |
| `POST` | `/api/v1/goals/:id/run` | Menjalankan goal. |
| `POST` | `/api/v1/goals/:id/cancel` | Membatalkan goal; body `{"reason":"alasan"}`. |
| `GET` | `/api/v1/tasks` | Daftar seluruh task. |
| `GET` | `/api/v1/tasks/queue` | Status antrean. |
| `GET` | `/api/v1/tasks/:id` | Detail task. |
| `POST` | `/api/v1/tasks/:id/cancel` | Membatalkan task; body `{"reason":"alasan"}`. |

#### Manual helping

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/help/status` | Ringkasan health dan jumlah HelpSession. |
| `POST` | `/api/v1/help/request` | Meminta helper dengan body `{"helperBotId":"bot2","ownerBotId":"bot1"}`. |
| `GET` | `/api/v1/help/sessions` | Daftar HelpSession beserta WorkShare. |
| `POST` | `/api/v1/help/sessions` | Membuat HelpSession terstruktur. |
| `GET` | `/api/v1/help/sessions/:id` | Detail satu HelpSession. |
| `POST` | `/api/v1/help/sessions/:id/execute` | Menjalankan WorkShare; body berisi `shareId` dan opsional `botId`. |
| `POST` | `/api/v1/help/sessions/:id/collected` | Mencatat output collect terverifikasi. |
| `POST` | `/api/v1/help/sessions/:id/join` | Menambah satu helper; body `{"botId":"bot2"}`. |
| `POST` | `/api/v1/help/sessions/:id/join-many` | Menambah beberapa helper; body `{"botIds":["bot2","bot3"]}`. |
| `POST` | `/api/v1/help/sessions/:id/leave` | Mengeluarkan helper dan melakukan auto handoff bila diperlukan. |
| `POST` | `/api/v1/help/sessions/:id/handoff` | Menyerahkan output WorkShare yang sudah siap. |
| `POST` | `/api/v1/help/sessions/:id/recovery` | Rekonsiliasi output helper setelah recovery. |

#### AI, memory, ML, dan HiveMind

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/ai/status` | Status koordinator dan LLM. |
| `GET` | `/api/v1/ai/fleet` | Posisi, inventory, dan bot terdekat. |
| `POST` | `/api/v1/ai/command` | Menjalankan command natural-language. |
| `GET` | `/api/v1/memory` | Mencari world memory. |
| `POST` | `/api/v1/memory` | Menambah world memory. |
| `DELETE` | `/api/v1/memory/:id` | Menghapus world memory. |
| `GET` | `/api/v1/memory/semantic` | Mencari semantic memory. |
| `POST` | `/api/v1/memory/semantic` | Menambah semantic memory. |
| `DELETE` | `/api/v1/memory/semantic/:id` | Menghapus satu semantic memory. |
| `GET` | `/api/v1/memory/short-term` | Mencari short-term memory. |
| `POST` | `/api/v1/memory/short-term` | Menambah short-term memory. |
| `GET` | `/api/v1/memory/long-term` | Mencari long-term memory. |
| `POST` | `/api/v1/memory/long-term` | Menambah long-term memory. |
| `POST` | `/api/v1/memory/recall` | Recall memory yang relevan. |
| `POST` | `/api/v1/memory/consolidate` | Menjalankan konsolidasi memory. |
| `GET` | `/api/v1/memory/dashboard` | Browser gabungan world dan semantic memory dengan filter serta pagination. |
| `GET` | `/api/v1/ml/status` | Status model ML. |
| `GET` | `/api/v1/ml/models` | Daftar model ML. |
| `GET` | `/api/v1/hivemind/status` | Status HiveMind. |
| `GET` | `/api/v1/hivemind/locks` | Daftar distributed lock. |
| `GET` | `/api/v1/hivemind/state` | Shared Hive state. |
| `GET` | `/api/v1/hivemind/decisions` | Riwayat keputusan consensus. |
| `POST` | `/api/v1/hivemind/messages` | Menerbitkan pesan HiveMind. |
| `POST` | `/api/v1/hivemind/state` | Menulis shared state. |
| `POST` | `/api/v1/hivemind/proposals` | Membuat proposal consensus. |

#### Autonomy, logistics, dan database

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/autonomy/status` | Status autonomy. |
| `GET` | `/api/v1/autonomy/objectives` | Daftar objective. |
| `POST` | `/api/v1/autonomy/objectives` | Membuat objective. |
| `DELETE` | `/api/v1/autonomy/objectives/:id` | Menghapus objective. |
| `POST` | `/api/v1/autonomy/tick` | Menjalankan satu tick autonomy manual. |
| `POST` | `/api/v1/autonomy/enabled` | Mengaktifkan/nonaktifkan dengan body `{"enabled":true}`. |
| `GET` | `/api/v1/logistics/status` | Ringkasan logistics. |
| `GET` | `/api/v1/logistics/storages` | Storage dan stok; dapat difilter dengan `worldKey` dan `dimension`. |
| `GET` | `/api/v1/logistics/reservations` | Daftar reservasi stok. |
| `GET` | `/api/v1/logistics/transfers` | Audit transfer. |
| `GET` | `/api/v1/logistics/timeline?limit=100` | Timeline logistics. |
| `GET` | `/api/v1/logistics/locks` | Lock storage aktif. |
| `POST` | `/api/v1/logistics/reservations/:id/release` | Melepas reservasi; body `{"requesterBotId":"bot-id"}`. |
| `GET` | `/api/v1/database/status` | Status database. |
| `POST` | `/api/v1/database/backup` | Membuat backup SQLite; body `{"name":"backup.sqlite"}`. |

## 15. Goal terstruktur melalui API

Gunakan goal ketika satu pekerjaan terdiri dari beberapa langkah berurutan:

```powershell
$goalBody = @{
  description = 'Pergi ke hutan lalu kumpulkan kayu'
  priority = 60
  steps = @(
    @{
      name = 'pergi'
      type = 'navigate'
      input = @{ x = 100; y = 64; z = -20 }
      requiredCapabilities = @('minecraft.navigation')
    },
    @{
      name = 'ambil-kayu'
      type = 'collect'
      input = @{ block = 'oak_log'; count = 16 }
      requiredCapabilities = @('minecraft.collection')
      dependencies = @('pergi')
    }
  )
} | ConvertTo-Json -Depth 8

$goal = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/goals" -Headers $headers -ContentType 'application/json' -Body $goalBody
$goalId = $goal.data.id

Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/goals/$goalId/run" -Headers $headers
Invoke-RestMethod -Uri "$baseUrl/api/v1/goals/$goalId" -Headers $headers
```

## 16. Aturan penting dan troubleshooting command

- Gunakan username admin yang sama persis dengan nama pemain Minecraft.
- Gunakan command alias pada chat, tetapi gunakan ID internal bot pada sebagian besar URL API.
- Gunakan underscore pada nama registry: `wooden_pickaxe`, bukan `wooden pickaxe`.
- Pastikan bot berada di server dan dimension yang sama untuk donor item dan shared memory.
- Pastikan chest sudah didaftarkan sebelum `store` atau `retrieve`.
- Pastikan chest berada dalam jangkauan dan tidak sedang dikunci operasi lain.
- `come` hanya mendatangi pemain sekali; `follow` terus mengikuti pemain.
- `stop` membatalkan aksi dan task; disconnect bot menggunakan tombol Stop atau endpoint `/bots/:id/stop`.
- Command yang gagal akan mengirim pesan `failed: <penyebab>` dan mencatat error terstruktur pada log.
- Jika API mengembalikan `401`, periksa bearer token.
- Jika API mengembalikan `429`, tunggu nilai header `Retry-After`; dashboard menggunakan snapshot dan backoff agar tidak terus menambah request.
- Maksimal tiga key dapat disimpan secara terpisah untuk OpenRouter dan NVIDIA NIM. Key berikutnya dipakai saat key aktif menerima status 401, 402, atau 429.
- Untuk melihat penyebab task, buka tab **Logs** dan **Log files** di Settings, atau jalankan `npm run health`.
