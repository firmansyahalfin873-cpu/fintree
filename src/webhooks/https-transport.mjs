import { lookup as systemLookup } from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export function validateWebhookUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new TypeError('Invalid destination');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') ||
      !url.hostname.includes('.') || net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new TypeError('Invalid destination');
  return url;
}

/** IPv4 only for now. Reject private, loopback, link-local and reserved ranges. */
function publicIPv4(value) {
  try {
    if (net.isIP(value) !== 4) return false;
    const parsed = ipaddr.parse(value);
    return parsed.kind() === 'ipv4' && parsed.range() === 'unicast';
  } catch { return false; }
}

/**
 * Resolves once, rejects mixed/private answers, pins the validated IP, keeps TLS
 * hostname verification, refuses redirects, and bounds total time. The caller
 * must protect configuration, scheduling, and run independent security review.
 */
export function createWebhookTransport({ lookup = systemLookup, request = https.request, timeoutMs = 10000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new RangeError('Invalid timeout');
  return async ({ url: destination, body, headers }) => {
    const url = validateWebhookUrl(destination);
    if (!Buffer.isBuffer(body) || body.length > 65536 || headers?.['content-type'] !== 'application/json' || typeof headers?.['x-fintree-signature'] !== 'string') throw new TypeError('Invalid delivery');
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Webhook timeout')); }, timeoutMs);
    });
    const send = (async () => {
      const addresses = await lookup(url.hostname, { all: true, family: 4, verbatim: true });
      if (controller.signal.aborted) throw new Error('Webhook timeout');
      if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => entry.family !== 4 || !publicIPv4(entry.address))) throw new Error('Unsafe destination');
      const pinned = addresses[0].address;
      return await new Promise((resolve, reject) => {
        const req = request({ hostname: url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: 'POST',
          family: 4, autoSelectFamily: false, agent: false, servername: url.hostname, signal: controller.signal,
          lookup: (_host, _options, callback) => callback(null, pinned, 4),
          headers: { 'content-type': 'application/json', 'content-length': body.length, 'x-fintree-signature': headers['x-fintree-signature'] } },
        (res) => { const status = res.statusCode; res.destroy(); resolve({ status }); });
        req.on('error', reject);
        req.end(body);
      });
    })();
    try { return await Promise.race([send, timeout]); } finally { clearTimeout(timer); }
  };
}
