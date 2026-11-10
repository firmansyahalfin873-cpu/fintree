# Fintree — Spesifikasi MVP dan Keputusan Kerja

Status: rancangan kerja, 8 November 2026. Sumber: dua dokumen Fintree yang diberikan founder dan PROJECT_GOALS.md. Pilihan di bawah merupakan asumsi yang dapat diubah; tidak menyatakan bahwa produk sudah berjalan.

## Hasil yang akan dibuktikan

Seorang developer merchant dapat membuat invoice melalui API, membuka checkout, menerima pembayaran token uji pada jaringan uji EVM, dan menerima webhook setelah pembayaran dicocokkan dengan bukti on-chain. Pembeli dapat melihat biaya dan status sebenarnya. Merchant dan treasury menerima dana secara atomik sesuai quote yang disepakati.

Jalur pertama dirancang untuk USDC di Base; pengujian awal memakai aset dan jaringan uji yang dikonfigurasi secara eksplisit. Jalur cross-chain, gas yang disponsori, dan peluncuran mainnet tetap sasaran proyek, tetapi bukan prasyarat membuktikan alur dasar ini. Nama Fintree adalah nama kerja.

## Peran dan alur

1. **Merchant** membuktikan kepemilikan wallet melalui tantangan bertanda tangan yang memiliki nonce, masa berlaku, domain, dan perlindungan replay. Merchant memperoleh kredensial API dan secret webhook melalui jalur terautentikasi; API key mentah hanya ditampilkan saat dibuat atau dirotasi.
2. Server merchant membuat sesi dengan nominal, ID pesanan, opsi penanggung biaya, URL kembali opsional dan metadata terbatas. API memvalidasi input, mengikat invoice ke merchant serta konfigurasi jaringan dan kontrak, dan mengembalikan URL checkout serta waktu kedaluwarsa. Idempotency key mencegah pembuatan tagihan ganda karena retry; penggunaan kunci yang sama dengan isi berbeda ditolak.
3. **Pembeli** melihat identitas merchant, rincian nilai dan biaya, aset, jaringan, batas waktu, serta biaya gas yang terpisah. Pembeli menghubungkan wallet dan menyetujui pembayaran; antarmuka menyajikan status sebenarnya dan kesalahan yang dapat ditindaklanjuti.
4. Kontrak memverifikasi quote dan batas waktu, mencegah penggunaan ulang invoice, lalu mentransfer bagian merchant dan protokol secara atomik. Quote terikat pada chain, kontrak, token, invoice, penerima, nominal, dan deadline. Strategi rotasi signer dan treasury harus dirancang sebelum produksi.
5. Backend mengamati transaksi secara independen dari browser. Backend memeriksa keberhasilan receipt serta event dari kontrak dan chain yang ditetapkan, dan mencocokkan invoice, penerima, token/konfigurasi, nominal serta transaksi dengan catatan invoice. Status final diberikan hanya setelah kebijakan konfirmasi dan penanganan reorganisasi rantai diterapkan. Klien tidak dapat menetapkan status lunas hanya dengan mengirim hash.
6. Setelah settlement memenuhi kebijakan finalitas, sistem mencatat event dan tugas webhook secara atomik. Pengiriman webhook dilakukan di luar transaksi database, ditandatangani dan dicoba ulang; merchant memverifikasi tanda tangan dan mengabaikan event yang sudah diproses.

## Aturan nominal dan biaya awal

- Nilai uang disimpan dan dihitung sebagai bilangan bulat dalam unit terkecil token; untuk contoh aset dengan 6 desimal, 1 USDC = 1.000.000 unit. Input desimal dikonversi secara tepat tanpa floating point, dan presisi berlebih ditolak.
- Asumsi biaya protokol 30 basis poin (0,3%) dari nominal invoice. Hasil pecahan unit terkecil dibulatkan ke unit terdekat, dengan tepat setengah dibulatkan ke atas. Batas nominal minimum/maksimum perlu ditetapkan sebelum produksi.
- Jika biaya ditanggung pembeli: merchant menerima nominal invoice; pembeli membayar nominal ditambah biaya protokol. Jika ditanggung merchant: pembeli membayar nominal invoice; merchant menerima nominal dikurangi biaya protokol. Gas dan biaya rute eksternal terpisah dan tidak disebut bebas tanpa mekanisme pendanaan nyata.
- Setiap sesi menyimpan nilai atomik yang disepakati, basis poin, pihak penanggung biaya, dan versi perhitungan; perubahan harga di kemudian hari tidak mengubah quote yang sudah dibuat.

## Status pembayaran

| Status | Arti | Transisi yang diizinkan |
| --- | --- | --- |
| `pending` | Invoice aktif, belum ada pembayaran yang tervalidasi. | `confirming`, `expired` |
| `confirming` | Event pembayaran cocok telah ditemukan, menunggu kebijakan finalitas. | `paid`, `pending` bila event dibatalkan oleh reorganisasi, atau `expired` bila masa berlaku berlalu tanpa event valid |
| `paid` | Bukti valid telah memenuhi kebijakan finalitas. | Terminal dalam alur normal; anomali pascafinalitas ditangani sebagai insiden, bukan diam-diam diabaikan. |
| `expired` | Waktu pembayaran berakhir tanpa pembayaran valid yang diketahui. | `confirming` jika rekonsiliasi menemukan event valid yang terjadi sebelum deadline. |

Masa berlaku awal adalah 15 menit sebagaimana contoh sumber. Waktu event pada chain dan aturan kontrak menentukan apakah pembayaran diajukan tepat waktu; waktu penemuan oleh backend saja tidak boleh menolak pembayaran yang sah. Jika event yang ditemukan terlambat kemudian hilang karena reorganisasi, status kembali ke `expired` apabila deadline telah lewat. Status UI menunggu konfirmasi berbeda dari status berhasil.

## API dan webhook yang perlu tersedia

- Pembuatan sesi terautentikasi dengan idempotency key; detail sesi untuk merchant dibatasi menurut kepemilikan. Checkout publik hanya menerima data yang memang diperlukan pembeli, tanpa kredensial atau metadata privat.
- Kontrak respons memiliki ID stabil, nilai atomik sebagai string, mata uang, status, masa berlaku, dan URL checkout. Semua input divalidasi, termasuk alamat, nominal, URL, metadata dan ukuran permintaan; kegagalan mengembalikan kesalahan yang dapat ditindaklanjuti.
- Setiap event webhook memiliki ID stabil, tipe, waktu, versi skema, dan data yang diperlukan. Tanda tangan HMAC mencakup timestamp dan byte payload asli; penerima membatasi umur tanda tangan dan membandingkan tanda tangan secara konstan. Pengiriman bersifat at-least-once, sehingga konsumen harus idempoten.
- Retry memiliki batas dan jeda bertambah, catatan setiap percobaan dan sarana penanganan setelah gagal. Alamat tujuan webhook perlu divalidasi dan dilindungi terhadap akses ke jaringan internal, termasuk redirect dan resolusi DNS.

## Permukaan produk

- Landing page menjelaskan fitur yang benar-benar tersedia, biaya serta batasannya.
- Dashboard menyediakan onboarding, ringkasan invoice, pengelolaan API key dan webhook, serta pengaturan merchant sesuai otorisasi.
- Checkout responsif menampilkan keadaan loading, butuh wallet/jaringan, siap bayar, transaksi tertunda, konfirmasi, berhasil, kedaluwarsa, ditolak, dan gagal.
- Dokumentasi dan SDK memuat quickstart, contoh session, verifikasi webhook, kesalahan, dan environment uji. Halaman keamanan dan status hanya menampilkan informasi yang dapat dibuktikan.
- Sistem visual mengikuti slate gelap, indigo, hijau, dan tipografi developer dari dokumen desain; aksesibilitas dan keterbacaan tetap diperlukan.

## Pemeriksaan penerimaan

1. Pembayaran valid menghasilkan tepat satu settlement, satu perubahan status final, dan satu event bisnis stabil meskipun transaksi, pemindaian, atau webhook diulang.
2. Receipt gagal, event dari kontrak/chain lain, invoice salah, nilai salah, signature berubah, quote kedaluwarsa, dan invoice yang telah diproses tidak dapat menghasilkan pembayaran valid.
3. Pembayaran sebelum deadline yang baru ditemukan sesudahnya tetap direkonsiliasi; reorganisasi sebelum finalitas tidak meninggalkan status lunas palsu.
4. Nilai dan biaya dalam contoh kecil, nilai batas, dan nilai dengan enam desimal dihitung secara deterministik; presisi berlebih dan input tidak valid ditolak.
5. Merchant tidak dapat mengakses data merchant lain; API key dan secret tidak bocor dalam checkout publik, log, atau respons kesalahan.
6. Webhook gagal dicoba ulang sesuai kebijakan; penerima contoh dapat memverifikasi byte payload asli dan menangani pengiriman ganda.
7. Integrator baru dapat menjalankan alur uji dari dokumentasi, termasuk melihat kegagalan dan status konfirmasi, tanpa kredensial produksi.

## Risiko dan dependensi

Kontrak dan quote memerlukan pengujian keamanan yang memadai; finalitas chain dan reorganisasi membutuhkan kebijakan yang eksplisit. Pengelolaan kunci, autentikasi wallet, penyimpanan, layanan RPC, pengiriman webhook, dan perlindungan penyalahgunaan merupakan dependensi operasional. Perilaku token permit dan router harus dibuktikan untuk jaringan dan aset yang dipilih. Peninjauan hukum dan kepatuhan disesuaikan dengan wilayah dan model layanan sebelum peluncuran.

## Keputusan terbuka founder

Target pelanggan pertama, nama final, jaringan dan aset peluncuran, kebijakan fee/gas, wilayah layanan, anggaran, dan identitas treasury belum dikonfirmasi. Asumsi kerja ini tidak memberi otorisasi untuk mengeluarkan dana, menggunakan akun, atau meluncurkan layanan atas nama founder.
