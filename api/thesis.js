import { authed, send, readBody } from '../lib/http.js';
import { q, kvGet, kvSet } from '../lib/db.js';
import { ingestThesis, rebuildProfile } from '../lib/ai.js';

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET') {
      const [theses, profile] = await Promise.all([
        q('radar_theses?select=id,ticker,title,summary,criteria,created_at&order=created_at.desc'),
        kvGet('analyst_profile'),
      ]);
      return send(res, 200, { theses, profile });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (b.action === 'profile_notes') { // correcciones manuales al perfil
        const p = (await kvGet('analyst_profile')) || {};
        await kvSet('analyst_profile', { ...p, notes: b.notes || '' });
        return send(res, 200, { profile: await rebuildProfile() });
      }
      if (!b.text && !b.pdf) return send(res, 400, { error: 'Mandá texto o un PDF' });
      return send(res, 200, await ingestThesis({ text: b.text, pdfBase64: b.pdf, filename: b.filename }));
    }
    if (req.method === 'DELETE') {
      const id = +url.searchParams.get('id');
      await q(`radar_theses?id=eq.${id}`, { method: 'DELETE' });
      return send(res, 200, { profile: await rebuildProfile() });
    }
    send(res, 405, { error: 'método' });
  } catch (e) { send(res, 500, { error: e.message }); }
}
