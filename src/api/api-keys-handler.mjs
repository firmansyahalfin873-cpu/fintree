import { authenticateApiKey, issueApiKey, revokeApiKey } from '../auth/api-keys.mjs';

/** Manage only the authenticated merchant's keys. Raw keys are never listed. */
export function createApiKeysHandler({ db }) {
  const reply = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  return async (request) => {
    try {
      const bearer = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
      const identity = bearer ? await authenticateApiKey(db, bearer[1]) : null;
      if (!identity) return reply(401, { error: 'unauthorized' });
      const path = new URL(request.url).pathname;
      if (path === '/api/v1/api-keys' && request.method === 'GET') {
        const cursor = new URL(request.url).searchParams.get('starting_after');
        if (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) return reply(400, { error: 'invalid_cursor' });
        if (cursor && !(await db.query('select 1 from fintree_private.api_keys where id=$1 and merchant_id=$2', [cursor, identity.merchantId])).rows.length) return reply(400, { error: 'invalid_cursor' });
        const rows = (await db.query(`select id,key_prefix,created_at,revoked_at from fintree_private.api_keys
          where merchant_id=$1 and ($2::uuid is null or (created_at,id) < (select created_at,id from fintree_private.api_keys where id=$2::uuid and merchant_id=$1))
          order by created_at desc,id desc limit 51`, [identity.merchantId, cursor])).rows;
        const hasMore = rows.length > 50, page = rows.slice(0, 50);
        return reply(200, { data: page.map((row) => ({ id: row.id, prefix: row.key_prefix, createdAt: new Date(row.created_at).toISOString(), revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null, current: row.id === identity.keyId })), nextCursor: hasMore ? page.at(-1).id : null });
      }
      if (path === '/api/v1/api-keys' && request.method === 'POST') {
        const issued = await issueApiKey(db, identity.merchantId);
        return reply(201, { id: issued.id, prefix: issued.prefix, key: issued.key });
      }
      const keyMatch = /^\/api\/v1\/api-keys\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path);
      if (keyMatch && request.method === 'DELETE') {
        const revoked = await revokeApiKey(db, identity.merchantId, keyMatch[1]);
        return revoked ? reply(200, { revoked: true, current: keyMatch[1].toLowerCase() === identity.keyId.toLowerCase() }) : reply(404, { error: 'not_found' });
      }
      return reply(404, { error: 'not_found' });
    } catch { return reply(500, { error: 'internal_error' }); }
  };
}
