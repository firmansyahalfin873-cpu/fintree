// Local demonstration endpoint; expose only via an appropriately secured HTTPS relay.
import http from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { initializeMerchantExample, receiveMerchantWebhook } from '../examples/merchant-webhook.mjs';

const secret = process.env.FINTREE_EXAMPLE_WEBHOOK_SECRET;
if (!/^whsec_[0-9a-f]{64}$/.test(secret || '')) throw new Error('Configure FINTREE_EXAMPLE_WEBHOOK_SECRET securely');
const port = Number(process.env.FINTREE_EXAMPLE_PORT || 4180);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const db = new PGlite(process.env.FINTREE_EXAMPLE_DATABASE_PATH || '.fintree-data/merchant-example');
await initializeMerchantExample(db);
const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/webhook') { response.writeHead(404).end(); return; }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 65536) { response.writeHead(413).end(); return; } chunks.push(chunk); }
    const result = await receiveMerchantWebhook({ db, secret, body: Buffer.concat(chunks), signature: request.headers['x-fintree-signature'] });
    response.writeHead(result.status).end();
  } catch { response.writeHead(500).end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local merchant example: http://127.0.0.1:${port}/webhook`));
async function stop() { await new Promise((resolve) => server.close(resolve)); await db.close(); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
