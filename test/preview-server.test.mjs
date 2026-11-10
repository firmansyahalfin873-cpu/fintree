import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

test('local preview creates and pays an invoice without exposing real funds', { timeout: 60000 }, async (t) => {
  const port = await unusedPort(), origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/preview-server.mjs'], { env: { ...process.env, FINTREE_PREVIEW_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Preview did not start: ${output.slice(-1000)}`)), 45000);
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('Fintree simulasi lokal:')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { if (!output.includes('Fintree simulasi lokal:')) { clearTimeout(timer); reject(new Error(`Preview exited ${code}: ${output.slice(-1000)}`)); } });
  });
  assert.match(await (await fetch(origin)).text(), /Money moves/);
  assert.match(await (await fetch(`${origin}/dashboard`)).text(), /local simulation/i);
  assert.equal((await fetch(`${origin}/landing.css`)).status, 200);
  assert.match(await (await fetch(`${origin}/developers`)).text(), /Create a checkout session/);
  assert.match((await fetch(`${origin}/developers.js`)).headers.get('content-type'), /javascript/);
  assert.match((await fetch(`${origin}/site-nav.js`)).headers.get('content-type'), /javascript/);
  assert.match((await fetch(`${origin}/workspace-nav.js`)).headers.get('content-type'), /javascript/);
  assert.match(await (await fetch(`${origin}/help`)).text(), /How can we help/);
  assert.match((await fetch(`${origin}/help.js`)).headers.get('content-type'), /javascript/);
  assert.match(await (await fetch(`${origin}/security`)).text(), /Payment verification/);
  assert.match(await (await fetch(`${origin}/pricing`)).text(), /Try the numbers/);
  assert.match((await fetch(`${origin}/pricing.js`)).headers.get('content-type'), /javascript/);
  assert.match((await fetch(`${origin}/landing.js`)).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${origin}/payment-flow-art.png`)).headers.get('content-type'), 'image/png');
  const payload = JSON.stringify({ orderId: 'test-order', amount: '15.25', feePayer: 'customer' });
  assert.equal((await fetch(`${origin}/api/demo/sessions`, { method: 'POST', headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' }, body: payload })).status, 403);
  const response = await fetch(`${origin}/api/demo/sessions`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: payload });
  assert.equal(response.status, 201);
  const session = await response.json();
  assert.equal(session.totalPayable, '15295750');
  assert.equal((await (await fetch(`${origin}/api/demo/sessions/${session.id}`)).json()).status, 'pending');
  assert.match(await (await fetch(`${origin}/pay/${session.id}`)).text(), /SIMULATED CHECKOUT/);
  const paid = await fetch(`${origin}/api/demo/pay/${session.id}`, { method: 'POST', headers: { origin } });
  assert.equal((await paid.json()).status, 'paid');
  assert.equal((await (await fetch(`${origin}/api/demo/sessions/${session.id}`)).json()).status, 'paid');
});
