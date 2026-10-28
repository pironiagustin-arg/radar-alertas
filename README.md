# Radar de Alertas

Grupos de acciones con condiciones técnicas, fundamentals y objetivos propios. Rankea por cuántas se cumplen, tiene una IA interna que aprende tu forma de analizar y un bot de Telegram que avisa cuando se activa algo.

## Partes
| Parte | Dónde |
|---|---|
| Panel (ranking, grupos, ficha, alertas) | `public/` |
| Motor de indicadores y reglas (lo usan navegador y servidor) | `public/engine.js` |
| Datos de mercado (Yahoo Finance) | `api/data.js`, `lib/fetch.js` |
| Config sincronizada | `api/config.js` → Supabase `radar_kv` |
| IA interna (chat + herramientas) | `api/chat.js`, `lib/ai.js` |
| Tesis → perfil de análisis | `api/thesis.js`, `lib/ai.js` |
| Escaneo + avisos | `api/scan.js`, `lib/scan.js` (lo dispara pg_cron cada 30 min, lun-vie 10-18:30 ART) |
| Bot de Telegram | `api/telegram.js`, `api/setup.js` |

## Variables de entorno (Vercel → Settings → Environment Variables)
- `APP_PASSWORD` — tu contraseña para la app y para vincular Telegram (`/start TU_CONTRASEÑA`).
- `APP_SECRET` — clave que habilita la base de datos (te la pasó Claude; no se comparte).
- `ANTHROPIC_API_KEY` — de console.anthropic.com, para la IA.
- `TELEGRAM_BOT_TOKEN` — de @BotFather.

## Base de datos
Supabase (proyecto "screener"), tablas `radar_kv`, `radar_metrics`, `radar_theses`, `radar_messages`, `radar_alerts`. RLS exige el header `x-radar-key` = `APP_SECRET`, así que la anon key del código no alcanza para leer ni escribir.

## Local
```
npm install
APP_PASSWORD=... APP_SECRET=... ANTHROPIC_API_KEY=... npm run dev
```
