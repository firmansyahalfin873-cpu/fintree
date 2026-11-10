import { Wallet, parseEther } from 'ethers';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';

// Disposable development wallets; never use this provider with real funds.
export async function createLocalChain({ chainId = 1337 } = {}) {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || chainId > 4294967295) throw new RangeError('Invalid local chain ID');
  const wallets = Array.from({ length: 10 }, () => Wallet.createRandom());
  const accounts = wallets.map((wallet) => ({ privateKey: wallet.privateKey, balance: parseEther('1000') }));
  const hre = await createHardhatRuntimeEnvironment({ networks: { local: { type: 'edr-simulated', chainType: 'l1', chainId, hardfork: 'shanghai', accounts } } }, {}, process.cwd());
  const connection = await hre.network.create('local');
  return {
    request: (args) => connection.provider.request(args),
    getInitialAccounts: () => Object.fromEntries(wallets.map((wallet) => [wallet.address.toLowerCase(), { secretKey: wallet.privateKey }])),
    disconnect: () => connection.close(),
  };
}
