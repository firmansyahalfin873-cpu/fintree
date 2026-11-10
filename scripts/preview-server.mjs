// LOCAL SIMULATION ONLY. Do not expose this server to the Internet.
import http from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createLocalChain } from '../src/testing/local-chain.mjs';
import solc from 'solc';
import { BrowserProvider, ContractFactory, Wallet } from 'ethers';
import { PGlite } from '@electric-sql/pglite';
import { createOnboardingHandler } from '../src/api/onboarding-handler.mjs';
import { createCheckoutHandler } from '../src/api/checkout-handler.mjs';
import { scanPayments } from '../src/payments/scan-payments.mjs';
import { deliverNextWebhook } from '../src/webhooks/deliver-next.mjs';
import { generateWebhookSecret, verifyWebhook } from '../src/webhooks/signature.mjs';

const port = Number(process.env.FINTREE_PREVIEW_PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid FINTREE_PREVIEW_PORT');
const origin = `http://127.0.0.1:${port}`;
const require = createRequire(import.meta.url);
const files = ['contracts/FintreeSplitter.sol', 'contracts/test/TestToken.sol'];
const sources = Object.fromEntries(files.map((file) => [file, { content: fs.readFileSync(file, 'utf8') }]));
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }), { import: (file) => {
  try { return { contents: fs.readFileSync(require.resolve(file), 'utf8') }; } catch { return { error: 'Missing import' }; }
} }));
const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join('\n'));
const rpc = await createLocalChain();
const db = new PGlite();
await db.exec(fs.readFileSync('db/schema-draft.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/local-migrations/003-checkout-details.sql', 'utf8'));
const provider = new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }), payer = await provider.getSigner(0), treasury = await provider.getSigner(1);
const signer = new Wallet(Object.values(rpc.getInitialAccounts())[0].secretKey);
async function deploy(file, name, args = []) {
  const artifact = output.contracts[file][name];
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, payer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
const token = await deploy('contracts/test/TestToken.sol', 'TestToken');
const splitter = await deploy('contracts/FintreeSplitter.sol', 'FintreeSplitter', [token.target, await treasury.getAddress(), signer.address]);
await (await token.approve(splitter.target, 1_000_000_000n)).wait();
const config = { chainId: (await provider.getNetwork()).chainId, contract: splitter.target, token: token.target, signerAddress: signer.address, tokenDecimals: 6, feeBps: 30, ttlSeconds: 900 };
const merchant = Wallet.createRandom(), trustedOrigin = `http://localhost:${port}`;
const onboarding = createOnboardingHandler({ db, origin: trustedOrigin });
async function internalPost(handler, path, body, headers = {}) {
  return handler(new Request(`${trustedOrigin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
}
const challengeResponse = await internalPost(onboarding, '/api/v1/wallet/challenge', { wallet: merchant.address });
if (!challengeResponse.ok) throw new Error('Could not create simulated merchant');
const challenge = await challengeResponse.json();
const registered = await internalPost(onboarding, '/api/v1/wallet/complete', { id: challenge.id, nonce: challenge.nonce, signature: await merchant.signMessage(challenge.message) });
if (!registered.ok) throw new Error('Could not verify simulated merchant');
const credentials = await registered.json();
const checkout = createCheckoutHandler({ db, signer, config, checkoutOrigin: origin });
const webhookSecret = generateWebhookSecret();
let paying = false;
const paths = { '/': ['public/landing.html', 'text/html; charset=utf-8'], '/developers': ['public/developers.html', 'text/html; charset=utf-8'], '/developers.js': ['public/developers.js', 'text/javascript; charset=utf-8'], '/workspace-nav.js': ['public/workspace-nav.js', 'text/javascript; charset=utf-8'], '/site-nav.js': ['public/site-nav.js', 'text/javascript; charset=utf-8'], '/help': ['public/help.html', 'text/html; charset=utf-8'], '/help.js': ['public/help.js', 'text/javascript; charset=utf-8'], '/security': ['public/security.html', 'text/html; charset=utf-8'], '/pricing': ['public/pricing.html', 'text/html; charset=utf-8'], '/pricing.js': ['public/pricing.js', 'text/javascript; charset=utf-8'], '/dashboard': ['public/index.html', 'text/html; charset=utf-8'], '/landing.css': ['public/landing.css', 'text/css; charset=utf-8'], '/landing.js': ['public/landing.js', 'text/javascript; charset=utf-8'], '/payment-flow-art.png': ['public/payment-flow-art.png', 'image/png'], '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'] };
function respond(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); }
async function bodyOf(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Error('Request too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function sessionById(id) {
  const response = await checkout(new Request(`${trustedOrigin}/api/v1/checkout/sessions/${id}`, { headers: { authorization: `Bearer ${credentials.apiKey}` } }));
  return response.ok ? response.json() : null;
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}` || (req.method === 'POST' && req.headers.origin !== origin)) return respond(res, 403, { error: 'Akses ditolak' });
    const pathname = new URL(req.url, origin).pathname;
    if (req.method === 'GET' && (paths[pathname] || /^\/pay\/0x[0-9a-f]{64}$/.test(pathname))) {
      const [file, type] = paths[pathname] || paths['/dashboard'];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      return res.end(fs.readFileSync(file));
    }
    if (req.method === 'GET' && pathname === '/api/demo/sessions') {
      const rows = (await db.query('select id from fintree_private.invoices where merchant_id=$1 order by created_at desc limit 50', [credentials.merchantId])).rows;
      return respond(res, 200, { sessions: await Promise.all(rows.map((row) => sessionById(row.id))) });
    }
    const detail = /^\/api\/demo\/sessions\/(0x[0-9a-f]{64})$/.exec(pathname);
    if (req.method === 'GET' && detail) { const session = await sessionById(detail[1]); return session ? respond(res, 200, session) : respond(res, 404, { error: 'Tagihan tidak ditemukan' }); }
    if (req.method === 'POST' && pathname === '/api/demo/sessions') {
      const body = await bodyOf(req);
      const response = await internalPost(checkout, '/api/v1/checkout/sessions', body, { authorization: `Bearer ${credentials.apiKey}`, 'idempotency-key': randomUUID() });
      return respond(res, response.status, await response.json());
    }
    const pay = /^\/api\/demo\/pay\/(0x[0-9a-f]{64})$/.exec(pathname);
    if (req.method === 'POST' && pay) {
      if (paying) return respond(res, 409, { error: 'Pembayaran lain sedang diproses' });
      const session = await sessionById(pay[1]);
      if (!session) return respond(res, 404, { error: 'Tagihan tidak ditemukan' });
      if (session.status === 'paid') return respond(res, 200, { status: 'paid' });
      paying = true;
      try {
        const quote = { invoiceId: session.id, token: session.token, merchant: session.merchant, merchantAmount: session.merchantAmount, protocolFee: session.protocolFee, deadline: session.deadline };
        const receipt = await (await splitter.payInvoice(quote, session.signature)).wait();
        const results = await scanPayments({ db, provider: new BrowserProvider(rpc, undefined, { cacheTimeout: -1 }), chainId: config.chainId, contract: config.contract, fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber, confirmations: 1 });
        if (results[0]?.status !== 'paid') throw new Error('Payment not confirmed');
        await deliverNextWebhook({ db, getDeliveryConfig: async () => ({ url: 'https://simulation.invalid/hook', secret: webhookSecret }), transport: async ({ body, headers }) => ({ status: verifyWebhook(body, headers['x-fintree-signature'], webhookSecret) ? 200 : 400 }) });
        return respond(res, 200, { status: 'paid' });
      } finally { paying = false; }
    }
    return respond(res, 404, { error: 'Tidak ditemukan' });
  } catch { return respond(res, 400, { error: 'Permintaan gagal. Periksa nilai tagihan dan coba lagi.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Fintree simulasi lokal: ${origin}`));
async function stop() { server.close(); await db.close(); await rpc.disconnect(); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
