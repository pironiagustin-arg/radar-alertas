// GET /api/history?sym=NVDA → evolución diaria de scores
import { authed, send } from '../lib/http.js';
import { q } from '../lib/db.js';

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    const sym = (new URL(req.url, 'http://x').searchParams.get('sym') || '').toUpperCase().replace(/[^A-Z0-9.\-^]/g, '');
    const rows = await q(`radar_history?symbol=eq.${encodeURIComponent(sym)}&order=d.asc&limit=400&select=d,total,at,af,trend,trig,price`);
    send(res, 200, { rows });
  } catch (e) { send(res, 500, { error: e.message }); }
}
