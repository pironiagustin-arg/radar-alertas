import { authed, send, readBody } from '../lib/http.js';
import { kvGet, kvSet } from '../lib/db.js';

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    if (req.method === 'GET') return send(res, 200, { config: await kvGet('config'), telegram: !!(await kvGet('telegram_chat')) });
    if (req.method === 'PUT') {
      const { config, baseRev } = await readBody(req);
      if (!config?.groups) return send(res, 400, { error: 'config inválida' });
      // control de versión: si alguien guardó después de que esta pestaña cargó, no la pisamos
      const stored = await kvGet('config');
      if (stored?.rev && baseRev !== stored.rev) return send(res, 409, { error: 'versión vieja', config: stored });
      config.rev = Date.now();
      await kvSet('config', config);
      return send(res, 200, { ok: true, rev: config.rev });
    }
    send(res, 405, { error: 'método' });
  } catch (e) { send(res, 500, { error: e.message }); }
}
