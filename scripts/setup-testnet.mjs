// Local setup only. The browser wallet holds the deployer key.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JsonRpcProvider } from 'ethers';
import { compileSplitter } from '../src/deployment/compile.mjs';
import { createSetupService } from '../src/deployment/setup-service.mjs';
import { createSetupApp } from '../src/deployment/setup-app.mjs';
import { createLocalNodeServer } from '../src/server/node-server.mjs';
import { startSetupTestnet } from '../src/server/start-testnet.mjs';

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
async function main() {
  const rpc = process.env.FINTREE_RPC_URL || 'https://sepolia.base.org';
  let valid = false;
  try { const url = new URL(rpc); valid = url.protocol === 'https:' && !url.username && !url.password; } catch {}
  if (!valid) throw new Error('An HTTPS RPC URL is required');
  const port = Number(process.env.FINTREE_SETUP_PORT || 4175);
  const provider = new JsonRpcProvider(rpc);
  try {
    const [html, css, bundle] = await Promise.all([
      fs.readFile(new URL('../public/setup.html', import.meta.url)), fs.readFile(new URL('../public/setup.css', import.meta.url)),
      build({ entryPoints: [fileURLToPath(new URL('../public/setup.js', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', write: false, target: 'es2022', minify: true, logLevel: 'silent' }),
    ]);
    const service = createSetupService({ provider, artifact: compileSplitter(), chainId: 84532n, token: USDC_BASE_SEPOLIA, directory: '.fintree-data/setup', startRuntime: startSetupTestnet });
    const origin = `http://127.0.0.1:${port}`;
    const app = createSetupApp({ service, origin, assets: { html, css, javascript: bundle.outputFiles[0].contents } });
    const web = createLocalNodeServer({ app, port });
    await web.listen();
    console.log(`Persiapan testnet lokal: ${origin}`);
    const stop = () => web.server.close(async () => { await service.stop(); provider.destroy(); });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) { provider.destroy(); throw error; }
}
main().catch(() => { console.error('Persiapan lokal gagal dimulai. Periksa konfigurasi dan koneksi.'); process.exitCode = 1; });
