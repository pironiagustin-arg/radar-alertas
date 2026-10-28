// Servidor local: `npm install && npm run dev` → http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import handler from './api/data.js';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/data')) return handler(req, res);
  const p = req.url.split('?')[0];
  const file = join('public', p === '/' ? 'index.html' : p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'text/plain' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(process.env.PORT || 3000, () => console.log('Radar de Alertas → http://localhost:' + (process.env.PORT || 3000)));
