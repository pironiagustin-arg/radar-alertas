// GET /api/history?sym=NVDA → evolución diaria de un ticker
// GET /api/history?since=2026-10-20 → todas las filas desde esa fecha (para "qué cambió")
import { authed, send } from '../lib/http.js';
import { q } from '../lib/db.js';

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    const u = new URL(req.url, 'http://x').searchParams;
    const since = (u.get('since') || '').replace(/[^0-9-]/g, '');
    if (since) {
      const rows = await q(`radar_history?d=gte.${since}&total=not.is.null&order=d.asc&limit=5000&select=d,symbol,total,at,af`);
      return send(res, 200, { rows });
    }
    const sym = (u.get('sym') || '').toUpperCase().replace(/[^A-Z0-9.\-^]/g, '');
    const rows = await q(`radar_history?symbol=eq.${encodeURIComponent(sym)}&order=d.asc&limit=400&select=d,total,at,af,trend,trig,price`);
    send(res, 200, { rows });
  } catch (e) { send(res, 500, { error: e.message }); }
}
