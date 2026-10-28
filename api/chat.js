import { authed, send, readBody } from '../lib/http.js';
import { q } from '../lib/db.js';
import { chat } from '../lib/ai.js';

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  try {
    if (req.method === 'GET') {
      const rows = await q('radar_messages?channel=in.(web,tg)&order=created_at.desc&limit=60');
      return send(res, 200, { messages: rows.reverse().map((r) => ({ role: r.role, channel: r.channel, at: r.created_at, text: r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') })) });
    }
    const { text, images = [] } = await readBody(req);
    const content = [
      ...images.slice(0, 6).map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type || 'image/jpeg', data: im.data } })),
      { type: 'text', text: text?.trim() || (images.length ? 'Guardá y procesá las métricas de estas capturas.' : '…') },
    ];
    const out = await chat('web', content);
    send(res, 200, out);
  } catch (e) { send(res, 500, { error: e.message }); }
}
