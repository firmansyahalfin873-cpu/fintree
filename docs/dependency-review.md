# Catatan pemeriksaan dependensi

Pada 9 November 2026, simulator lokal di kode proyek diganti dari Ganache ke Hardhat 3. Setelah perubahan lockfile, `npm audit` melaporkan tiga temuan tingkat tinggi yang terkait Hardhat dan `zod`, tanpa temuan kritis. Temuan tersebut tetap memerlukan peninjauan; daftar advisory bukan bukti bahwa setiap masalah dapat dieksploitasi pada proyek ini. Hardhat 3 memerlukan Node.js 22.13 atau lebih baru; komputer pengembangan saat pemeriksaan memakai Node.js 24.

Ketiga entri tersebut menunjuk pada satu [advisory Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) tentang penggunaan memori saat memvalidasi koleksi besar. Simulator proyek membuat konfigurasi dan sepuluh akun sementara sendiri; jalur yang ditinjau tidak meneruskan koleksi dari permintaan HTTP ke konfigurasi Hardhat. Ini adalah penilaian batas penggunaan saat ini, bukan bukti bahwa masalah tidak dapat dieksploitasi pada semua jalur atau di lingkungan lain. Simulator tidak boleh diekspos sebagai layanan RPC publik.

Percobaan terisolasi memaksa Zod 4.6.7 menghilangkan entri audit, tetapi konfigurasi yang sengaja dibuat tidak valid gagal dengan `TypeError` di dalam Hardhat. Hardhat yang dipakai mengandalkan API Zod 3 yang [berubah pada Zod 4](https://zod.dev/v4/changelog). Override tersebut tidak diterapkan; pembaruan harus menunggu versi Hardhat yang kompatibel atau alternatif yang diuji menyeluruh.

Sebelum pembaruan, `solc` memasang `tmp` 0.2.6, yang termasuk versi terdampak [GHSA-7c78-jf6q-g5cm](https://github.com/advisories/GHSA-7c78-jf6q-g5cm). Override mempertahankan versi compiler yang sama, tetapi memakai `tmp` 0.2.7. Periksa kembali override ini ketika `solc` memperbarui dependensinya.

Repositori [Ganache telah diarsipkan](https://github.com/ConsenSys-archive/ganache). Ganache tidak lagi dicantumkan sebagai dependensi proyek, tetapi salinannya dapat masih berada di `node_modules` sebagai paket tidak digunakan, dan pratinjau lama yang sedang berjalan masih memakainya sampai dihentikan. Penggantian diuji dengan simulasi lokal, bukan dengan jaringan publik. Jangan menjalankan demo atau simulator pada jaringan publik atau dengan data dan dana sungguhan. Alur persiapan testnet juga memakai `solc` dan `esbuild` sebagai alat pengembangan, sehingga instalasi tanpa dev dependencies belum menjadi paket runtime yang lengkap.

Audit dependensi dapat berubah seiring advisory baru dan tidak menggantikan review kode, kontrak, atau pengujian keamanan independen.
