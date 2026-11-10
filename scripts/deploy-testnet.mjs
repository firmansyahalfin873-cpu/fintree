import { getAddress, JsonRpcProvider, Wallet } from 'ethers';
import { compileSplitter } from '../src/deployment/compile.mjs';
import { prepareDeployment } from '../src/deployment/prepare.mjs';
import { executeDeployment } from '../src/deployment/execute.mjs';

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
async function main() {
  const rpc = process.env.FINTREE_RPC_URL;
  let safe = false;
  try { safe = Boolean(rpc) && new URL(rpc).protocol === 'https:'; } catch { /* Never echo credentials. */ }
  if (!safe || !process.env.FINTREE_DEPLOYER_KEY || !process.env.FINTREE_TREASURY_ADDRESS || !process.env.FINTREE_QUOTE_SIGNER_ADDRESS) throw new Error('Incomplete configuration');
  const provider = new JsonRpcProvider(rpc), signer = new Wallet(process.env.FINTREE_DEPLOYER_KEY, provider);
  try {
    if (process.env.FINTREE_DEPLOYER_ADDRESS && getAddress(process.env.FINTREE_DEPLOYER_ADDRESS) !== signer.address) throw new Error('Deployer does not match preparation');
    const plan = await prepareDeployment({ provider, artifact: compileSplitter(), expectedChainId: 84532n, deployer: await signer.getAddress(), token: USDC_BASE_SEPOLIA,
      treasury: process.env.FINTREE_TREASURY_ADDRESS, quoteSigner: process.env.FINTREE_QUOTE_SIGNER_ADDRESS });
    if (process.env.FINTREE_EXPECTED_DEPLOYMENT_HASH && process.env.FINTREE_EXPECTED_DEPLOYMENT_HASH.toLowerCase() !== plan.deploymentDataHash.toLowerCase()) throw new Error('Deployment data differs from preparation');
    const result = await executeDeployment({ signer, plan, recordPath: process.env.FINTREE_DEPLOYMENT_RECORD || '.fintree-data/base-sepolia-deployment.json',
      onBroadcast: ({ hash, predictedAddress }) => console.log(`Submitted transaction ${hash}; expected contract ${predictedAddress}`) });
    console.log(`Testnet contract ${result.contract} deployed at block ${result.blockNumber}.`);
  } finally { provider.destroy(); }
}
main().catch(() => { console.error('Deployment did not complete. Inspect the deployment record and transaction before retrying.'); process.exitCode = 1; });
