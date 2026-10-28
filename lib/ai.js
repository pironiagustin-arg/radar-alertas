// IA interna del Radar: chat con herramientas (guardar métricas de screenshots, leer el radar,
// consultar tesis, fijar objetivos) + aprendizaje del estilo de análisis a partir de tesis propias.
import { q, kvGet, kvSet, insert } from './db.js';
import { loadConfig, runScan, snapshot } from './scan.js';
import { create } from './llm.js';

export const MODEL = 'auto'; // lo elige lib/llm.js según la key cargada
const client = () => ({ messages: { create } });
const textOf = (msg) => msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

// ───────────── Herramientas ─────────────
const TOOLS = [
  {
    name: 'save_metrics',
    description: 'Guarda métricas en la base del usuario. Usala SIEMPRE que el usuario mande un screenshot o tabla con datos de una empresa (ratios, márgenes, EPS, revenue, guidance, KPIs, precios objetivo). Una fila por métrica y período.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Ticker en mayúsculas, ej. NVDA' },
        source: { type: 'string', description: 'De dónde sale: Koyfin, Fiscal.ai, TradingView, balance, etc.' },
        metrics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              metric: { type: 'string', description: 'Nombre normalizado en español o estándar: revenue, eps, margen_bruto, pe_fwd, peg, roic, fcf, ev_ebitda...' },
              value: { type: 'number', description: 'Valor numérico (porcentajes como número: 45.2 = 45.2%)' },
              value_text: { type: 'string', description: 'Si no es numérico o para unidades (ej. "USD 35.1B")' },
              period: { type: 'string', description: 'Período: FY2025, Q3-2026, TTM, NTM, actual' },
              note: { type: 'string' },
            },
            required: ['metric'],
          },
        },
      },
      required: ['ticker', 'metrics'],
    },
  },
  {
    name: 'get_saved_metrics',
    description: 'Lee métricas guardadas antes (de screenshots o tesis) para un ticker. Opcionalmente filtrá por métrica.',
    input_schema: { type: 'object', properties: { ticker: { type: 'string' }, metric: { type: 'string' } }, required: ['ticker'] },
  },
  {
    name: 'get_radar',
    description: 'Datos en vivo del radar para tickers: precio, score, señales técnicas y fundamentals activas, RSI, distancia a EMAs, P/E fwd, PEG, EV/EBITDA, earnings, objetivos de venta. Sin tickers devuelve el ranking completo y el estado del mercado (VIX, SPY).',
    input_schema: { type: 'object', properties: { tickers: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'get_thesis',
    description: 'Devuelve las tesis propias del usuario sobre un ticker (resumen, criterios, precio justo, reglas de venta).',
    input_schema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] },
  },
  {
    name: 'set_target',
    description: 'Carga o cambia un objetivo del usuario para un ticker del radar: número de venta y/o promedio de referencia de una métrica. Solo cuando el usuario lo pide explícitamente.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string' },
        metric: { type: 'string', enum: ['price', 'forwardPE', 'trailingPE', 'peg', 'evEbitda', 'rsi'] },
        venta: { type: 'number' }, promedio: { type: 'number' },
      },
      required: ['ticker', 'metric'],
    },
  },
  {
    name: 'add_tickers',
    description: 'Agrega tickers a un grupo del radar (o los mueve). Solo cuando el usuario lo pide.',
    input_schema: { type: 'object', properties: { group: { type: 'string', description: 'Nombre del grupo' }, tickers: { type: 'array', items: { type: 'string' } } }, required: ['group', 'tickers'] },
  },
];

async function runTool(name, input) {
  const T = (s) => String(s || '').trim().toUpperCase();
  if (name === 'save_metrics') {
    const rows = (input.metrics || []).map((m) => ({
      ticker: T(input.ticker), metric: String(m.metric).toLowerCase().trim(), value: typeof m.value === 'number' ? m.value : null,
      value_text: m.value_text || null, period: m.period || null, source: input.source || 'screenshot', note: m.note || null,
    }));
    if (rows.length) await insert('radar_metrics', rows);
    return { guardadas: rows.length };
  }
  if (name === 'get_saved_metrics') {
    let path = `radar_metrics?ticker=eq.${encodeURIComponent(T(input.ticker))}&order=created_at.desc&limit=150`;
    if (input.metric) path += `&metric=ilike.*${encodeURIComponent(input.metric)}*`;
    const rows = await q(path);
    return rows.map((r) => ({ metric: r.metric, value: r.value ?? r.value_text, period: r.period, source: r.source, note: r.note, fecha: r.created_at.slice(0, 10) }));
  }
  if (name === 'get_radar') {
    const cfg = await loadConfig();
    if (!cfg) return { error: 'El radar todavía no tiene configuración guardada' };
    const tickers = (input.tickers || []).map(T);
    // tickers que no están en el radar: se evalúan con las reglas del primer grupo
    const extra = tickers.filter((s) => !cfg.tickers.some((t) => t.symbol === s));
    const cfg2 = extra.length ? { ...cfg, tickers: [...cfg.tickers, ...extra.map((s) => ({ symbol: s, group: cfg.groups[0].id, targets: [] }))] } : cfg;
    const { market, results } = await runScan(cfg2, { only: tickers.length ? tickers : null });
    return {
      mercado: market ? { vix: +market.vix.toFixed(2), spyDesdeMax: +market.spyDD.toFixed(1), spyVsEma200: +market.spyD200.toFixed(1), señales: market.rules.filter((r) => r.met).map((r) => r.label) } : null,
      acciones: results.map(snapshot),
      fueraDelRadar: extra,
    };
  }
  if (name === 'get_thesis') {
    const rows = await q(`radar_theses?ticker=eq.${encodeURIComponent(T(input.ticker))}&order=created_at.desc&select=title,summary,criteria,created_at`);
    return rows.length ? rows : { info: 'No hay tesis cargadas para ese ticker' };
  }
  if (name === 'set_target') {
    const cfg = await loadConfig(); const t = cfg?.tickers.find((x) => x.symbol === T(input.ticker));
    if (!t) return { error: 'Ese ticker no está en el radar' };
    t.targets ||= [];
    let row = t.targets.find((x) => x.metric === input.metric);
    if (!row) { row = { metric: input.metric, venta: null, promedio: null }; t.targets.push(row); }
    if (input.venta != null) row.venta = input.venta;
    if (input.promedio != null) row.promedio = input.promedio;
    cfg.rev = Date.now(); await kvSet('config', cfg);
    return { ok: true, objetivo: row };
  }
  if (name === 'add_tickers') {
    const cfg = await loadConfig(); if (!cfg) return { error: 'sin config' };
    const g = cfg.groups.find((x) => x.name.toLowerCase() === String(input.group).toLowerCase()) || cfg.groups.find((x) => x.name.toLowerCase().includes(String(input.group).toLowerCase()));
    if (!g) return { error: 'No existe ese grupo', grupos: cfg.groups.map((x) => x.name) };
    for (const s of input.tickers.map(T)) {
      const ex = cfg.tickers.find((t) => t.symbol === s);
      if (ex) ex.group = g.id; else cfg.tickers.push({ symbol: s, group: g.id, targets: [], overrides: {} });
    }
    cfg.rev = Date.now(); await kvSet('config', cfg);
    return { ok: true, grupo: g.name };
  }
  return { error: 'herramienta desconocida' };
}

// ───────────── Prompt ─────────────
async function systemPrompt() {
  const [profile, theses] = await Promise.all([
    kvGet('analyst_profile'),
    q('radar_theses?select=ticker,title,created_at&order=created_at.desc&limit=60').catch(() => []),
  ]);
  const hoy = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `Sos la IA interna del "Radar de Alertas" de Agustín: un analista de acciones que trabaja con SU forma de analizar, no con una genérica. Hoy es ${hoy}.

Cómo trabajás:
- Respondés en español rioplatense, directo y con opinión. Corto por defecto; extendete solo si te piden un análisis.
- Si mandan un screenshot o tabla con métricas: extraé TODOS los números relevantes, guardalos con save_metrics (ticker, período, fuente) y después respondé con un resumen breve de lo guardado y qué te llama la atención según su marco de análisis.
- Para opinar de una acción, primero traé datos: get_radar (vivo), get_saved_metrics (histórico que él cargó) y get_thesis (su tesis). No inventes números; si un dato no está, decilo.
- Aplicá SU marco (perfil abajo): sus umbrales, su clasificación, sus reglas de venta. Si los datos contradicen su tesis, decíselo sin vueltas.
- Recalculá vos los múltiplos cuando tengas los insumos (P/E = precio / EPS, PEG = P/E / crecimiento) y marcá si el screener difiere.
- No sos asesor financiero registrado: das análisis, la decisión es de él. No hace falta repetir ese disclaimer en cada respuesta.
- Formato: markdown simple (negritas, listas cortas). Nada de tablas largas en Telegram.

PERFIL DE ANÁLISIS DE AGUSTÍN (aprendido de sus tesis):
${profile?.text || '(Todavía no cargó tesis. Usá un marco growth/calidad estándar: PEG < 1 ideal, P/E forward, crecimiento de EPS, ROIC, FCF, margen bruto, deuda; clasificación de Peter Lynch.)'}

TESIS CARGADAS: ${theses.length ? theses.map((t) => `${t.ticker || '?'} (${t.title}, ${t.created_at.slice(0, 10)})`).join('; ') : 'ninguna'}`;
}

// ───────────── Chat ─────────────
// userContent: array de bloques de contenido Anthropic (texto + imágenes)
export async function chat(channel, userContent) {
  const ai = client();
  const histRows = await q(`radar_messages?channel=eq.${channel}&order=created_at.desc&limit=16`);
  const history = histRows.reverse().map((r) => ({ role: r.role, content: r.content }));
  // la historia arranca siempre con un mensaje del usuario
  while (history.length && history[0].role !== 'user') history.shift();
  const messages = [...history, { role: 'user', content: userContent }];
  const system = await systemPrompt();
  const used = [];
  let final = '';
  for (let i = 0; i < 8; i++) {
    const resp = await ai.messages.create({ model: MODEL, max_tokens: 2500, system, tools: TOOLS, messages });
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stop_reason !== 'tool_use') { final = textOf(resp); break; }
    const results = [];
    for (const b of resp.content.filter((x) => x.type === 'tool_use')) {
      used.push(b.name);
      let out; try { out = await runTool(b.name, b.input); } catch (e) { out = { error: e.message }; }
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out).slice(0, 60000) });
    }
    messages.push({ role: 'user', content: results });
  }
  // guardamos la conversación sin las imágenes (pesan mucho) ni los pasos intermedios
  const userStored = userContent.map((b) => (b.type === 'text' ? b : { type: 'text', text: '[imagen adjunta]' }));
  const note = used.length ? `\n\n_(usé: ${[...new Set(used)].join(', ')})_` : '';
  await insert('radar_messages', [
    { channel, role: 'user', content: userStored },
    { channel, role: 'assistant', content: [{ type: 'text', text: final || '…' }] },
  ]);
  return { text: (final || 'No pude generar respuesta.') + note, tools: used };
}

// ───────────── Tesis: ingestión y perfil ─────────────
const EXTRACT = `Leé esta tesis de inversión escrita por Agustín y devolvé SOLO un JSON válido con esta forma:
{"ticker":"NVDA","title":"título corto","summary":"resumen de 120-200 palabras de la tesis: qué es la empresa, por qué la compra, precio justo y escenarios",
"criteria":{"clasificacion":"tipo Lynch u otro","metricas_clave":["..."],"umbrales":["PEG < 1", "..."],"metodo_valuacion":"cómo llega al precio justo","precio_justo":"valor y fecha si figura","reglas_venta":["..."],"red_flags":["..."],"comparables":["..."]},
"numbers":[{"metric":"pe_fwd","value":30.1,"period":"NTM","note":""}]}
En numbers poné los datos duros más importantes de la tesis (máx 25). No agregues texto fuera del JSON.`;

export async function ingestThesis({ text, pdfBase64, images = [], filename }) {
  const ai = client();
  const content = [];
  if (pdfBase64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
  for (const im of images.slice(0, 12)) content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type || 'image/jpeg', data: im.data } });
  if (text) content.push({ type: 'text', text: `Archivo: ${filename || 'tesis'}\n\nTEXTO EXTRAÍDO:\n${text.slice(0, 180000)}` });
  if (images.length) content.push({ type: 'text', text: 'Las imágenes adjuntas son las páginas de la tesis (puede ser un carrusel): leé todo lo que dicen.' });
  content.push({ type: 'text', text: EXTRACT });
  const resp = await ai.messages.create({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content }] });
  const raw = textOf(resp);
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const ticker = String(json.ticker || '').toUpperCase().trim() || null;
  if (!ticker || /^(N\/?A|NONE|NULL|-|—)$/.test(ticker) || !json.summary) throw new Error('No pude leer la tesis (¿el PDF tiene texto o páginas legibles?). Probá pegando el texto.');
  const [row] = await insert('radar_theses', [{ ticker, title: json.title || filename, summary: json.summary, criteria: json.criteria, content: text ? text.slice(0, 200000) : `[PDF] ${filename || ''}` }]);
  const nums = (json.numbers || []).filter((n) => n.metric).map((n) => ({ ticker, metric: String(n.metric).toLowerCase(), value: typeof n.value === 'number' ? n.value : null, value_text: typeof n.value === 'number' ? null : String(n.value ?? ''), period: n.period || null, source: 'tesis: ' + (json.title || filename || ''), note: n.note || null }));
  if (ticker && nums.length) await insert('radar_metrics', nums);
  return { thesis: { id: row.id, ticker, title: row.title, summary: json.summary, criteria: json.criteria }, metrics: nums.length };
}

export async function rebuildProfile() {
  const theses = await q('radar_theses?select=ticker,title,summary,criteria,created_at&order=created_at.asc');
  if (!theses.length) { await kvSet('analyst_profile', null); return null; }
  const ai = client();
  const prev = await kvGet('analyst_profile');
  const resp = await ai.messages.create({
    model: MODEL, max_tokens: 2500,
    messages: [{ role: 'user', content: `Estas son las tesis de inversión de Agustín (resumen + criterios extraídos), de la más vieja a la más nueva:\n\n${JSON.stringify(theses).slice(0, 150000)}\n\n${prev?.notes ? `Correcciones que él pidió explícitamente sobre su perfil (respetarlas):\n${prev.notes}\n\n` : ''}Escribí su PERFIL DE ANÁLISIS: un documento de 350-600 palabras, en segunda persona dirigido a un analista que va a trabajar como él. Incluí: estilo y horizonte, cómo clasifica empresas, métricas que prioriza y umbrales concretos que usa, cómo valúa y llega al precio justo, reglas de compra y de venta, red flags que mira, sesgos o patrones recurrentes (sectores, tipo de empresa). Si las tesis más nuevas cambian un criterio, gana la más nueva. Solo lo que se desprende de las tesis, sin inventar. Markdown simple.` }],
  });
  const profile = { text: textOf(resp), notes: prev?.notes || '', basedOn: theses.length, updated: new Date().toISOString() };
  await kvSet('analyst_profile', profile);
  return profile;
}
