import { DatabaseMigrationRequiredError } from '../storage/local-database.mjs';
import { SetupRecoveryRequiredError } from './setup-service.mjs';

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };
const json = (value, status = 200) => new Response(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });

async function readJson(request) {
  if (request.headers.get('content-type') !== 'application/json' || !request.body) throw new Error('Invalid request');
  const reader = request.body.getReader();
  const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new Error('Request too large'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error('Invalid request');
  return result;
}

export function createSetupApp({ service, origin, assets }) {
  return async (request) => {
    const url = new URL(request.url);
    if (url.origin !== origin) return json({ error: 'forbidden' }, 403);
    if (request.method === 'GET') {
      const asset = { '/': ['html', 'text/html'], '/setup.js': ['javascript', 'text/javascript'], '/setup.css': ['css', 'text/css'] }[url.pathname];
      if (!asset || url.search) return json({ error: 'not_found' }, 404);
      return new Response(assets[asset[0]], { headers: { ...headers, 'content-type': `${asset[1]}; charset=utf-8` } });
    }
    if (request.method !== 'POST' || request.headers.get('origin') !== origin || url.search) return json({ error: 'forbidden' }, 403);
    const actions = { '/api/prepare': (input) => service.prepare(input), '/api/reserve': (input) => service.reserve(input),
      '/api/submitted': (input) => service.submitted(input), '/api/confirm': () => service.confirm(), '/api/recover': (input) => service.recover(input), '/api/start': (input) => service.start(input) };
    if (!Object.hasOwn(actions, url.pathname)) return json({ error: 'not_found' }, 404);
    try { return json(await actions[url.pathname](await readJson(request))); }
    catch (error) {
      if (url.pathname === '/api/start' && error instanceof DatabaseMigrationRequiredError) return json({ error: 'database_migration_required' }, 409);
      if (['/api/prepare', '/api/start'].includes(url.pathname) && error instanceof SetupRecoveryRequiredError) return json({ error: 'setup_recovery_required' }, 409);
      return json({ error: 'setup_failed' }, 400);
    }
  };
}

