// Cloud copy of the Taekwondo Timer training record.
//   GET /state  returns { data, updatedAt } ({ data: null, updatedAt: 0 } before the first upload)
//   PUT /state  stores { data, updatedAt }
// Both need "Authorization: Bearer <SYNC_SECRET>". Browsers may only call it from ALLOWED_ORIGIN.

const KEY = 'state';
const MAX_BYTES = 1_000_000;

export default {
  /**
   * @param {Request} request
   * @param {{ SYNC_KV: KVNamespace, SYNC_SECRET?: string, ALLOWED_ORIGIN: string }} env
   */
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    // Other sites get no CORS headers, so their pages cannot read anything.
    if (origin && origin !== env.ALLOWED_ORIGIN) return new Response('Origin not allowed', { status: 403 });
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const reply = (status, body, headers = {}) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
      });

    if (new URL(request.url).pathname !== '/state') return reply(404, { error: 'Not found' });

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (!env.SYNC_SECRET) return reply(500, { error: 'SYNC_SECRET is not set. Run: wrangler secret put SYNC_SECRET' });
    if (!env.SYNC_KV) return reply(500, { error: 'The SYNC_KV binding is missing from wrangler.toml.' });
    if (!(await authorized(request, env.SYNC_SECRET))) {
      return reply(401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    }

    if (request.method === 'GET') {
      return reply(200, (await env.SYNC_KV.get(KEY)) ?? { data: null, updatedAt: 0 });
    }

    if (request.method === 'PUT') {
      if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return reply(413, { error: 'Too large' });
      const text = await request.text();
      if (text.length > MAX_BYTES) return reply(413, { error: 'Too large' });
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return reply(400, { error: 'Body is not JSON' });
      }
      if (!isObject(body) || !isObject(body.data) || !Number.isFinite(body.updatedAt)) {
        return reply(400, { error: 'Expected { data: object, updatedAt: number }' });
      }
      // Never let an older copy (a phone that was offline for a while) replace a newer one.
      const current = await env.SYNC_KV.get(KEY, 'json');
      if (current && current.updatedAt > body.updatedAt) {
        return reply(409, { error: 'The cloud copy is newer', updatedAt: current.updatedAt });
      }
      try {
        await env.SYNC_KV.put(KEY, JSON.stringify({ data: body.data, updatedAt: body.updatedAt }));
      } catch {
        // KV allows about one write per second to the same key; the app retries.
        return reply(503, { error: 'Could not save, try again' });
      }
      return reply(200, { ok: true, updatedAt: body.updatedAt });
    }

    return reply(405, { error: 'Method not allowed' }, { Allow: 'GET, PUT, OPTIONS' });
  },
};

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Constant-time check of the bearer token (both sides hashed first, so lengths match). */
async function authorized(request, secret) {
  const match = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '');
  if (!match) return false;
  const [a, b] = await Promise.all([digest(match[1]), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
