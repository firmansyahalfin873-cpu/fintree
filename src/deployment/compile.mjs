import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

/** Compile the tracked splitter with pinned compiler and optimizer settings. */
export function compileSplitter() {
  const require = createRequire(import.meta.url);
  const sourceName = 'contracts/FintreeSplitter.sol';
  const sources = { [sourceName]: readFileSync(fileURLToPath(new URL('../../contracts/FintreeSplitter.sol', import.meta.url)), 'utf8') };
  const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } };
  const input = { language: 'Solidity', sources: { [sourceName]: { content: sources[sourceName] } }, settings };
  const result = JSON.parse(solc.compile(JSON.stringify(input), { import: (name) => {
    try { const content = readFileSync(require.resolve(name), 'utf8'); sources[name] = content; return { contents: content }; }
    catch { return { error: `Import not found: ${name}` }; }
  } }));
  const errors = (result.errors ?? []).filter((item) => item.severity === 'error');
  if (errors.length) throw new Error('Contract compilation failed');
  const artifact = result.contracts[sourceName].FintreeSplitter;
  const orderedSources = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
  const sourceHash = createHash('sha256').update(JSON.stringify({ compiler: solc.version(), settings, sources: orderedSources })).digest('hex');
  return { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, compiler: solc.version(), sourceHash };
}
