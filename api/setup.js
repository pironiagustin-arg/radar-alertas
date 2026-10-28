// Conecta el bot de Telegram a este deploy (webhook + comandos) y muestra el estado
import { authed, send, tgSecret } from '../lib/http.js';
import { kvGet } from '../lib/db.js';
import { tg } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (!authed(req, res)) return;
  const status = { anthropic: !!process.env.ANTHROPIC_API_KEY, telegramToken: !!process.env.TELEGRAM_BOT_TOKEN };
  try {
    status.chatVinculado = !!(await kvGet('telegram_chat'));
    if (status.telegramToken) {
      const me = await tg('getMe', {}); status.bot = me.username;
      if (req.method === 'POST') {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        await tg('setWebhook', { url: `https://${host}/api/telegram`, secret_token: tgSecret(), allowed_updates: ['message'], drop_pending_updates: true });
        await tg('setMyCommands', { commands: [
          { command: 'ranking', description: 'Top 10 del radar' },
          { command: 'mercado', description: 'VIX y SPY' },
          { command: 'ticker', description: 'Ficha rápida: /ticker NVDA' },
          { command: 'escanear', description: 'Forzar escaneo de alertas' },
        ] });
      }
      const wh = await tg('getWebhookInfo', {}); status.webhook = wh.url || null; status.webhookError = wh.last_error_message || null;
    }
    send(res, 200, status);
  } catch (e) { send(res, 200, { ...status, error: e.message }); }
}
