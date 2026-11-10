import { openLocalDatabase } from '../storage/local-database.mjs';
import { validateDeployment } from './validate-deployment.mjs';
import { createApp } from './app.mjs';
import { createLocalNodeServer } from './node-server.mjs';
import { loadTestnetAssets } from './testnet-assets.mjs';
import { runScannerCycle } from '../payments/scanner-cycle.mjs';
import { runScannerLoop } from '../payments/scanner-loop.mjs';
import { createWebhookSettings } from '../webhooks/settings.mjs';
import { deliverNextWebhook } from '../webhooks/deliver-next.mjs';
import { createWebhookTransport } from '../webhooks/https-transport.mjs';
import { createRuntimeStatus } from './runtime-status.mjs';

// The setup process already owns the provider and the decrypted signer in memory.
export async function startSetupTestnet({ provider, signer, record, plan, webhookMasterKey, port = 4174, databasePath = '.fintree-data/testnet' }) {
  if (record.status !== 'deployed' || !Number.isSafeInteger(record.blockNumber) || record.blockNumber < 0) throw new Error('Deployment not confirmed');
  const deployment = await validateDeployment({ provider, signer, chainId: 84532n, contract: record.contract, token: plan.token, tokenDecimals: 6 });
  if (deployment.treasury !== plan.treasury) throw new Error('Treasury mismatch');
  const assets = await loadTestnetAssets();
  const db = await openLocalDatabase(databasePath);
  let webhookSettings;
  try { webhookSettings = createWebhookSettings({ db, masterKey: webhookMasterKey }); await webhookSettings.assertKey(); }
  catch (error) { await db.close(); throw error; }
  const config = { chainId: deployment.chainId, contract: deployment.contract, token: deployment.token, signerAddress: deployment.signer, tokenDecimals: deployment.tokenDecimals, feeBps: 30, ttlSeconds: 900 };
  const origin = `http://127.0.0.1:${port}`;
  const runtimeStatus = createRuntimeStatus({ webhookEnabled: true });
  const app = createApp({ db, signer, config, origin, assets, webhookSettings, runtimeStatus });
  const web = createLocalNodeServer({ app, port });
  try { await web.listen(); } catch (error) { await db.close(); throw error; }
  const controller = new AbortController();
  const scanner = runScannerLoop({ signal: controller.signal, runCycle: runtimeStatus.track('scanner', () => runScannerCycle({ db, provider, chainId: config.chainId, contract: config.contract, startBlock: record.blockNumber, confirmations: 20 })), onError: () => console.error('Payment monitor failed; it will retry.') });
  const webhookWorker = runScannerLoop({ signal: controller.signal, intervalMs: 3000, runCycle: runtimeStatus.track('webhook', () => deliverNextWebhook({ db, getDeliveryConfig: (merchantId) => webhookSettings.getForDelivery(merchantId), transport: createWebhookTransport(), configuredOnly: true })), onError: () => console.error('Webhook worker failed; it will retry.') });
  let closed = false;
  return { origin, async stop() {
    if (closed) return; closed = true;
    controller.abort();
    await new Promise((resolve) => web.server.close(resolve));
    await scanner; await webhookWorker; await db.close();
  } };
}
