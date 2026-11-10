import { Contract, getAddress, ZeroAddress } from 'ethers';

/** Verify that trusted testnet configuration matches the deployed contracts. */
export async function validateDeployment({ provider, signer, chainId, contract, token, tokenDecimals }) {
  if (typeof chainId !== 'bigint' || chainId <= 0n || !Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) throw new TypeError('Invalid deployment configuration');
  const splitterAddress = getAddress(contract), tokenAddress = getAddress(token), signerAddress = getAddress(await signer.getAddress());
  if ([splitterAddress, tokenAddress, signerAddress].includes(ZeroAddress)) throw new TypeError('Zero address is not allowed');
  if ((await provider.getNetwork()).chainId !== chainId) throw new Error('RPC chain does not match configuration');
  const [splitterCode, tokenCode] = await Promise.all([provider.getCode(splitterAddress), provider.getCode(tokenAddress)]);
  if (splitterCode === '0x' || tokenCode === '0x') throw new Error('Configured contract is not deployed');
  const splitter = new Contract(splitterAddress, ['function token() view returns(address)', 'function quoteSigner() view returns(address)', 'function treasury() view returns(address)'], provider);
  const asset = new Contract(tokenAddress, ['function decimals() view returns(uint8)'], provider);
  const [configuredToken, configuredSigner, treasury, decimals] = await Promise.all([splitter.token(), splitter.quoteSigner(), splitter.treasury(), asset.decimals()]);
  if (getAddress(configuredToken) !== tokenAddress || getAddress(configuredSigner) !== signerAddress || getAddress(treasury) === ZeroAddress || Number(decimals) !== tokenDecimals) throw new Error('Contract configuration does not match server');
  return { chainId, contract: splitterAddress, token: tokenAddress, signer: signerAddress, treasury: getAddress(treasury), tokenDecimals };
}
