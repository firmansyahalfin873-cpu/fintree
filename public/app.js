const $ = (selector) => document.querySelector(selector);
const checkoutId = /^\/pay\/(0x[0-9a-f]{64})$/.exec(location.pathname)?.[1];
let sessions = [];

function tokenAmount(value) {
  const atomic = BigInt(value), whole = atomic / 1000000n, fraction = (atomic % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction.padEnd(2, '0')}` : '.00'}`;
}
const money = (value) => `${tokenAmount(value)} TUSD`;
async function api(path, options) {
  const response = await fetch(path, options), result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed. Please try again.');
  return result;
}
function statusText(status) { return ({ paid: 'Paid', pending: 'Pending', confirming: 'Confirming', expired: 'Expired' })[status] || 'Unknown'; }
function detail(label, value) {
  const row = document.createElement('div'); row.className = 'detail-row';
  const name = document.createElement('span'), content = document.createElement('strong');
  name.textContent = label; content.textContent = value; row.append(name, content); return row;
}
function renderFeePreview() {
  const preview = $('#fee-preview'), match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec($('#amount').value);
  if (!match || match[1].length > 30) { preview.hidden = true; return; }
  const amount = BigInt(match[1]) * 1000000n + BigInt((match[2] || '').padEnd(6, '0'));
  if (amount === 0n) { preview.hidden = true; return; }
  const fee = (amount * 30n + 5000n) / 10000n, customerPays = $('#fee').value === 'customer';
  preview.replaceChildren(detail('Protocol fee', money(fee)), detail('Customer pays', money(customerPays ? amount + fee : amount)), detail('Merchant receives', money(customerPays ? amount : amount - fee)));
  preview.hidden = false;
}
function renderInvoices() {
  const list = $('#invoices'), query = $('#payment-search').value.trim().toLowerCase(), filter = $('#status-filter').value;
  list.replaceChildren();
  const visible = sessions.filter((item) => item.orderId.toLowerCase().includes(query) && (filter === 'all' || item.status === filter));
  if (!visible.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const inner = document.createElement('div'), icon = document.createElement('span'); icon.className = 'empty-icon'; icon.textContent = '↗';
    const message = document.createElement('p'); message.textContent = sessions.length ? 'No payments match your search.' : 'No payments yet. Create your first payment to see it here.';
    inner.append(icon, message); empty.append(inner); list.append(empty); return;
  }
  for (const session of visible) {
    const link = document.createElement('a'); link.className = 'invoice'; link.href = `/pay/${session.id}`;
    const left = document.createElement('div'), right = document.createElement('div'); right.className = 'invoice-right';
    const title = document.createElement('div'); title.className = 'order'; title.textContent = session.orderId;
    const id = document.createElement('small'); id.textContent = `${session.id.slice(0, 12)}…`;
    const amount = document.createElement('strong'); amount.textContent = money(session.totalPayable);
    const pill = document.createElement('span'); pill.className = `pill ${session.status === 'paid' ? '' : 'pending'}`; pill.textContent = statusText(session.status);
    left.append(title, id); right.append(amount, pill); link.append(left, right); list.append(link);
  }
}
async function loadInvoices() {
  try {
    ({ sessions } = await api('/api/demo/sessions'));
    $('#metric-count').textContent = sessions.length;
    $('#metric-pending').textContent = sessions.filter((item) => item.status === 'pending' || item.status === 'confirming').length;
    $('#metric-paid').textContent = sessions.filter((item) => item.status === 'paid').length;
    $('#global-error').textContent = ''; renderInvoices();
  } catch { $('#global-error').textContent = 'Could not load payments. Select Refresh to try again.'; }
}
async function loadCheckout() {
  const session = await api(`/api/demo/sessions/${checkoutId}`);
  $('#checkout-title').textContent = session.orderId;
  $('#checkout-total').textContent = tokenAmount(session.totalPayable);
  const status = $('#checkout-status'); status.textContent = statusText(session.status); status.className = `pill ${session.status === 'paid' ? '' : 'pending'}`;
  $('#checkout-details').replaceChildren(detail('Order amount', money(session.invoiceAmount)), detail('Protocol fee', money(session.protocolFee)), detail('Fee paid by', session.feePayer === 'customer' ? 'Customer' : 'Merchant'), detail('Merchant receives', money(session.merchantAmount)), detail('Expires', new Date(session.deadline * 1000).toLocaleString('en-US')));
  const pay = $('#pay'); pay.disabled = session.status !== 'pending' || Date.now() > session.deadline * 1000;
  if (session.status === 'paid') { pay.textContent = 'Payment verified'; $('#checkout-message').textContent = 'The simulated payment has been confirmed.'; }
  else if (Date.now() > session.deadline * 1000) { pay.textContent = 'Payment expired'; }
}
if (checkoutId) {
  $('#checkout').hidden = false;
  $('#copy-checkout').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); $('#copy-message').textContent = 'Checkout link copied.'; }
    catch { $('#copy-message').textContent = 'Could not copy automatically. Copy the address from your browser instead.'; }
  });
  loadCheckout().catch(() => { $('#global-error').textContent = 'Could not load this payment. Return to your workspace and try again.'; $('#pay').disabled = true; });
  $('#pay').addEventListener('click', async () => {
    const button = $('#pay'); button.disabled = true; button.textContent = 'Processing payment…';
    try { await api(`/api/demo/pay/${checkoutId}`, { method: 'POST' }); await loadCheckout(); }
    catch { $('#global-error').textContent = 'Payment could not be completed. Please try again.'; button.disabled = false; button.textContent = 'Try payment again'; }
  });
} else {
  $('#dashboard').hidden = false; loadInvoices();
  $('#refresh').addEventListener('click', loadInvoices);
  $('#payment-search').addEventListener('input', renderInvoices);
  $('#status-filter').addEventListener('change', renderInvoices);
  $('#amount').addEventListener('input', renderFeePreview);
  $('#fee').addEventListener('change', renderFeePreview);
  $('#invoice-form').addEventListener('submit', async (event) => {
    event.preventDefault(); $('#global-error').textContent = '';
    const button = event.currentTarget.querySelector('button'); button.disabled = true; button.textContent = 'Creating payment…';
    try {
      const session = await api('/api/demo/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: $('#order').value, amount: $('#amount').value, feePayer: $('#fee').value }) });
      location.href = `/pay/${session.id}`;
    } catch { $('#global-error').textContent = 'Could not create payment. Check the order and amount, then try again.'; button.disabled = false; button.textContent = 'Create payment ↗'; }
  });
}
