// Escaneo del lado del servidor: mismo motor que el navegador (public/engine.js)
import { RULES, scoreTicker, evalMarket } from '../public/engine.js';
import { getData } from './fetch.js';
import { kvGet, kvSet, insert } from './db.js';
import { sendText, escHtml } from './telegram.js';

export async function loadConfig() { return (await kvGet('config')) || null; }
const groupOf = (cfg, t) => cfg.groups.find((g) => g.id === t.group) || cfg.groups[0];

export async function runScan(cfg, { only } = {}) {
  let tickers = cfg.tickers;
  if (only?.length) { const set = new Set(only.map((s) => s.toUpperCase())); tickers = tickers.filter((t) => set.has(t.symbol)); }
  const syms = new Set(['SPY', '^VIX']);
  tickers.forEach((t) => syms.add(t.symbol));
  cfg.groups.forEach((g) => g.benchmark && syms.add(g.benchmark.toUpperCase()));
  const fund = tickers.filter((t) => Object.entries(groupOf(cfg, t)?.rules || {}).some(([id, r]) => r.on && RULES[id]?.cat === 'fun')).map((t) => t.symbol);
  const data = await getData([...syms], { fundamentals: fund });
  const market = evalMarket(cfg.market || {}, data.symbols.SPY, data.symbols['^VIX']);
  const results = tickers.map((t) => {
    const g = groupOf(cfg, t);
    return { ticker: t, group: g, ...scoreTicker(t, g, data.symbols[t.symbol], g.benchmark ? data.symbols[g.benchmark.toUpperCase()] : null) };
  }).sort((a, b) => (b.score ?? -99) - (a.score ?? -99));
  return { data, market, results };
}

// Resumen compacto para la IA (sin series de precios)
export function snapshot(r) {
  if (r.error) return { symbol: r.ticker.symbol, error: r.error };
  const f = r.f || {};
  return {
    symbol: r.ticker.symbol, grupo: r.group.name, precio: r.t.price, score: r.score, cumple: `${r.metPos}/${r.totPos}`,
    rsi: +r.t.rsiNow?.toFixed(1), vsEma50: +r.t.d50?.toFixed(1), vsEma200: +r.t.d200?.toFixed(1), drawdown52s: +r.t.dd?.toFixed(1), var12m: r.t.priceYoY != null ? +r.t.priceYoY.toFixed(1) : null,
    fundamentals: { peFwd: f.forwardPE, peTtm: f.trailingPE, peg: f.peg, evEbitda: f.evEbitda, deudaEquity: f.debtEquity, epsYoY: f.epsYoY, revisionEps30d: f.epsRev30, earnings: f.earnings, proximoReporte: f.nextEarnings, comprasInsiders: f.insiderBuys?.length || 0, targetAnalistas: f.targetMean },
    señalesActivas: r.rules.filter((x) => x.met).map((x) => `${x.pol > 0 ? '+' : '−'} ${x.label} (${x.val})`),
    objetivos: r.targets.map((x) => ({ metrica: x.label, actual: x.cur, venta: x.venta, promedio: x.promedio, aVenta: x.dVenta, vsPromedio: x.dAvg, llego: x.hit })),
  };
}

const fmtVal = (v) => escHtml(v ?? '');

// Compara contra el último estado y avisa por Telegram lo nuevo
export async function scanAndNotify() {
  const cfg = await loadConfig();
  if (!cfg) return { skipped: 'sin config' };
  const { market, results } = await runScan(cfg);
  const prev = (await kvGet('alert_state')) || null;
  const minScore = cfg.telegram?.minScore ?? null;
  const now = {}; const fresh = [];
  const add = (k, a) => { now[k] = 1; if (prev && !prev[k]) fresh.push(a); };

  for (const m of market?.rules || []) if (m.met) add('MKT:' + m.id, { sym: 'Mercado', rule: m.id, label: m.label, pol: m.pol, val: m.val, tg: m.tg });
  for (const r of results) {
    if (r.error) continue;
    for (const x of r.rules) if (x.met) add(r.ticker.symbol + ':' + x.id, { sym: r.ticker.symbol, rule: x.id, label: x.label, pol: x.pol, val: x.val, score: r.score, tg: x.tg });
    if (minScore != null && r.score >= minScore) add(r.ticker.symbol + ':SCORE', { sym: r.ticker.symbol, rule: 'score', label: `Score ≥ ${minScore}`, pol: 1, val: String(r.score), score: r.score, tg: true });
  }
  await kvSet('alert_state', now);
  if (!prev) return { first: true, active: Object.keys(now).length };
  if (fresh.length) await insert('radar_alerts', fresh.map(({ tg, ...a }) => ({ ...a, val: String(a.val ?? '') })));

  const toSend = fresh.filter((a) => a.tg);
  const chatId = await kvGet('telegram_chat');
  if (toSend.length && chatId && process.env.TELEGRAM_BOT_TOKEN) {
    const pos = toSend.filter((a) => a.pol > 0), neg = toSend.filter((a) => a.pol < 0);
    const line = (a) => `${a.pol > 0 ? '🟢' : '🔴'} <b>${fmtVal(a.sym)}</b> · ${fmtVal(a.label)} <code>${fmtVal(a.val)}</code>${a.score != null ? ` · score ${a.score}` : ''}`;
    const msg = ['<b>📡 Radar: alertas nuevas</b>', '', ...pos.map(line), ...(pos.length && neg.length ? [''] : []), ...neg.map(line)].join('\n');
    await sendText(chatId, msg);
  }
  return { fresh: fresh.length, sent: toSend.length };
}

export function rankingText(results, n = 10) {
  return results.filter((r) => !r.error).slice(0, n).map((r, i) => {
    const pos = r.rules.filter((x) => x.met && x.pol > 0).length, neg = r.rules.filter((x) => x.met && x.pol < 0).length;
    return `${i + 1}. <b>${r.ticker.symbol}</b> ${r.t.price.toFixed(2)} · score <b>${r.score}</b> (${r.metPos}/${r.totPos}) ${neg ? `· ⚠️${neg}` : ''}`;
  }).join('\n');
}
