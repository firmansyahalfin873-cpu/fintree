import http from 'node:http';
import { Readable } from 'node:stream';

/** Local-only adapter. A production reverse proxy and access controls are not included. */
export function createLocalNodeServer({ app, port }) {
  if (typeof app !== 'function' || !Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError('Invalid server configuration');
  const origin = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (incoming, outgoing) => {
    try {
      if (incoming.headers.host !== `127.0.0.1:${port}` || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(403); outgoing.end(); return; }
      const init = { method: incoming.method, headers: incoming.headers };
      if (!['GET', 'HEAD'].includes(incoming.method)) { init.body = Readable.toWeb(incoming); init.duplex = 'half'; }
      const response = await app(new Request(new URL(incoming.url, origin), init));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) outgoing.end();
      else Readable.fromWeb(response.body).pipe(outgoing);
    } catch { if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' }); outgoing.end('{"error":"internal_error"}'); }
  });
  return { server, origin, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }) };
}
