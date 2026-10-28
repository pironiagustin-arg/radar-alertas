const api = (m) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${m}`;

export async function tg(method, body) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('Falta TELEGRAM_BOT_TOKEN en Vercel');
  const r = await fetch(api(method), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error('Telegram: ' + j.description);
  return j.result;
}

const escHtml = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Convierte el markdown simple del modelo a HTML de Telegram
export function mdToTg(md) {
  return escHtml(md)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

export async function sendText(chatId, text, { html = true } = {}) {
  // Telegram corta en 4096 caracteres
  const parts = []; let s = text;
  while (s.length > 3900) { const i = s.lastIndexOf('\n', 3900); parts.push(s.slice(0, i > 0 ? i : 3900)); s = s.slice(i > 0 ? i : 3900); }
  parts.push(s);
  for (const p of parts) {
    try { await tg('sendMessage', { chat_id: chatId, text: html ? p : p, parse_mode: html ? 'HTML' : undefined, disable_web_page_preview: true }); }
    catch { await tg('sendMessage', { chat_id: chatId, text: p.replace(/<[^>]+>/g, '') }); } // fallback sin formato
  }
}

export async function downloadFile(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`);
  return Buffer.from(await r.arrayBuffer());
}

export { escHtml };
