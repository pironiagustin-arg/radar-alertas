// Webhook del bot de Telegram
import { tgSecretOk, safeEq, send, readBody } from '../lib/http.js';
import { kvGet, kvSet } from '../lib/db.js';
import { tg, sendText, mdToTg, downloadFile, escHtml } from '../lib/telegram.js';
import { loadConfig, runScan, rankingText, scanAndNotify } from '../lib/scan.js';
import { chat } from '../lib/ai.js';

const HELP = `<b>📡 Radar de Alertas</b>
/ranking — top 10 (/ranking at · /ranking af)
/mercado — VIX y SPY
/ticker NVDA — ficha rápida
/escanear — forzar escaneo de alertas
Cualquier otro mensaje va a la IA. Mandame screenshots de métricas y los guardo.`;

export default async function handler(req, res) {
  if (!tgSecretOk(req)) return send(res, 401, { error: 'no' });
  const upd = await readBody(req);
  const msg = upd.message || upd.edited_message;
  try {
    // evita procesar dos veces el mismo update si Telegram reintenta
    const last = (await kvGet('tg_last_update')) || 0;
    if (upd.update_id && upd.update_id <= last) return send(res, 200, { dup: true });
    await kvSet('tg_last_update', upd.update_id || last);
    if (!msg?.chat) return send(res, 200, {});
    const chatId = msg.chat.id;
    const text = (msg.text || msg.caption || '').trim();
    const owner = await kvGet('telegram_chat');

    if (text.startsWith('/start')) {
      const pass = text.split(/\s+/)[1];
      if (safeEq(pass, process.env.APP_PASSWORD)) {
        await kvSet('telegram_chat', chatId);
        await sendText(chatId, '✅ Conectado. Desde ahora te aviso acá cuando se cumplan condiciones.\n\n' + HELP);
      } else await sendText(chatId, 'Mandá <code>/start TU_CONTRASEÑA</code> (la misma de la app) para vincular este chat.');
      return send(res, 200, {});
    }
    if (String(owner) !== String(chatId)) { await sendText(chatId, 'Este bot es privado. Vinculalo con <code>/start TU_CONTRASEÑA</code>.'); return send(res, 200, {}); }

    await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    if (text === '/help' || text === '/ayuda') { await sendText(chatId, HELP); return send(res, 200, {}); }
    if (text.startsWith('/ranking') || text.startsWith('/mercado') || text.startsWith('/ticker')) {
      const cfg = await loadConfig();
      if (!cfg) { await sendText(chatId, 'Todavía no hay configuración guardada. Abrí la app una vez.'); return send(res, 200, {}); }
      const sym = text.startsWith('/ticker') ? text.split(/\s+/)[1]?.toUpperCase() : null;
      const { market, results } = await runScan(cfg, { only: sym ? [sym] : null });
      if (text.startsWith('/mercado')) {
        const s = market.rules.filter((r) => r.met).map((r) => `${r.pol > 0 ? '🟢' : '🔴'} ${escHtml(r.label)}`).join('\n') || 'Sin señales';
        await sendText(chatId, `<b>Mercado</b>\nVIX <b>${market.vix.toFixed(1)}</b> · SPY ${market.spyDD.toFixed(1)}% desde máx · ${market.spyD200 > 0 ? '+' : ''}${market.spyD200.toFixed(1)}% vs EMA200\n\n${s}`);
      } else if (sym) {
        const r = results[0];
        if (!r || r.error) await sendText(chatId, `No encontré ${escHtml(sym)} en el radar.`);
        else await sendText(chatId, `<b>${sym}</b> ${r.t.price.toFixed(2)} · score <b>${r.score}</b> (${r.metPos}/${r.totPos})\nRSI ${r.t.rsiNow.toFixed(0)} · ${r.t.d200 > 0 ? '+' : ''}${r.t.d200.toFixed(1)}% vs EMA200 · P/E fwd ${r.f?.forwardPE ?? '—'} · PEG ${r.f?.peg ?? '—'}\n\n${r.rules.filter((x) => x.met).map((x) => `${x.pol > 0 ? '🟢' : '🔴'} ${escHtml(x.label)} <code>${escHtml(x.val)}</code>`).join('\n') || 'Sin señales activas'}`);
      } else { const a = (text.split(/\s+/)[1] || '').toLowerCase(); const by = a === 'at' ? 'tec' : a === 'af' ? 'fun' : 'total'; await sendText(chatId, `<b>Ranking ${by === 'tec' ? 'técnico' : by === 'fun' ? 'fundamental' : 'total'}</b>\n${rankingText(results, 10, by)}`); }
      return send(res, 200, {});
    }
    if (text.startsWith('/escanear')) {
      const r = await scanAndNotify();
      await sendText(chatId, r.first ? 'Primer escaneo: guardé el estado. Te aviso de cambios desde el próximo.' : `Escaneo listo: ${r.fresh || 0} cambio(s), ${r.sent || 0} avisado(s).`);
      return send(res, 200, {});
    }

    // Mensaje libre o foto → IA
    const content = [];
    const photo = msg.photo?.at(-1);
    const docImg = msg.document?.mime_type?.startsWith('image/') ? msg.document : null;
    if (photo || docImg) {
      const buf = await downloadFile((photo || docImg).file_id);
      content.push({ type: 'image', source: { type: 'base64', media_type: docImg?.mime_type || 'image/jpeg', data: buf.toString('base64') } });
    }
    content.push({ type: 'text', text: text || 'Guardá y procesá las métricas de esta captura.' });
    const out = await chat('tg', content);
    await sendText(chatId, mdToTg(out.text));
  } catch (e) {
    if (msg?.chat?.id) await sendText(msg.chat.id, '⚠️ ' + escHtml(e.message)).catch(() => {});
  }
  send(res, 200, {});
}
