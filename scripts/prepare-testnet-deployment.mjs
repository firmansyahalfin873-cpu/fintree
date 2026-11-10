import { JsonRpcProvider } from 'ethers';
import { compileSplitter } from '../src/deployment/compile.mjs';
import { prepareDeployment } from '../src/deployment/prepare.mjs';

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
async function main() {
  const rpc = process.env.FINTREE_RPC_URL;
  let safe = false;
  try { safe = Boolean(rpc) && new URL(rpc).protocol === 'https:'; } catch { /* Generic error below; never echo a URL with credentials. */ }
  if (!safe || !process.env.FINTREE_DEPLOYER_ADDRESS || !process.env.FINTREE_TREASURY_ADDRESS || !process.env.FINTREE_QUOTE_SIGNER_ADDRESS) throw new Error('Incomplete configuration');
  const provider = new JsonRpcProvider(rpc);
  try {
    const plan = await prepareDeployment({ provider, artifact: compileSplitter(), expectedChainId: 84532n, deployer: process.env.FINTREE_DEPLOYER_ADDRESS,
      token: USDC_BASE_SEPOLIA, treasury: process.env.FINTREE_TREASURY_ADDRESS, quoteSigner: process.env.FINTREE_QUOTE_SIGNER_ADDRESS });
    const { transactionData, ...summary } = plan;
    console.log(JSON.stringify(summary, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
    console.log('Read-only preparation complete. No transaction was sent.');
  } finally { provider.destroy(); }
}
main().catch(() => { console.error('Unable to prepare deployment. Check testnet configuration, RPC access, and token contract.'); process.exitCode = 1; });
