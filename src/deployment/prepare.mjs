import { Contract, ContractFactory, getAddress, keccak256, ZeroAddress } from 'ethers';

function checkedAddress(value) {
  const result = getAddress(value);
  if (result === ZeroAddress) throw new TypeError('Zero address is not allowed');
  return result;
}

/** Read-only checks and an unsigned deployment transaction; no key or broadcast. */
export async function prepareDeployment({ provider, artifact, expectedChainId, deployer, token, treasury, quoteSigner }) {
  if (typeof expectedChainId !== 'bigint' || expectedChainId <= 0n) throw new TypeError('Invalid network');
  const addresses = { deployer: checkedAddress(deployer), token: checkedAddress(token), treasury: checkedAddress(treasury), quoteSigner: checkedAddress(quoteSigner) };
  if ((await provider.getNetwork()).chainId !== expectedChainId) throw new Error('Unexpected network');
  if (await provider.getCode(addresses.token) === '0x') throw new Error('Token is not deployed');
  if (await provider.getCode(addresses.quoteSigner) !== '0x') throw new Error('Quote signer must be a signing account');
  const decimals = Number(await new Contract(addresses.token, ['function decimals() view returns(uint8)'], provider).decimals());
  if (decimals !== 6) throw new Error('Token must have six decimals');
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const transaction = await factory.getDeployTransaction(addresses.token, addresses.treasury, addresses.quoteSigner);
  const [gasEstimate, balance] = await Promise.all([provider.estimateGas({ from: addresses.deployer, data: transaction.data }), provider.getBalance(addresses.deployer)]);
  return { chainId: expectedChainId, ...addresses, tokenDecimals: decimals, compiler: artifact.compiler, sourceHash: artifact.sourceHash,
    deploymentDataHash: keccak256(transaction.data), gasEstimate, deployerBalance: balance, transactionData: transaction.data };
}
