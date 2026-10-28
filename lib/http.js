import crypto from 'node:crypto';

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

export async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

// La app pide la contraseña (APP_PASSWORD) una vez por dispositivo y la manda en cada request
export function authed(req, res) {
  if (!process.env.APP_PASSWORD || !process.env.APP_SECRET) {
    send(res, 500, { error: 'Faltan variables APP_PASSWORD / APP_SECRET en Vercel' }); return false;
  }
  if (safeEq(req.headers['x-app-password'], process.env.APP_PASSWORD)) return true;
  send(res, 401, { error: 'Contraseña incorrecta' }); return false;
}

export const cronOk = (req) => safeEq(req.headers['x-cron-key'], process.env.APP_SECRET);
export const tgSecret = () => crypto.createHash('sha256').update('tg:' + (process.env.APP_SECRET || '')).digest('hex').slice(0, 48);
export const tgSecretOk = (req) => safeEq(req.headers['x-telegram-bot-api-secret-token'], tgSecret());
export { safeEq };
