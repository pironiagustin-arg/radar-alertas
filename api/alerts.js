import { authed, send } from '../lib/http.js';
import { q } from '../lib/db.js';

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try { send(res, 200, { alerts: await q('radar_alerts?order=created_at.desc&limit=200') }); }
  catch (e) { send(res, 500, { error: e.message }); }
}
