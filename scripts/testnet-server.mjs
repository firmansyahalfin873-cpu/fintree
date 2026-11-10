// Local testnet prototype. Never expose this server or use it with real funds.
import { JsonRpcProvider, Wallet } from 'ethers';
import { openLocalDatabase } from '../src/storage/local-database.mjs';
import { validateDeployment } from '../src/server/validate-deployment.mjs';
import { createApp } from '../src/server/app.mjs';
import { createLocalNodeServer } from '../src/server/node-server.mjs';
import { loadTestnetAssets } from '../src/server/testnet-assets.mjs';
import { runScannerCycle } from '../src/payments/scanner-cycle.mjs';
import { runScannerLoop } from '../src/payments/scanner-loop.mjs';
import { createWebhookSettings } from '../src/webhooks/settings.mjs';
import { deliverNextWebhook } from '../src/webhooks/deliver-next.mjs';
import { createWebhookTransport } from '../src/webhooks/https-transport.mjs';
import { createRuntimeStatus } from '../src/server/runtime-status.mjs';

async function main() {
const port = Number(process.env.FINTREE_PORT || 4174);
const startBlock = Number(process.env.FINTREE_START_BLOCK);
const rpcUrl = process.env.FINTREE_RPC_URL;
let rpcIsHttps = false;
try { rpcIsHttps = Boolean(rpcUrl) && new URL(rpcUrl).protocol === 'https:'; } catch { /* Generic error below; never print credentials. */ }
if (!rpcIsHttps || !process.env.FINTREE_QUOTE_SIGNER_KEY || !process.env.FINTREE_CONTRACT || !process.env.FINTREE_TOKEN || !process.env.FINTREE_START_BLOCK || !Number.isSafeInteger(startBlock) || startBlock < 0) {
  throw new Error('Configure the testnet RPC, signer, contract, token and deployment block before starting.');
}
const provider = new JsonRpcProvider(rpcUrl), signer = new Wallet(process.env.FINTREE_QUOTE_SIGNER_KEY);
const deployment = await validateDeployment({ provider, signer, chainId: 84532n, contract: process.env.FINTREE_CONTRACT, token: process.env.FINTREE_TOKEN, tokenDecimals: 6 });
const assets = await loadTestnetAssets();
const db = await openLocalDatabase(process.env.FINTREE_DATABASE_PATH || '.fintree-data/testnet');
const masterKey = process.env.FINTREE_WEBHOOK_MASTER_KEY;
if (masterKey && !/^[0-9a-f]{64}$/i.test(masterKey)) { await db.close(); provider.destroy(); throw new Error('Invalid webhook master key'); }
const webhookSettings = masterKey ? createWebhookSettings({ db, masterKey: Buffer.from(masterKey, 'hex') }) : null;
try { if (webhookSettings) await webhookSettings.assertKey(); } catch (error) { await db.close(); provider.destroy(); throw error; }
const config = { chainId: deployment.chainId, contract: deployment.contract, token: deployment.token, signerAddress: deployment.signer, tokenDecimals: deployment.tokenDecimals, feeBps: 30, ttlSeconds: 900 };
const origin = `http://127.0.0.1:${port}`;
const runtimeStatus = createRuntimeStatus({ webhookEnabled: Boolean(webhookSettings) });
const app = createApp({ db, signer, config, origin, assets, webhookSettings, runtimeStatus });
const web = createLocalNodeServer({ app, port });
const controller = new AbortController();
try { await web.listen(); } catch (error) { await db.close(); provider.destroy(); throw error; }
const scanner = runScannerLoop({ signal: controller.signal, runCycle: runtimeStatus.track('scanner', () => runScannerCycle({ db, provider, chainId: config.chainId, contract: config.contract, startBlock, confirmations: 20 })), onError: () => console.error('Payment monitor failed; it will retry.') });
const webhookWorker = webhookSettings ? runScannerLoop({ signal: controller.signal, intervalMs: 3000, runCycle: runtimeStatus.track('webhook', () => deliverNextWebhook({ db, getDeliveryConfig: (merchantId) => webhookSettings.getForDelivery(merchantId), transport: createWebhookTransport(), configuredOnly: true })), onError: () => console.error('Webhook worker failed; it will retry.') }) : Promise.resolve();
console.log(`Fintree testnet API: ${origin} (Base Sepolia only)`);
async function stop() {
  controller.abort();
  await new Promise((resolve) => web.server.close(resolve));
  await scanner;
  await webhookWorker;
  await db.close();
  provider.destroy();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
}
main().catch(() => { console.error('Unable to start local testnet service. Check configuration and connectivity.'); process.exitCode = 1; });
