import { authed, send, readBody } from '../lib/http.js';
import { kvGet, kvSet } from '../lib/db.js';

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    if (req.method === 'GET') return send(res, 200, { config: await kvGet('config'), telegram: !!(await kvGet('telegram_chat')) });
    if (req.method === 'PUT') {
      const { config } = await readBody(req);
      if (!config?.groups) return send(res, 400, { error: 'config inválida' });
      await kvSet('config', config);
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: 'método' });
  } catch (e) { send(res, 500, { error: e.message }); }
}
