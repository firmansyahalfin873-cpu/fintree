// Fixed Base Sepolia parameters. This action never requests a transaction.
const chainId = '0x14a34';
export async function selectBaseSepolia(ethereum) {
  if (!ethereum?.request) throw new TypeError('Wallet unavailable');
  if (BigInt(await ethereum.request({ method: 'eth_chainId' })) === 84532n) return;
  try { await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
  catch (error) {
    if (error?.code !== 4902) throw error;
    await ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: 'Base Sepolia',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] }] });
    if (BigInt(await ethereum.request({ method: 'eth_chainId' })) !== 84532n) await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  }
  if (BigInt(await ethereum.request({ method: 'eth_chainId' })) !== 84532n) throw new Error('Wallet did not switch to Base Sepolia');
}
