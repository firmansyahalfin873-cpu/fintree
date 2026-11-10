import { deployWithWallet, DeploymentUncertainError } from '../src/deployment/wallet-deploy.mjs';
import { formatEther, getAddress } from 'ethers';
import { selectBaseSepolia } from '../src/deployment/select-testnet.mjs';
const $ = (id) => document.getElementById(id);
let account = null, setup = null;
const status = (message) => { $('status').textContent = message; };
$('switch-network').addEventListener('click', async () => {
  const button = $('switch-network'); button.disabled = true;
  try {
    status('Periksa permintaan jaringan di wallet Anda.');
    await selectBaseSepolia(window.ethereum);
    account = null; setup = null; $('review').hidden = true; $('start-form').hidden = true; $('recover-form').hidden = true;
    $('account').textContent = 'Hubungkan wallet untuk melanjutkan.'; $('balance').textContent = 'Saldo ETH uji belum diperiksa.'; $('refresh-balance').hidden = true;
    status('Base Sepolia dipilih. Hubungkan wallet untuk melanjutkan.');
  } catch (error) { status(error?.code === 4001 ? 'Permintaan jaringan dibatalkan di wallet.' : error?.code === -32002 ? 'Permintaan jaringan masih menunggu di wallet.' : 'Jaringan belum dapat dipilih. Periksa wallet dan coba lagi.'); }
  finally { button.disabled = false; }
});
async function api(path, value = {}) {
  const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item) });
  if (!response.ok) {
    let result; try { result = await response.json(); } catch { /* Use a generic error. */ }
    if (result?.error === 'database_migration_required') throw new Error('Data lokal perlu diperbarui. Hentikan layanan dan buat cadangan sebelum menjalankan migrasi.');
    if (result?.error === 'setup_recovery_required') throw new Error('Sebagian file persiapan hilang atau tidak cocok. Pulihkan dari cadangan dan jangan kirim transaksi baru.');
    throw new Error('Pengaturan gagal. Periksa alamat, kata sandi, koneksi, dan catatan persiapan.');
  }
  return response.json();
}
function renderRecord(record) {
  $('start-form').hidden = record?.status !== 'deployed';
  $('recover-form').hidden = !record || !['reserved', 'uncertain'].includes(record.status);
  if (!record) { $('deploy').hidden = false; $('confirm').hidden = true; return; }
  $('deploy').hidden = true;
  $('confirm').hidden = record.status !== 'submitted' && record.status !== 'pending';
  status(record.status === 'deployed' ? `Kontrak terpasang: ${record.contract}` : `Ada catatan transaksi (${record.status}). Periksa catatan dan wallet sebelum melanjutkan.`);
}
async function refreshBalance() {
  if (!account) throw new Error('Hubungkan wallet terlebih dahulu.');
  const [chain, accounts] = await Promise.all([window.ethereum.request({ method: 'eth_chainId' }), window.ethereum.request({ method: 'eth_accounts' })]);
  if (BigInt(chain) !== 84532n || !accounts[0] || getAddress(accounts[0]) !== getAddress(account)) throw new Error('Jaringan atau akun wallet berubah. Hubungkan kembali.');
  const balance = BigInt(await window.ethereum.request({ method: 'eth_getBalance', params: [account, 'latest'] }));
  if (balance < 0n) throw new Error('Saldo tidak valid.');
  $('balance').textContent = balance === 0n ? 'Saldo Base Sepolia: 0 ETH uji. ETH uji diperlukan untuk biaya transaksi.' : `Saldo Base Sepolia: ${formatEther(balance)} ETH uji. Biaya transaksi ditentukan saat Anda menyetujui di wallet.`;
}
$('connect').addEventListener('click', async () => {
  try {
    if (!window.ethereum) throw new Error('Ekstensi wallet tidak ditemukan di browser ini.');
    const chain = await window.ethereum.request({ method: 'eth_chainId' });
    if (BigInt(chain) !== 84532n) throw new Error('Pilih jaringan Base Sepolia di wallet terlebih dahulu.');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts[0]) throw new Error('Tidak ada akun wallet yang terhubung.');
    account = accounts[0]; setup = null; $('review').hidden = true; $('recover-form').hidden = true;
    $('account').textContent = `Wallet: ${account}`; $('refresh-balance').hidden = false;
    try { await refreshBalance(); status('Wallet terhubung ke Base Sepolia.'); }
    catch { $('balance').textContent = 'Saldo ETH uji belum dapat diperiksa. Periksa jaringan dan coba lagi.'; status('Wallet terhubung; saldo belum tersedia.'); }
  } catch (error) { account = null; setup = null; $('review').hidden = true; $('start-form').hidden = true; $('recover-form').hidden = true; $('refresh-balance').hidden = true; $('account').textContent = 'Wallet belum terhubung.'; $('balance').textContent = 'Saldo ETH uji belum diperiksa.'; status(error.message); }
});
$('refresh-balance').addEventListener('click', async () => { try { await refreshBalance(); status('Saldo ETH uji diperbarui.'); } catch (error) { $('balance').textContent = 'Saldo ETH uji belum dapat diperiksa.'; status(error.message); } });
$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!account) { status('Hubungkan wallet terlebih dahulu.'); return; }
  const button = event.submitter; button.disabled = true;
  try {
    const password = $('password').value, confirmation = $('password-confirm').value;
    $('password').value = ''; $('password-confirm').value = '';
    if (password !== confirmation) throw new Error('Kedua kata sandi tidak sama. Masukkan kembali.');
    setup = await api('prepare', { deployer: account, treasury: $('treasury').value.trim(), password });
    setup.expected.chainId = BigInt(setup.expected.chainId);
    const p = setup.plan;
    $('details').textContent = `Jaringan: Base Sepolia (84532)\nWallet: ${p.deployer}\nTreasury: ${p.treasury}\nUSDC uji: ${p.token}\nPenandatangan aplikasi: ${p.quoteSigner}\n${setup.record ? 'Gas saat persiapan awal' : 'Perkiraan gas saat ini'}: ${p.gasEstimate} unit\nSaldo saat diperiksa: ${p.deployerBalance === null ? 'tidak tersedia' : `${formatEther(p.deployerBalance)} ETH uji`}\nHash data kontrak: ${p.deploymentDataHash}`;
    $('review').hidden = false; status('Periksa rincian di atas. Perkiraan gas belum mencakup seluruh biaya jaringan.'); renderRecord(setup.record);
  } catch (error) { setup = null; $('review').hidden = true; $('start-form').hidden = true; $('recover-form').hidden = true; status(error.message); }
  finally { button.disabled = false; }
});
$('deploy').addEventListener('click', async () => {
  if (!setup || setup.record) return;
  $('deploy').disabled = true; $('switch-network').disabled = true; $('connect').disabled = true; $('prepare').disabled = true;
  try {
    const result = await deployWithWallet({ ethereum: window.ethereum, ...setup,
      reserve: (value) => api('reserve', { nonce: value.nonce, predictedAddress: value.predictedAddress }),
      markSubmitted: (value) => api('submitted', { transactionHash: value.transactionHash }),
      markConfirmed: async () => { const record = await api('confirm'); if (record.status !== 'deployed') throw new Error('Konfirmasi belum tersedia'); },
      onStatus: ({ stage }) => status(stage === 'submitted' ? 'Transaksi dikirim. Menunggu pemeriksaan jaringan.' : 'Periksa dan setujui rincian di wallet Anda.'),
    });
    setup.record = { status: 'deployed', contract: result.contract }; renderRecord(setup.record);
  } catch (error) {
    if (error instanceof DeploymentUncertainError) { setup.record = { status: 'uncertain' }; $('deploy').hidden = true; $('recover-form').hidden = false; if (error.transactionHash) $('recover-hash').value = error.transactionHash; status(`Hasil belum pasti. Jangan ulangi transaksi; periksa wallet dan catatan lokal.${error.transactionHash ? ` Hash: ${error.transactionHash}` : ''}`); }
    else status(error.message);
  } finally { $('deploy').disabled = false; $('switch-network').disabled = false; $('connect').disabled = false; $('prepare').disabled = false; }
});
$('confirm').addEventListener('click', async () => { try { const record = await api('confirm'); setup.record = record; renderRecord(record); } catch (error) { status(error.message); } });
$('recover-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { const record = await api('recover', { transactionHash: $('recover-hash').value.trim() }); setup.record = record; renderRecord(record); }
  catch { status('Transaksi belum ditemukan atau tidak sesuai. Periksa hash dan jaringan; jangan kirim ulang.'); }
  finally { button.disabled = false; }
});
$('start-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const password = $('unlock').value; $('unlock').value = '';
    const result = await api('start', { password });
    if (result.origin !== 'http://127.0.0.1:4174') throw new Error('Alamat layanan tidak sesuai.');
    $('runtime-link').hidden = false; status('Layanan testnet berjalan di komputer ini.');
  } catch (error) { status(error.message); } finally { button.disabled = false; }
});
