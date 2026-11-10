import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBaseSepolia } from '../src/deployment/select-testnet.mjs';

test('wallet selects only Base Sepolia and supports adding an unknown network', async () => {
  let chain = '0x1', added = false; const methods = [];
  const ethereum = { async request({ method, params }) {
    methods.push(method);
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain') {
      assert.equal(params[0].chainId, '0x14a34');
      if (!added) throw Object.assign(new Error('unknown'), { code: 4902 });
      chain = '0x14a34'; return null;
    }
    if (method === 'wallet_addEthereumChain') {
      assert.equal(params[0].chainId, '0x14a34');
      assert.deepEqual(params[0].rpcUrls, ['https://sepolia.base.org']);
      added = true; return null;
    }
    throw new Error(`Unexpected method: ${method}`);
  } };
  await selectBaseSepolia(ethereum);
  assert.deepEqual(methods, ['eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId']);
  methods.length = 0; await selectBaseSepolia(ethereum); assert.deepEqual(methods, ['eth_chainId']);
  const rejected = { request: async ({ method }) => { if (method === 'eth_chainId') return '0x1'; throw Object.assign(new Error('denied'), { code: 4001 }); } };
  await assert.rejects(selectBaseSepolia(rejected), (error) => error.code === 4001);
  const unchanged = { request: async ({ method }) => method === 'eth_chainId' ? '0x1' : null };
  await assert.rejects(selectBaseSepolia(unchanged), /did not switch/);
});
