// Lo llama Supabase (pg_cron) cada 30 min en horario de mercado, o la app con contraseña
import { cronOk, authed, send } from '../lib/http.js';
import { scanAndNotify } from '../lib/scan.js';

export default async function handler(req, res) {
  if (!cronOk(req) && !authed(req, res)) return;
  try { send(res, 200, await scanAndNotify()); }
  catch (e) { send(res, 500, { error: e.message }); }
}
