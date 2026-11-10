# SDK developer — rancangan awal

SDK server tersedia secara lokal di `src/sdk/index.mjs`; paket npm dan server publik belum tersedia. API key test hanya disimpan di server merchant. Nominal dikirim sebagai string desimal, sedangkan nilai dalam respons menggunakan string satuan terkecil token. Simpan dan gunakan kembali idempotency key yang sama saat mencoba ulang pesanan yang sama.

```js
import { FintreeClient, verifyWebhook } from './src/sdk/index.mjs';

const client = new FintreeClient({
  apiKey: process.env.FINTREE_API_KEY,
  baseUrl: process.env.FINTREE_API_BASE_URL,
});

const session = await client.createCheckoutSession(
  { orderId: 'ORDER-123', amount: '15.00', feePayer: 'customer',
    returnUrl: 'https://merchant.example/thanks', metadata: { campaign: 'spring' } },
  { idempotencyKey: 'order-123-attempt-1' },
);

// Redirect pembeli ke session.checkoutUrl yang dikembalikan server.

const current = await client.getCheckoutSession(session.id);
// Pada penerima webhook, gunakan body mentah sebelum JSON diparse:
const valid = verifyWebhook(rawBodyBuffer, signatureHeader, webhookSecret);
```

Penerima webhook perlu menyimpan ID event dan memprosesnya secara idempoten. Lihat [protokol webhook](webhooks.md) untuk format tanda tangan dan batasan saat ini. Contoh di atas menunjukkan antarmuka, bukan alamat layanan yang sudah diterbitkan.

`returnUrl` dan `metadata` bersifat opsional. URL kembali harus HTTPS (HTTP hanya untuk localhost saat pengujian); tautan ditampilkan setelah pembayaran terverifikasi dan tidak dibuka otomatis. Metadata dibatasi 20 pasangan kunci dan nilai teks serta 4 KB total, dikembalikan hanya melalui API merchant, dan tidak masuk checkout publik. Jangan gunakan metadata untuk menyimpan rahasia. Perubahan kedua nilai ini dengan idempotency key yang sama menghasilkan konflik.

Contoh penerima yang dapat dijalankan tersedia di `examples/merchant-webhook.mjs` dan `scripts/merchant-webhook-example.mjs`. Dengan Node.js dan dependensi proyek, sediakan secret testnet yang diberikan dashboard sebagai variabel proses `FINTREE_EXAMPLE_WEBHOOK_SECRET`, lalu jalankan `npm run example:webhook`. Contoh mendengarkan di `127.0.0.1:4180/webhook`, memverifikasi byte mentah, menyimpan ID event dan memperbarui status contoh dalam satu transaksi database. Status peninjauan dipertahankan bila event datang di luar urutan. Ini hanya demonstrasi, bukan pemenuhan pesanan otomatis atau penerima produksi.

Worker Fintree hanya mengirim ke tujuan HTTPS publik yang lolos pemeriksaan; alamat lokal contoh tidak dapat didaftarkan langsung. Pengujian pengiriman nyata memerlukan endpoint HTTPS publik atau relay yang Anda kendalikan dan konfigurasi terpisah. Jangan menaruh secret dalam kode, URL, atau chat. Database contoh disimpan di `.fintree-data/merchant-example`.

Pengelolaan kunci tersedia melalui `client.listApiKeys()`, `client.createApiKey()`, dan `client.revokeApiKey(id)`. Simpan kunci baru dari respons pembuatan secara aman; daftar hanya memuat prefix. Ketika `listApiKeys` mengembalikan `nextCursor`, panggil kembali dengan `{ startingAfter: nextCursor }` untuk membaca halaman berikutnya. Kunci yang digunakan suatu integrasi perlu diganti sebelum dicabut.
