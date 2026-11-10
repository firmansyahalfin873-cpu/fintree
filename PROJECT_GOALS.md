# Fintree — Tujuan dan Pelaksanaan Proyek

## Tujuan utama

Membangun dan memvalidasi Fintree sebagai payment gateway kripto non-custodial untuk developer dan merchant digital: merchant dapat membuat tagihan melalui API, pembeli membayar melalui checkout, dan merchant menerima USDC serta pemberitahuan pembayaran yang dapat diverifikasi.

Dokumen ini adalah rencana kerja awal berdasarkan dua dokumen Fintree yang diberikan founder. Contoh kode dan klaim di dokumen sumber merupakan bahan rancangan, bukan bukti bahwa sistem sudah aman atau siap produksi. Keputusan yang belum dikonfirmasi ditandai sebagai asumsi atau keputusan terbuka.

## Peran dan cara kerja

**Founder:** menetapkan arah dan prioritas bisnis, memilih target pelanggan, model biaya, jaringan dan aset awal, serta membuat keputusan yang membutuhkan otoritas bisnis, akses akun, dana, atau komitmen eksternal.

**Executor:** menerjemahkan arah tersebut menjadi spesifikasi, desain, kode, pengujian, dokumentasi, dan laporan kemajuan; mengidentifikasi risiko dan pilihan; serta melanjutkan pekerjaan mandiri yang telah diotorisasi. Executor tidak mengklaim tindakan selesai tanpa bukti dan tidak mengirim pesan atau membuat komitmen atas nama founder tanpa instruksi.

Setiap milestone memiliki hasil yang dapat ditinjau dan kriteria selesai. Perubahan keputusan, risiko, dan hal yang memerlukan founder dicatat di proyek. Pekerjaan bisa berjalan bertahap; urutan tidak melarang pekerjaan paralel bila dependensinya terpenuhi.

## Sasaran produk

1. **Integrasi merchant yang sederhana.** Merchant dapat membuat dan membaca checkout session dengan API yang terdokumentasi, serta menerima webhook yang dapat diverifikasi.
2. **Pembayaran yang benar dan dapat dibuktikan.** Invoice hanya dinyatakan lunas setelah bukti on-chain diverifikasi terhadap kontrak, jaringan, invoice, penerima, dan nominal yang tepat, dengan perlindungan pemrosesan ganda.
3. **Settlement non-custodial.** Pada jalur yang didukung, kontrak meneruskan pembayaran ke merchant dan biaya protokol ke treasury dalam transaksi atomik, tanpa menjadikan kontrak sebagai tempat penyimpanan dana merchant.
4. **Checkout yang jelas.** Pembeli melihat merchant, nominal, rincian biaya, jaringan, masa berlaku, dan status transaksi yang akurat.
5. **Pengalaman developer yang bisa digunakan.** Dashboard, panduan, contoh integrasi, SDK, dan informasi keamanan merefleksikan fungsi yang benar-benar tersedia.
6. **Omnichain yang terverifikasi.** Pembayaran dari jaringan atau aset lain ditambahkan setelah jalur settlement dasar bekerja, dengan penanganan status dan kegagalan bridge secara nyata.

## Milestone dan kriteria selesai

### 0 — Penyelarasan dan spesifikasi

- Inventarisasi kebutuhan dan perbedaan kedua dokumen; tetapkan batas MVP, alur pengguna, model ancaman awal, serta keputusan yang belum dibuat.
- Tentukan jaringan dan aset untuk pengujian awal, definisi biaya dan pembulatan, masa berlaku invoice, status pembayaran, serta tanggung jawab gas.
- **Selesai bila:** spesifikasi dan daftar keputusan terbuka tersedia, dependensi dan risiko teridentifikasi, dan tidak ada klaim yang menganggap fitur rancangan sudah berjalan.

### 1 — Fondasi dan kontrak pembayaran

- Siapkan struktur proyek, lingkungan pengembangan, konfigurasi aman, dan alur pengujian.
- Bangun kontrak dan skema quote yang mengikat parameter pembayaran serta mencegah replay dan pembayaran ganda. Evaluasi penggunaan permit berdasarkan kemampuan token dan desain penanggung gas yang benar.
- **Selesai bila:** kontrak dan alur penandatanganan lolos kompilasi dan pengujian bermakna untuk pembayaran berhasil, parameter berubah, kedaluwarsa, replay, dan kegagalan transfer; hasil settlement dapat diperiksa di jaringan uji.

### 2 — API, data, dan verifikasi pembayaran

- Bangun onboarding dan autentikasi merchant, pengelolaan API key, invoice, checkout session, dan penyimpanan data dengan kontrol akses.
- Verifikasi event dari kontrak dan jaringan yang diharapkan, termasuk kecocokan invoice, penerima, jumlah dan status finalitas; tangani duplikasi dan perubahan status secara aman.
- **Selesai bila:** pengujian menunjukkan invoice yang tepat berubah status sekali saja berdasarkan bukti pembayaran yang valid, dan bukti tidak relevan atau tidak valid ditolak.

### 3 — Webhook, SDK, dan integrasi developer

- Bangun webhook bertanda tangan, pencatatan, percobaan ulang, idempotensi, serta mekanisme verifikasi penerima; sediakan SDK dan contoh integrasi.
- **Selesai bila:** merchant contoh dapat membuat sesi, memverifikasi webhook, dan memproses event sekali meskipun ada pengiriman ulang; kegagalan pengiriman tercatat dan dapat dicoba kembali.

### 4 — Dashboard, checkout, dan situs

- Bangun landing page, dashboard merchant, hosted checkout, dokumentasi, halaman keamanan, dan status berdasarkan sistem desain dokumen.
- Pastikan responsif, dapat diakses, penanganan gagal jelas, dan status maupun klaim publik mencerminkan kemampuan sebenarnya.
- **Selesai bila:** alur merchant dan pembeli dapat diuji ujung ke ujung di lingkungan uji, halaman utama dapat digunakan pada perangkat seluler dan desktop, dan dokumentasi cocok dengan implementasi.

### 5 — Omnichain dan kesiapan peluncuran

- Integrasikan dan uji rute lintas jaringan/aset yang dipilih, termasuk estimasi biaya, perubahan harga, waktu tunggu, kegagalan, dan rekonsiliasi.
- Tuntaskan tinjauan keamanan, pengujian ujung ke ujung, pemantauan, prosedur pemulihan, dan evaluasi kebutuhan hukum serta kepatuhan yang relevan bersama pihak yang berwenang.
- **Selesai bila:** seluruh rute yang akan ditawarkan telah lolos pengujian dan tinjauan yang sesuai; batas layanan dan risiko diketahui; konfigurasi produksi dan keputusan peluncuran tersedia. Tidak ada klaim audit atau kesiapan produksi tanpa bukti.

## Ukuran keberhasilan awal

- Alur dasar merchant → invoice → pembayaran → verifikasi → webhook berhasil di lingkungan uji dan dapat diulang.
- Pembayaran tidak valid, duplikat, salah nominal, salah invoice, salah kontrak, dan transaksi gagal tidak menghasilkan status lunas.
- Biaya, jumlah yang diterima merchant, biaya jaringan, dan status transaksi ditampilkan secara akurat sesuai jalur yang benar-benar didukung.
- Dokumentasi memungkinkan integrator mencoba alur tanpa mengandalkan informasi rahasia atau instruksi di luar proyek.
- Target numerik bisnis seperti jumlah merchant, volume, dan tingkat konversi ditetapkan founder setelah validasi pasar; belum diasumsikan di sini.

## Asumsi awal dan keputusan founder

Asumsi kerja awal dari dokumen: target pengguna adalah indie developer dan SaaS; settlement awal menggunakan USDC di Base; biaya protokol yang diusulkan 0,3%; checkout dan API merupakan inti produk. Ini belum merupakan keputusan final atau janji kemampuan produksi.

Keputusan yang perlu dipastikan sesuai urutan kebutuhan:

1. Siapa pelanggan pertama dan masalah utama yang ingin divalidasi?
2. Apakah USDC di Base menjadi jalur pertama, dengan omnichain menyusul setelah jalur dasar tervalidasi?
3. Apakah biaya 0,3% dan pilihan penanggung biaya merupakan model awal yang diinginkan? Bagaimana biaya gas dan bridge ditampilkan dan ditanggung?
4. Apa nama dan identitas produk final: Fintree atau XPAY?
5. Akun, domain, treasury, anggaran operasional, wilayah layanan, dan akses apa yang tersedia saat tahap terkait tiba?

## Status awal

- Dokumen sumber telah dibaca dan diringkas dalam percakapan.
- Folder proyek awalnya kosong; belum ada implementasi, pengujian, deployment, atau audit yang dibuktikan.
- Spesifikasi MVP, alur pembayaran, kriteria penerimaan, risiko, dan keputusan awal tersedia di `MVP_SPEC.md`.
- Fondasi perhitungan nominal dan biaya tersedia beserta pengujian otomatis; hasil tersebut belum membuktikan alur pembayaran atau keamanan sistem secara keseluruhan.
- Prototipe kontrak splitter dan pengujian blockchain lokal tersedia. Pengujian lokal mencakup pembayaran, replay, perubahan quote, deadline, domain dan kegagalan transfer; belum ada pengujian di jaringan uji publik atau audit.
- Prototipe memakai signer dan treasury permanen, token standar yang dikonfigurasi saat deploy, serta approval biasa; rotasi kunci, permit, relayer dan dukungan token lain belum dibuat.
- Pemeriksa bukti pembayaran mencocokkan receipt dan event terhadap invoice tepercaya, memeriksa chain, blok kanonis, deadline serta jumlah konfirmasi. Pengujian menggunakan transaksi blockchain lokal; pemantauan reorganisasi berkelanjutan belum tersedia.
- Pembuatan quote terhubung dengan perhitungan biaya dan tanda tangan kontrak. Pengujian lokal mencakup pembayaran dengan biaya ditanggung merchant dan pembeli, lalu verifikasi receipt.
- Rancangan skema Postgres privat dan pencatatan status lunas serta antrean event dalam satu operasi telah diuji secara lokal. Pencatatan ulang tidak membuat event ganda, dan kegagalan antrean membatalkan perubahan status. Skema ini belum diterapkan atau diuji pada proyek Supabase.
- Format dan verifikasi tanda tangan webhook, antrean percobaan ulang, pengaturan endpoint, dan penyimpanan secret terenkripsi tersedia di layanan testnet. Pengiriman dan proteksi alamat tujuan telah diuji dengan jaringan tiruan; endpoint nyata dan review keamanan independen masih diperlukan. Protokol ada di `docs/webhooks.md`.
- Event webhook baru mencantumkan versi skema dan waktu pembuatan yang tetap pada setiap percobaan ulang. Event yang telah terantre dari versi sebelumnya tidak diubah secara diam-diam.
- Merchant dapat menjadwalkan ulang webhook miliknya yang berstatus gagal melalui dashboard atau SDK. Riwayat dan nomor percobaan tetap tersimpan. Pengujian lokal mencakup tombol dashboard, isolasi merchant, status yang tidak dapat dicoba ulang, batas percobaan baru, dan pengiriman berhasil melalui transport tiruan.
- Layanan pembuatan dan pembacaan checkout session menyimpan quote, membatasi pembacaan menurut merchant, dan mencegah duplikasi menggunakan idempotency key. Belum ada deployment publik.
- Endpoint checkout dan onboarding berbasis tanda tangan wallet telah diuji secara lokal dengan kunci API uji. Kunci dapat dicabut, challenge hanya dipakai sekali, dan akses antar-merchant dibatasi; proteksi produksi seperti pembatasan laju dan pengelolaan sesi masih diperlukan.
- Dashboard membatalkan hasil login yang masih berjalan jika akun wallet berubah sebelum tanda tangan selesai. Skenario perubahan akun tersebut telah diuji dengan wallet tiruan.
- Dashboard menyimpan penanda percobaan pembuatan tagihan tanpa kunci API atau rincian pesanan dalam bentuk teks. Pada browser yang mendukung penyimpanan lokal, retry data yang sama setelah respons hilang dan halaman dimuat ulang memakai kunci idempotensi yang sama. Pengujian lokal menunjukkan hanya satu tagihan dibuat; jika penyimpanan browser dimatikan, perlindungan lintas reload tidak tersedia.
- Pemindaian event menyimpan posisi pemeriksaan, menggunakan lease dan pengulangan blok, serta memeriksa transaksi yang menunggu konfirmasi. Loop polling pada layanan testnet lokal juga memeriksa perubahan blok pembayaran yang sudah dianggap lunas dan mencatat insiden serta event untuk peninjauan manual. Pengujian masih lokal; review keamanan, monitoring operasional, dan pengujian jaringan nyata masih diperlukan.
- Dashboard testnet dapat menampilkan keadaan proses pemantauan dan worker webhook secara lokal, termasuk ketika siklus gagal atau terlambat. Indikator ini tidak membuktikan sinkronisasi penuh atau keberhasilan pengiriman dan bukan sistem alert eksternal.
- Invoice yang melewati batas waktu kini ditandai kedaluwarsa, tetapi pembayaran sah yang terjadi tepat waktu masih dapat direkonsiliasi bila ditemukan terlambat. Konfirmasi yang berubah akibat reorganisasi sebelum finalitas dikembalikan ke status menunggu atau kedaluwarsa; pengujian dilakukan secara lokal.
- `npm run demo` menjalankan alur simulasi lengkap secara lokal dengan data sementara dan penerima webhook simulasi. Tidak ada pembayaran sungguhan atau layanan publik yang digunakan.
- `npm run preview` menyediakan halaman workspace dan checkout simulasi lokal yang menggunakan database, wallet, dan dana sementara. Ini belum dashboard dan checkout produksi; seluruh data hilang ketika server dihentikan.
- Pratinjau simulasi diperiksa di Chrome desktop dan dengan viewport ponsel 390 piksel. Pada viewport ponsel, pembuatan tagihan dan pembayaran simulasi menghasilkan status lunas; ini bukan pengujian MetaMask atau jaringan publik.
- Endpoint checkout publik hanya mengembalikan data pembayaran yang diperlukan. Halaman testnet terhubung ke wallet dan memvalidasi quote serta konfigurasi deployment sebelum meminta approval dan transaksi. Logika halaman dan wallet diuji menggunakan DOM tiruan dan blockchain lokal, belum diperiksa secara visual atau diuji di jaringan publik.
- Checkout menyimpan petunjuk permintaan wallet dan hash transaksi di browser agar tombol pembayaran tetap dinonaktifkan setelah halaman dimuat ulang ketika hasilnya belum pasti. Penolakan eksplisit dari wallet membuka kembali tombol; gangguan lain memerlukan pemeriksaan. Petunjuk ini bukan bukti lunas dan bergantung pada penyimpanan browser; verifikasi akhir tetap dilakukan server.
- SDK server awal mendukung pembuatan dan pembacaan sesi serta verifikasi webhook, dan diuji dengan handler API lokal. SDK belum dipublikasikan sebagai paket.
- Pembuatan sesi mendukung URL kembali opsional dan metadata privat terbatas. Metadata tidak dikembalikan di checkout publik; URL hanya ditampilkan sebagai tautan setelah pembayaran terverifikasi. Pembaruan skema PGlite memerlukan migrasi lokal eksplisit untuk database lama.
- Contoh penerima webhook merchant tersedia secara lokal, dengan pemeriksaan tanda tangan, deduplikasi transaksional, dan penanganan pemberitahuan peninjauan yang datang lebih dahulu. Contoh belum menerima webhook melalui endpoint HTTPS nyata dan bukan sistem pemenuhan pesanan produksi.
- Layanan testnet lokal dan database yang menetap telah disiapkan, bersama halaman wallet, pemantau berjalan, pengaturan webhook, worker pengiriman, dan pemeriksaan konfigurasi kontrak saat startup. Penyimpanan dan HTTP diuji dengan jaringan lokal; kontrak belum dipasang atau alur diuji di Base Sepolia, dan pengiriman ke endpoint nyata belum diuji.
- Persiapan deployment Base Sepolia tersedia sebagai pemeriksaan read-only, bersama script deployment yang mencadangkan catatan sebelum pengiriman dan menolak menimpa catatan lama. Keduanya diuji dengan blockchain lokal; belum ada transaksi deployment yang dikirim ke jaringan publik.
- Halaman persiapan lokal untuk deployment melalui ekstensi wallet telah dibuat. Layanan menyimpan signer aplikasi dan kunci webhook secara terenkripsi serta memeriksa kode, alamat, dan catatan transaksi sebelum pengiriman. Backend, alur halaman dengan wallet tiruan, dan memulai layanan telah diuji menggunakan blockchain lokal. Halaman belum diuji secara visual bersama ekstensi wallet nyata; webhook belum diuji ke endpoint nyata dan deployment publik belum dilakukan.
- Bila file signer atau rencana hilang sementara catatan terkait masih ada, persiapan berhenti untuk pemulihan dari cadangan tanpa membuat signer atau rencana pengganti. Kondisi file hilang diuji secara lokal.
- Identitas publik kunci enkripsi webhook diikat ke catatan deployment saat layanan dimulai. File kunci yang hilang atau tidak cocok menghentikan startup agar konfigurasi lama tidak diam-diam memakai kunci baru; jalur lama dengan database ada tetapi kunci hilang juga ditolak. Pengujian menggunakan data sementara.
- Halaman persiapan dapat memeriksa dan memperbarui saldo ETH uji dari wallet yang terhubung pada Base Sepolia. Ini telah diuji dengan wallet tiruan; hasilnya bukan jaminan biaya transaksi cukup.
- Halaman persiapan menyediakan permintaan untuk memilih atau menambahkan Base Sepolia di wallet, dengan konfirmasi oleh pengguna. Jalur jaringan yang sudah ada, belum ada, ditolak, dan gagal berpindah diuji dengan wallet tiruan; belum diuji dengan ekstensi nyata.
- Persiapan yang dibuka ulang memperbarui saldo dan estimasi unit gas sebelum transaksi baru; catatan transaksi yang sudah dibuat tetap terlihat saat RPC terputus. Pengujian masih menggunakan blockchain dan wallet simulasi.
- Jika hash deployment gagal tercatat setelah transaksi terkirim, halaman dapat memeriksa hash dari wallet dan mencocokkannya dengan catatan yang sudah dicadangkan sebelum memperbarui status. Hash yang tidak ditemukan atau tidak cocok ditolak; pengujian menggunakan wallet dan blockchain simulasi.
- Migrasi database PGlite lokal yang dikenal kini dapat dijalankan secara eksplisit dan transaksional; data merchant dan invoice dipertahankan dan skema yang tidak dikenal ditolak untuk pemeriksaan manual. Ini tidak menerapkan migrasi ke Supabase. Merchant juga dapat mengatur nama yang tampil pada checkout testnet.
- Jika database lokal yang dikenal memerlukan migrasi, halaman persiapan memberi pesan khusus untuk menghentikan layanan dan membuat cadangan sebelum pembaruan. Proyek tidak menjalankan migrasi secara otomatis; skema yang tidak dikenal tetap memerlukan pemeriksaan manual.
- Merchant testnet dapat melihat prefix kunci API, membuat kunci baru, dan mencabut kunci miliknya melalui dashboard atau SDK. Kunci mentah tidak ditampilkan kembali; pengujian lokal mencakup isolasi merchant, pencabutan kunci sesi, dan paginasi.
- Simulator dalam kode telah dipindahkan dari Ganache ke Hardhat 3; Node.js minimum untuk proyek menjadi 22.13. Audit lockfile melaporkan tiga temuan tinggi terkait Hardhat/zod dan tidak ada temuan kritis. Salinan Ganache yang tidak lagi dipakai dapat masih berada di `node_modules`, dan pratinjau lama yang sedang berjalan masih memakainya. Rincian tercatat di `docs/dependency-review.md`.
- Langkah berikutnya: verifikasi halaman dengan ekstensi wallet, lalu uji deployment, pembayaran, dan webhook secara nyata di Base Sepolia.
