import { BrowserProvider } from 'ethers';
import { submitWalletPayment } from '../src/checkout/wallet-payment.mjs';
import { createPendingPayment } from '../src/checkout/pending-payment.mjs';
import { createMerchantAttempt } from '../src/checkout/merchant-attempt.mjs';
import { parseAmount, calculateQuote } from '../src/domain/money.mjs';
import { paymentsToCsv } from '../src/ui/payment-export.mjs';

const $ = (selector) => document.querySelector(selector);
const match = /^\/pay\/(0x[0-9a-f]{64})$/.exec(location.pathname);
const checkoutId = match?.[1];
let apiKey = null, merchantWallet = null, session = null, deployment = null, paymentSubmitted = false, paymentHashReceived = false, pendingPayment = null, pendingAttempt = null, merchantRevision = 0, networkRevision = 0, recentPayments = [], paymentCursor = null;

async function api(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(({ unauthorized: 'Invalid API key.', invalid_challenge: 'Wallet verification failed or expired.', idempotency_conflict: 'This request conflicts with a previous order.', not_found: 'Payment not found.' })[result.error] || 'Request failed. Check the details and try again.');
  return result;
}
const jsonPost = (body, extra = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
const authHeaders = () => ({ authorization: `Bearer ${apiKey}` });
const tokenAmount = (value) => { const n = BigInt(value), whole = n / 1000000n, fraction = (n % 1000000n).toString().padStart(6, '0').replace(/0+$/, ''); return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction.padEnd(2, '0')}` : '.00'}`; };
const money = (value) => `${tokenAmount(value)} test tokens`;
const statusText = (status) => ({ pending: 'Pending', confirming: 'Confirming', paid: 'Paid', expired: 'Expired' })[status] || 'Unknown';
function addDetail(label, value) { const row = document.createElement('div'); row.className = 'detail-row'; const left = document.createElement('span'), right = document.createElement('strong'); left.textContent = label; right.textContent = value; row.append(left, right); return row; }
function updateFeePreview() {
  const preview = $('#fee-preview'), amount = $('#amount').value, payer = $('#fee').value;
  if (!amount || amount.length > 80 || !['customer', 'merchant'].includes(payer)) { preview.hidden = true; return; }
  try {
    const quote = calculateQuote(parseAmount(amount), payer, 30);
    preview.replaceChildren(addDetail('Protocol fee', money(quote.protocolFee)), addDetail('Customer pays', money(quote.totalPayable)), addDetail('Merchant receives', money(quote.merchantReceives)));
    preview.hidden = false;
  } catch { preview.hidden = true; }
}
function maskSecret(field, toggle, label) {
  $(field).type = 'password'; $(toggle).textContent = `Show ${label}`; $(toggle).setAttribute('aria-pressed', 'false');
}
function setupSecretControls(field, toggle, copy, state, label) {
  $(toggle).addEventListener('click', () => {
    const visible = $(field).type === 'password';
    $(field).type = visible ? 'text' : 'password';
    $(toggle).textContent = `${visible ? 'Hide' : 'Show'} ${label}`;
    $(toggle).setAttribute('aria-pressed', String(visible));
  });
  $(copy).addEventListener('click', async () => {
    const value = $(field).value;
    if (!value) return;
    try {
      if (!window.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await window.navigator.clipboard.writeText(value);
      if ($(field).value === value) $(state).textContent = 'Copied. Store it securely.';
    } catch { if ($(field).value === value) $(state).textContent = 'Could not copy. Show the value and copy it manually.'; }
  });
}
function message(error) { return error?.code === 4001 || error?.code === 'ACTION_REJECTED' ? 'Wallet request cancelled.' : ['Wallet unavailable', 'Wallet not available'].includes(error?.message) ? 'No browser wallet found. Install or enable a wallet extension, then try again.' : error?.message === 'Switch wallet to the required network' ? 'Switch your wallet to the required test network.' : 'Could not complete this action. Check your wallet and try again.'; }

async function refreshServiceStatus() {
  try {
    const result = await api('/api/v1/public/service-status');
    const label = (value) => ({ running: 'running', starting: 'starting', delayed: 'delayed', disabled: 'disabled', unavailable: 'unavailable' })[value] || 'unknown';
    $('#service-status').textContent = `Payment monitor: ${label(result.scanner?.state)}. Webhook delivery: ${label(result.webhook?.state)}.`;
  } catch { $('#service-status').textContent = 'Could not check service status.'; }
}

async function refreshWalletNetwork() {
  const revision = ++networkRevision, currentKey = apiKey;
  if (!currentKey) { $('#network-state').textContent = 'Connect a wallet to check its network.'; return; }
  $('#network-state').textContent = 'Checking wallet network…';
  try {
    const [config, chain] = await Promise.all([api('/api/v1/public/config'), window.ethereum.request({ method: 'eth_chainId' })]);
    if (!/^\d{1,20}$/.test(config.chainId) || typeof chain !== 'string' || !/^0x[0-9a-f]{1,16}$/i.test(chain)) throw new Error('Invalid network');
    if (revision !== networkRevision || currentKey !== apiKey) return;
    const expected = BigInt(config.chainId), actual = BigInt(chain);
    const expectedName = expected === 84532n ? 'Base Sepolia' : `chain ${expected}`;
    $('#network-state').textContent = actual === expected
      ? `Wallet matches the configured network: ${expectedName}.`
      : `Wallet is on chain ${actual}; checkout requires ${expectedName}. Switch networks in your wallet before paying.`;
  } catch {
    if (revision === networkRevision && currentKey === apiKey) $('#network-state').textContent = 'Could not check the wallet network. Check your wallet and try again.';
  }
}

function visiblePayments() {
  const query = ($('#payment-search').value || '').trim().toLowerCase(), filter = $('#status-filter').value || 'all';
  return recentPayments.filter((invoice) => invoice.orderId.toLowerCase().includes(query) && (filter === 'all' || invoice.status === filter));
}

function renderPayments() {
  const list = $('#invoices'); list.replaceChildren();
  const visible = apiKey ? visiblePayments() : [];
  const values = apiKey ? [recentPayments.length,
    recentPayments.filter((item) => !item.reviewRequired && ['pending', 'confirming'].includes(item.status)).length,
    recentPayments.filter((item) => !item.reviewRequired && item.status === 'paid').length,
    recentPayments.filter((item) => item.reviewRequired).length] : ['—', '—', '—', '—'];
  ['#summary-loaded', '#summary-awaiting', '#summary-paid', '#summary-review'].forEach((selector, index) => { $(selector).textContent = String(values[index]); });
  $('#export-payments').disabled = visible.length === 0;
  if (!apiKey) { list.textContent = 'Connect your wallet to view payments.'; return; }
  if (!visible.length) { list.textContent = recentPayments.length ? 'No payments match your search.' : 'No payments yet.'; return; }
  for (const invoice of visible) {
    const row = document.createElement('div'); row.className = 'payment-row';
    const link = document.createElement('a'); link.className = 'invoice'; link.href = `/pay/${invoice.id}`;
    const title = document.createElement('span'), amount = document.createElement('strong');
    title.textContent = `${invoice.orderId} · ${invoice.reviewRequired ? 'Needs review' : statusText(invoice.status)}`; amount.textContent = money(invoice.totalPayable); link.append(title, amount);
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-payment'; copy.textContent = 'Copy link'; copy.setAttribute('aria-label', `Copy checkout link for order ${invoice.orderId}`);
    copy.addEventListener('click', async () => {
      try {
        if (!window.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await window.navigator.clipboard.writeText(new URL(link.href, location.href).href);
        $('#copy-payment-state').textContent = 'Checkout link copied.';
      } catch { $('#copy-payment-state').textContent = 'Could not copy automatically. Open the payment and copy the address from your browser.'; }
    });
    const details = document.createElement('details'); details.className = 'payment-details';
    const summary = document.createElement('summary'); summary.textContent = 'Payment details'; summary.setAttribute('aria-label', `Payment details for order ${invoice.orderId}`);
    const body = document.createElement('div'); body.className = 'payment-detail-body';
    const network = invoice.chainId === '84532' ? 'Base Sepolia' : `Chain ${invoice.chainId}`;
    body.append(addDetail('Status', invoice.reviewRequired ? 'Needs review' : statusText(invoice.status)), addDetail('Network', network),
      addDetail('Token address', invoice.token), addDetail('Order amount', money(invoice.invoiceAmount)),
      addDetail('Protocol fee', money(invoice.protocolFee)), addDetail('Fee paid by', invoice.feePayer === 'customer' ? 'Customer' : 'Merchant'),
      addDetail('Customer pays', money(invoice.totalPayable)), addDetail('Merchant receives', money(invoice.merchantAmount)),
      addDetail('Expires', new Date(invoice.deadline * 1000).toLocaleString('en-US')));
    details.append(summary, body); row.append(link, copy, details); list.append(row);
  }
}

async function refreshList(cursor = null) {
  if (!apiKey) { recentPayments = []; paymentCursor = null; $('#more-payments').hidden = true; renderPayments(); return; }
  const currentKey = apiKey;
  const { data, nextCursor } = await api(`/api/v1/checkout/sessions${cursor ? `?starting_after=${encodeURIComponent(cursor)}` : ''}`, { headers: authHeaders() });
  if (apiKey !== currentKey) return;
  recentPayments = cursor ? [...recentPayments, ...data] : data;
  paymentCursor = nextCursor; $('#more-payments').hidden = !nextCursor; renderPayments();
}

async function refreshWebhook() {
  if (!apiKey) { $('#webhook-save').disabled = true; return; }
  const currentKey = apiKey;
  try {
    const result = await api('/api/v1/webhook', { headers: authHeaders() });
    if (apiKey !== currentKey) return;
    $('#webhook-save').disabled = false;
    $('#webhook-url').value = result.url || '';
    $('#webhook-state').textContent = result.configured ? 'Endpoint saved. Saving again creates a new secret.' : 'No webhook endpoint configured.';
  } catch { $('#webhook-save').disabled = true; $('#webhook-state').textContent = 'Webhooks are unavailable in this service configuration.'; }
}

async function refreshMerchant() {
  if (!apiKey) { $('#business-save').disabled = true; return; }
  const currentKey = apiKey;
  try {
    const profile = await api('/api/v1/merchant', { headers: authHeaders() });
    if (apiKey !== currentKey) return;
    $('#business-name').value = profile.businessName;
    $('#business-state').textContent = 'Business name saved.';
    $('#business-save').disabled = false;
  } catch { $('#business-state').textContent = 'Could not load the business profile.'; $('#business-save').disabled = true; }
}

async function refreshAttempts() {
  const list = $('#webhook-attempts'); list.replaceChildren();
  if (!apiKey) { list.textContent = 'Connect your wallet to view delivery history.'; return; }
  const currentKey = apiKey;
  try {
    const { data } = await api('/api/v1/webhook/attempts', { headers: authHeaders() });
    if (apiKey !== currentKey) return;
    if (!data.length) { list.textContent = 'No delivery attempts yet.'; return; }
    for (const entry of data) {
      const row = document.createElement('div'); row.className = 'invoice';
      const left = document.createElement('span'), right = document.createElement('strong');
      left.textContent = `${entry.eventId.slice(0, 18)}… · attempt ${entry.attempt}`;
      right.textContent = `${({ delivered: 'Delivered', retry: 'Retry scheduled', failed: 'Failed' })[entry.outcome] || 'Unknown'}${entry.responseStatus ? ` · HTTP ${entry.responseStatus}` : ''}`;
      row.append(left, right);
      if (entry.retryable) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button'; retry.textContent = 'Try again';
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try {
            await api(`/api/v1/webhook/events/${encodeURIComponent(entry.eventId)}/retry`, { method: 'POST', headers: authHeaders() });
            if (apiKey !== currentKey) return;
            $('#webhook-retry-state').textContent = 'Delivery rescheduled. Check history for the result.';
            await refreshAttempts();
          } catch { if (apiKey === currentKey) { $('#webhook-retry-state').textContent = 'Could not reschedule delivery.'; retry.disabled = false; } }
        });
        row.append(retry);
      }
      list.append(row);
    }
  } catch { list.textContent = 'Webhook history is unavailable.'; }
}

function resetMerchantSession(reason) {
  merchantRevision++; networkRevision++;
  apiKey = null; merchantWallet = null; pendingAttempt = null;
  $('#copy-payment-state').textContent = ''; $('#export-payment-state').textContent = '';
  $('#created-payment').hidden = true; $('#created-payment-link').value = ''; $('#open-created-payment').removeAttribute('href'); $('#created-payment-state').textContent = '';
  $('#order').value = ''; $('#amount').value = ''; $('#return-url').value = ''; $('#return-url-error').textContent = ''; updateFeePreview();
  $('#api-key').value = ''; $('#key-area').hidden = true; $('#create').disabled = true; $('#create').textContent = 'Create payment';
  $('#invoice-help').textContent = 'The customer also pays network gas fees. Connect your wallet to continue.';
  maskSecret('#api-key', '#api-key-toggle', 'key'); $('#api-key-copy-state').textContent = '';
  $('#connect').disabled = false; $('#connect').textContent = 'Connect wallet'; $('#wallet-state').textContent = reason;
  $('#disconnect-area').hidden = true;
  $('#check-network').disabled = true; $('#network-state').textContent = 'Connect a wallet to check its network.';
  $('#business-name').value = ''; $('#business-save').disabled = true; $('#business-state').textContent = 'Connect your wallet first.';
  $('#webhook-url').value = ''; $('#webhook-secret').value = ''; $('#webhook-secret-area').hidden = true; $('#webhook-save').disabled = true; $('#webhook-state').textContent = 'Connect your wallet first.';
  maskSecret('#webhook-secret', '#webhook-secret-toggle', 'secret'); $('#webhook-secret-copy-state').textContent = '';
  $('#new-key').disabled = true; $('#key-status').textContent = ''; $('#api-key-list').replaceChildren();
  refreshList().catch(() => {}); refreshAttempts().catch(() => {});
}

async function refreshKeys(cursor = null) {
  const list = $('#api-key-list'); if (!cursor) list.replaceChildren();
  if (!apiKey) { list.textContent = 'Connect your wallet to view API keys.'; return; }
  const currentKey = apiKey;
  try {
    const { data, nextCursor } = await api(`/api/v1/api-keys${cursor ? `?starting_after=${encodeURIComponent(cursor)}` : ''}`, { headers: authHeaders() });
    if (apiKey !== currentKey) return;
    if (!data.length) { if (!cursor) list.textContent = 'No API keys yet.'; return; }
    for (const entry of data) {
      const row = document.createElement('div'); row.className = 'invoice';
      const info = document.createElement('span'); info.textContent = `${entry.prefix}… · ${entry.revokedAt ? 'Revoked' : entry.current ? 'Current session' : 'Active'}`; row.append(info);
      if (!entry.revokedAt) {
        const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'text-button'; revoke.textContent = 'Revoke';
        revoke.addEventListener('click', async () => {
          revoke.disabled = true;
          try {
            const result = await api(`/api/v1/api-keys/${entry.id}`, { method: 'DELETE', headers: authHeaders() });
            if (apiKey !== currentKey) return;
            if (result.current) resetMerchantSession('Session key revoked. Reconnect your wallet.');
            else { $('#key-status').textContent = 'Key revoked.'; await refreshKeys(); }
          } catch { $('#key-status').textContent = 'Could not revoke key.'; revoke.disabled = false; }
        });
        row.append(revoke);
      }
      list.append(row);
    }
    if (nextCursor) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'text-button'; more.textContent = 'Load more';
      more.addEventListener('click', async () => { more.disabled = true; more.remove(); await refreshKeys(nextCursor); });
      list.append(more);
    }
  } catch { list.textContent = 'Could not load API keys.'; }
}

async function refreshPayment() {
  session = await api(`/api/v1/public/checkout/sessions/${checkoutId}`);
  if (session.status === 'paid' || session.status === 'expired') { pendingPayment?.clear(); paymentSubmitted = false; }
  $('#title').textContent = session.businessName;
  $('#total').textContent = tokenAmount(session.totalPayable);
  $('#status').textContent = session.reviewRequired ? 'Needs review' : statusText(session.status);
  $('#status').className = `pill ${session.status === 'paid' && !session.reviewRequired ? '' : 'pending'}`;
  const network = session.chainId === '84532' ? 'Base Sepolia' : `Chain ${session.chainId}`;
  $('#details').replaceChildren(addDetail('Order', session.orderId), addDetail('Network', network), addDetail('Token address', session.token), addDetail('Order amount', money(session.invoiceAmount)), addDetail('Protocol fee', money(session.protocolFee)), addDetail('Fee paid by', session.feePayer === 'customer' ? 'Customer' : 'Merchant'), addDetail('Merchant receives', money(session.merchantAmount)), addDetail('Expires', new Date(session.deadline * 1000).toLocaleString('en-US')));
  const button = $('#pay');
  const returnLink = $('#return-link'); returnLink.hidden = true; returnLink.removeAttribute('href');
  if (session.status === 'paid' && !session.reviewRequired && typeof session.returnUrl === 'string') {
    try {
      const target = new URL(session.returnUrl);
      const local = target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname);
      if ((target.protocol === 'https:' || local) && !target.username && !target.password) { returnLink.href = target.href; returnLink.hidden = false; }
    } catch { /* Invalid destinations are never displayed. */ }
  }
  button.disabled = session.reviewRequired || session.status !== 'pending' || Date.now() >= session.deadline * 1000 || paymentSubmitted;
  if (button.disabled) $('#switch-network').hidden = true;
  $('#checkout-step').textContent = session.reviewRequired ? 'Payment requires review. Contact the merchant before taking further action.' : session.status === 'paid' ? 'Complete. The payment has been verified.' : session.status === 'confirming' ? 'Confirming. The server is checking the payment.' : session.status === 'expired' || Date.now() >= session.deadline * 1000 ? 'This payment request has expired. Ask the merchant for a new one.' : paymentSubmitted ? 'A wallet request was made. Check its result before trying again.' : 'Review the network and amount, then connect your wallet to continue.';
  if (session.reviewRequired) { button.textContent = 'Payment needs review'; $('#message').textContent = 'Payment block data changed. Contact the merchant to check its status.'; }
  else if (session.status === 'paid') { button.textContent = 'Payment verified'; $('#message').textContent = 'The server verified this payment.'; }
  else if (session.status === 'confirming') { button.textContent = 'Awaiting confirmation'; $('#message').textContent = 'The server is verifying your payment.'; }
  else if (session.status === 'expired' || Date.now() >= session.deadline * 1000) button.textContent = 'Payment expired';
  else if (paymentSubmitted) { button.textContent = paymentHashReceived ? 'Transaction submitted' : 'Check wallet'; $('#message').textContent = paymentHashReceived ? 'A transaction was submitted from this browser. Check its status or contact the merchant if it does not change.' : 'The wallet request result is unknown. Check your wallet and payment status before retrying.'; }
  else button.textContent = 'Connect wallet and pay';
}

if (checkoutId) {
  $('#checkout').hidden = false;
  try {
    const config = await api('/api/v1/public/config');
    deployment = { chainId: BigInt(config.chainId), contract: config.contract, token: config.token, signer: config.signer };
    let storage; try { storage = window.localStorage; } catch { /* Storage may be disabled. */ }
    pendingPayment = createPendingPayment({ storage, chainId: deployment.chainId, contract: deployment.contract, invoiceId: checkoutId });
    const savedPayment = pendingPayment.get(); paymentSubmitted = Boolean(savedPayment); paymentHashReceived = Boolean(savedPayment && savedPayment !== 'requesting');
    await refreshPayment();
  } catch { $('#error').textContent = 'Could not load payment.'; $('#checkout-step').textContent = 'Payment details are unavailable. Ask the merchant to check this link.'; }
  $('#refresh-payment').addEventListener('click', () => refreshPayment().catch(() => { $('#error').textContent = 'Could not check status.'; }));
  $('#switch-network').addEventListener('click', async () => {
    const button = $('#switch-network'); button.disabled = true; $('#error').textContent = '';
    try {
      if (!deployment || !window.ethereum?.request) throw new Error('Wallet unavailable');
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${deployment.chainId.toString(16)}` }] });
      const active = await window.ethereum.request({ method: 'eth_chainId' });
      if (typeof active !== 'string' || !/^0x[0-9a-f]+$/i.test(active) || BigInt(active) !== deployment.chainId) throw new Error('Network did not change');
      button.hidden = true; $('#checkout-step').textContent = 'Wallet network updated. Review the details and select Pay to continue.';
    } catch (error) {
      $('#error').textContent = error?.code === 4902 ? 'Add the required test network in your wallet, then try again.' : error?.code === 4001 ? 'Network switch cancelled. Switch networks to continue.' : 'Could not switch networks. Check your wallet and try again.';
    } finally { button.disabled = false; }
  });
  $('#pay').addEventListener('click', async () => {
    $('#error').textContent = ''; $('#switch-network').hidden = true; $('#pay').disabled = true;
    try {
      await submitWalletPayment({ ethereum: window.ethereum, session, deployment, onStatus: ({ stage, transactionHash }) => {
        if (stage === 'payment') { paymentSubmitted = true; paymentHashReceived = false; pendingPayment?.markRequested(); }
        if (stage === 'submitted') { paymentSubmitted = true; paymentHashReceived = true; pendingPayment?.set(transactionHash); }
        $('#checkout-step').textContent = ({ reset_approval: 'Update the existing token approval in your wallet.', approval: 'Approve the token in your wallet to continue.', payment: 'Review and confirm the payment in your wallet.', submitted: 'Transaction submitted. Waiting for the server to verify it.' })[stage] || '';
        $('#message').textContent = ({ reset_approval: 'Updating token approval in wallet…', approval: 'Approve the token in your wallet…', payment: 'Confirm the payment in your wallet…', submitted: 'Transaction submitted. Waiting for server verification…' })[stage] || '';
      } });
      await refreshPayment();
      for (let attempt = 0; attempt < 24 && session.status !== 'paid'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await refreshPayment();
      }
      if (session.status !== 'paid') $('#message').textContent = 'Transaction submitted. The server is still checking; use Check status.';
    } catch (error) {
      if (paymentSubmitted && !paymentHashReceived && (error?.code === 4001 || error?.code === 'ACTION_REJECTED')) { paymentSubmitted = false; pendingPayment?.clear(); }
      $('#error').textContent = paymentSubmitted ? 'The transaction result is unknown. Check your wallet and payment status before retrying.' : message(error);
      if (!paymentSubmitted && session && !session.reviewRequired && session.status === 'pending' && Date.now() < session.deadline * 1000 && error?.message === 'Switch wallet to the required network') $('#switch-network').hidden = false;
      if (!paymentSubmitted) $('#pay').disabled = !session || session.reviewRequired || session.status !== 'pending' || Date.now() >= session.deadline * 1000;
    }
  });
} else {
  $('#merchant').hidden = false;
  setupSecretControls('#api-key', '#api-key-toggle', '#api-key-copy', '#api-key-copy-state', 'key');
  setupSecretControls('#webhook-secret', '#webhook-secret-toggle', '#webhook-secret-copy', '#webhook-secret-copy-state', 'secret');
  $('#local-link-warning').hidden = !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(location.href).hostname);
  $('#amount').addEventListener('input', updateFeePreview);
  $('#fee').addEventListener('change', updateFeePreview);
  $('#return-url').addEventListener('input', () => { $('#return-url-error').textContent = ''; });
  $('#payment-search').addEventListener('input', renderPayments);
  $('#status-filter').addEventListener('change', renderPayments);
  $('#export-payments').addEventListener('click', () => {
    if (!apiKey) return;
    const rows = visiblePayments(); if (!rows.length) return;
    let url;
    try {
      url = URL.createObjectURL(new Blob([paymentsToCsv(rows)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'fintree-payments.csv'; link.click();
      $('#export-payment-state').textContent = `Download started for ${rows.length} visible payment${rows.length === 1 ? '' : 's'}.`;
    } catch { $('#export-payment-state').textContent = 'Could not export payments. Please try again.'; }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
  });
  $('#copy-created-payment').addEventListener('click', async () => {
    try {
      if (!window.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await window.navigator.clipboard.writeText($('#created-payment-link').value);
      $('#created-payment-state').textContent = 'Checkout link copied.';
    } catch { $('#created-payment-state').textContent = 'Select and copy the checkout link above.'; }
  });
  $('#more-payments').addEventListener('click', async () => {
    if (!paymentCursor) return;
    const button = $('#more-payments'); button.disabled = true;
    try { await refreshList(paymentCursor); } catch { $('#error').textContent = 'Could not load more payments. Try again.'; }
    finally { button.disabled = false; }
  });
  refreshServiceStatus();
  $('#refresh-service').addEventListener('click', refreshServiceStatus);
  $('#disconnect').addEventListener('click', () => resetMerchantSession('Workspace disconnected. Your wallet remains connected in your browser.'));
  $('#check-network').addEventListener('click', refreshWalletNetwork);
  refreshList().catch(() => {});
  refreshAttempts().catch(() => {});
  refreshKeys().catch(() => {});
  $('#connect').addEventListener('click', async () => {
    $('#connect').disabled = true; $('#error').textContent = '';
    const revision = merchantRevision;
    try {
      if (!window.ethereum?.request) throw new Error('Wallet unavailable');
      const provider = new BrowserProvider(window.ethereum);
      let walletAddress, challenge, signature;
      try {
        await provider.send('eth_requestAccounts', []);
        const wallet = await provider.getSigner(); walletAddress = await wallet.getAddress();
        challenge = await api('/api/v1/wallet/challenge', jsonPost({ wallet: walletAddress }));
        if (revision !== merchantRevision) return;
        signature = await wallet.signMessage(challenge.message);
        const activeAccounts = await provider.send('eth_accounts', []);
        if (revision !== merchantRevision || !activeAccounts[0] || activeAccounts[0].toLowerCase() !== walletAddress.toLowerCase()) { if (revision === merchantRevision) resetMerchantSession('Account changed. Reconnect your wallet.'); return; }
      } finally { provider.destroy(); }
      const issued = await api('/api/v1/wallet/complete', jsonPost({ id: challenge.id, nonce: challenge.nonce, signature }));
      if (revision !== merchantRevision) return;
      apiKey = issued.apiKey; merchantWallet = walletAddress; $('#api-key').value = apiKey; maskSecret('#api-key', '#api-key-toggle', 'key'); $('#api-key-copy-state').textContent = ''; $('#key-area').hidden = false;
      $('#wallet-state').textContent = `Connected: ${walletAddress}`; $('#create').disabled = false; $('#new-key').disabled = false; $('#connect').textContent = 'Wallet connected';
      $('#disconnect-area').hidden = false;
      $('#check-network').disabled = false; await refreshWalletNetwork();
      if (revision !== merchantRevision) return;
      $('#invoice-help').textContent = 'The customer also pays network gas fees.';
      await refreshList();
      await refreshMerchant();
      await refreshWebhook();
      await refreshAttempts();
      await refreshKeys();
    } catch (error) { if (revision === merchantRevision) { $('#error').textContent = message(error); $('#connect').disabled = false; } }
  });
  window.ethereum?.on?.('accountsChanged', () => resetMerchantSession('Account changed. Reconnect your wallet.'));
  window.ethereum?.on?.('chainChanged', () => refreshWalletNetwork());
  $('#refresh-list').addEventListener('click', () => refreshList().catch(() => { $('#error').textContent = 'Could not load payments.'; }));
  $('#refresh-attempts').addEventListener('click', refreshAttempts);
  $('#refresh-keys').addEventListener('click', () => refreshKeys());
  $('#new-key').addEventListener('click', async () => {
    $('#new-key').disabled = true; $('#key-status').textContent = '';
    const currentKey = apiKey;
    try {
      const issued = await api('/api/v1/api-keys', { method: 'POST', headers: authHeaders() });
      if (apiKey !== currentKey) return;
      $('#api-key').value = issued.key; maskSecret('#api-key', '#api-key-toggle', 'key'); $('#api-key-copy-state').textContent = ''; $('#key-area').hidden = false;
      $('#key-status').textContent = 'New key created. Save it now; previous keys stay active until revoked.';
      await refreshKeys();
    } catch { $('#key-status').textContent = 'Could not create a key.'; }
    finally { $('#new-key').disabled = !apiKey; }
  });
  $('#business-form').addEventListener('submit', async (event) => {
    event.preventDefault(); $('#business-save').disabled = true; $('#error').textContent = '';
    const currentKey = apiKey;
    try { const profile = await api('/api/v1/merchant', jsonPost({ businessName: $('#business-name').value }, authHeaders())); if (apiKey !== currentKey) return; $('#business-name').value = profile.businessName; $('#business-state').textContent = 'Business name saved.'; }
    catch { $('#error').textContent = 'Could not save the business name.'; }
    finally { $('#business-save').disabled = !apiKey; }
  });
  $('#webhook-form').addEventListener('submit', async (event) => {
    event.preventDefault(); $('#webhook-save').disabled = true; $('#error').textContent = '';
    const currentKey = apiKey;
    try {
      const result = await api('/api/v1/webhook', jsonPost({ url: $('#webhook-url').value }, authHeaders()));
      if (apiKey !== currentKey) return;
      $('#webhook-secret').value = result.secret; maskSecret('#webhook-secret', '#webhook-secret-toggle', 'secret'); $('#webhook-secret-copy-state').textContent = ''; $('#webhook-secret-area').hidden = false;
      $('#webhook-state').textContent = 'Endpoint saved. Update the secret on your receiving server.';
    } catch { $('#error').textContent = 'Could not save the webhook endpoint. Use a valid HTTPS address.'; }
    finally { $('#webhook-save').disabled = !apiKey; }
  });
  $('#invoice-form').addEventListener('submit', async (event) => {
    event.preventDefault(); $('#create').disabled = true; $('#create').textContent = 'Creating payment…'; $('#error').textContent = '';
    const currentKey = apiKey;
    try {
      const payload = { orderId: $('#order').value, amount: $('#amount').value, feePayer: $('#fee').value };
      const returnUrl = $('#return-url').value.trim();
      $('#return-url-error').textContent = '';
      if (returnUrl) {
        let target; try { target = new URL(returnUrl); } catch { /* Validated below. */ }
        const local = target?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname);
        if (!target || (target.protocol !== 'https:' && !local) || target.username || target.password) {
          $('#return-url-error').textContent = 'Enter a valid HTTPS URL without a username or password.';
          return;
        }
        payload.returnUrl = target.href;
      }
      const serialized = JSON.stringify(payload);
      let attempt = pendingAttempt;
      if (!attempt || attempt.body !== serialized) {
        let storage; try { storage = window.localStorage; } catch { /* Storage may be disabled. */ }
        attempt = await createMerchantAttempt({ storage, crypto, merchant: merchantWallet, body: serialized });
      }
      if (apiKey !== currentKey) return;
      pendingAttempt = attempt;
      const invoice = await api('/api/v1/checkout/sessions', jsonPost(payload, { ...authHeaders(), 'idempotency-key': attempt.key }));
      if (apiKey !== currentKey) return;
      const target = new URL(invoice.checkoutUrl, location.href), currentOrigin = new URL(location.href).origin;
      if (target.origin !== currentOrigin || target.username || target.password || target.pathname !== `/pay/${invoice.id}` || target.search || target.hash || !/^0x[0-9a-f]{64}$/i.test(invoice.id)) throw new Error('Invalid checkout link');
      attempt.clear();
      pendingAttempt = null;
      $('#created-payment-link').value = target.href; $('#open-created-payment').href = target.href;
      $('#created-payment-state').textContent = ''; $('#created-payment').hidden = false;
      $('#order').value = ''; $('#amount').value = ''; $('#return-url').value = ''; updateFeePreview();
      try { await refreshList(); } catch { $('#error').textContent = 'Payment created, but the activity list could not be refreshed.'; }
    } catch (error) { $('#error').textContent = 'Could not confirm payment creation. Try again with the same details to safely recover the request.'; }
    finally { if (apiKey === currentKey) { $('#create').disabled = !apiKey; $('#create').textContent = 'Create payment'; } }
  });
}
