// ───────────────────────── Indicadores ─────────────────────────
export function ema(arr, n) {
  const k = 2 / (n + 1); const out = new Array(arr.length).fill(null);
  if (arr.length < n) return out;
  let prev = arr.slice(0, n).reduce((a, b) => a + b, 0) / n; out[n - 1] = prev;
  for (let i = n; i < arr.length; i++) { prev = arr[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

export function rsi(close, n = 14) {
  const out = new Array(close.length).fill(null);
  if (close.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = close[i] - close[i - 1]; d > 0 ? (g += d) : (l -= d); }
  g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function macd(close, f = 12, s = 26, sig = 9) {
  const ef = ema(close, f), es = ema(close, s);
  const line = close.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const start = line.findIndex((x) => x != null);
  const sigArr = new Array(close.length).fill(null);
  if (start >= 0) ema(line.slice(start), sig).forEach((v, j) => (sigArr[start + j] = v));
  return { line, signal: sigArr };
}

// Cruce de a sobre b (dir=+1 hacia arriba, -1 hacia abajo) en las últimas `days` ruedas
function crossedWithin(a, b, days, dir) {
  const n = a.length;
  for (let i = n - 1; i >= Math.max(1, n - days); i--) {
    if ([a[i], b[i], a[i - 1], b[i - 1]].some((x) => x == null)) continue;
    if (dir > 0 && a[i - 1] <= b[i - 1] && a[i] > b[i]) return n - 1 - i;
    if (dir < 0 && a[i - 1] >= b[i - 1] && a[i] < b[i]) return n - 1 - i;
  }
  return -1;
}

// Pivotes (mínimos/máximos locales con k velas a cada lado)
function pivots(series, k, type, from) {
  const idx = [];
  for (let i = Math.max(from, k); i < series.length - k; i++) {
    let ok = true;
    for (let j = 1; j <= k && ok; j++) {
      if (type === 'low' && (series[i] > series[i - j] || series[i] > series[i + j])) ok = false;
      if (type === 'high' && (series[i] < series[i - j] || series[i] < series[i + j])) ok = false;
    }
    if (ok) idx.push(i);
  }
  return idx;
}

// Divergencia: precio hace mínimo más bajo y RSI mínimo más alto (alcista), o al revés (bajista)
function divergence(t, kind, lookback, recent) {
  const n = t.close.length, from = n - lookback;
  const src = kind === 'bull' ? t.low : t.high;
  const pv = pivots(src, 3, kind === 'bull' ? 'low' : 'high', from).filter((i) => t.rsi[i] != null);
  if (pv.length < 2) return null;
  const b = pv.at(-1), a = pv.at(-2);
  if (n - 1 - b > recent) return null;
  if (kind === 'bull' && src[b] < src[a] && t.rsi[b] > t.rsi[a]) return { a, b };
  if (kind === 'bear' && src[b] > src[a] && t.rsi[b] < t.rsi[a]) return { a, b };
  return null;
}

export function technicals(p, benchP) {
  const close = p.close, n = close.length;
  const t = { close, high: p.high, low: p.low, dates: p.dates };
  t.price = close.at(-1);
  t.ema50 = ema(close, 50); t.ema200 = ema(close, 200);
  t.rsi = rsi(close); const m = macd(close); t.macd = m.line; t.macdSig = m.signal;
  t.e50 = t.ema50.at(-1); t.e200 = t.ema200.at(-1); t.rsiNow = t.rsi.at(-1);
  t.d50 = t.e50 ? (t.price / t.e50 - 1) * 100 : null;
  t.d200 = t.e200 ? (t.price / t.e200 - 1) * 100 : null;
  const last252 = close.slice(-252);
  t.high52 = Math.max(...last252);
  t.dd = (t.price / t.high52 - 1) * 100;
  t.priceYoY = n > 252 ? (t.price / close[n - 253] - 1) * 100 : null;
  t.ret = (d) => (n > d ? (t.price / close[n - 1 - d] - 1) * 100 : null);
  if (benchP?.close?.length) {
    const bc = benchP.close, bn = bc.length;
    t.benchRet = (d) => (bn > d ? (bc.at(-1) / bc[bn - 1 - d] - 1) * 100 : null);
  }
  t.crossed = (a, b, days, dir) => crossedWithin(a, b, days, dir);
  t.div = (kind, lb, rc) => divergence(t, kind, lb, rc);
  return t;
}

// ───────────────────────── Catálogo de reglas ─────────────────────────
// pol: +1 suma (compra), -1 resta (negativa). cat: tec | fun | obj
// eval(t, f, ctx, params) → { met: bool|null (null = sin dato), val: texto }
const f1 = (x, d = 1) => (x == null || !isFinite(x) ? '—' : x.toFixed(d));
const pct = (x) => (x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%');
const clamp = (x) => Math.max(0, Math.min(1, x));
// rango "cuanto más mejor": en el mínimo suma la mitad del peso, en el máximo el peso completo
const rangeUp = (v, min, max, fmt) => (v == null ? { met: null, val: '—' } : { met: v >= min && v <= max, val: fmt(v), frac: v >= min && v <= max ? 0.5 + 0.5 * clamp((v - min) / ((max - min) || 1)) : 0 });
// tope "cuanto menos mejor": justo en el tope suma la mitad, en la mitad del tope suma completo
const rangeDown = (v, max, fmt) => (v == null || v <= 0 ? { met: null, val: v == null ? '—' : fmt(v) } : { met: v <= max, val: fmt(v), frac: v <= max ? 0.5 + 0.5 * clamp((max - v) / (max / 2)) : 0 });

export const RULES = {
  // ── Técnicas positivas
  ema200_touch: { cat: 'tec', pol: 1, w: 3, tg: 1, label: 'Tocando EMA200', p: { banda: 2 }, hint: 'precio a ±banda% de la EMA200',
    eval: (t, f, c, p) => ({ met: t.d200 == null ? null : Math.abs(t.d200) <= p.banda, val: pct(t.d200) }) },
  ema200_cross: { cat: 'tec', pol: 1, w: 3, tg: 1, label: 'Supera EMA200', p: { dias: 5 }, hint: 'cruce alcista en las últimas N ruedas',
    eval: (t, f, c, p) => { const d = t.crossed(t.close, t.ema200, p.dias, 1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : pct(t.d200) }; } },
  ema50_touch: { cat: 'tec', pol: 1, w: 1, label: 'Tocando EMA50', p: { banda: 1.5 },
    eval: (t, f, c, p) => ({ met: t.d50 == null ? null : Math.abs(t.d50) <= p.banda, val: pct(t.d50) }) },
  ema50_cross: { cat: 'tec', pol: 1, w: 1, label: 'Supera EMA50', p: { dias: 5 },
    eval: (t, f, c, p) => { const d = t.crossed(t.close, t.ema50, p.dias, 1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : pct(t.d50) }; } },
  rsi_low: { cat: 'tec', pol: 1, w: 2, tg: 1, label: 'RSI bajo', p: { nivel: 35 }, hint: 'RSI(14) por debajo del nivel',
    eval: (t, f, c, p) => ({ met: t.rsiNow < p.nivel, val: f1(t.rsiNow, 0) }) },
  div_bull: { cat: 'tec', pol: 1, w: 2, tg: 1, label: 'Divergencia alcista', p: { ventana: 60, reciente: 10 }, hint: 'precio mínimo más bajo + RSI mínimo más alto',
    eval: (t, f, c, p) => { const d = t.div('bull', p.ventana, p.reciente); return { met: !!d, val: d ? t.dates[d.b] : '—' }; } },
  macd_up: { cat: 'tec', pol: 1, w: 2, label: 'Cruce MACD alcista', p: { dias: 5 },
    eval: (t, f, c, p) => { const d = t.crossed(t.macd, t.macdSig, p.dias, 1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : '—' }; } },
  rs_strong: { cat: 'tec', pol: 1, w: 1, label: 'Le gana al benchmark', p: { dias: 63, margen: 0 }, hint: 'retorno N ruedas vs benchmark del grupo',
    eval: (t, f, c, p) => { if (!t.benchRet) return { met: null, val: 'sin benchmark' }; const d = t.ret(p.dias) - t.benchRet(p.dias); return { met: d > p.margen, val: pct(d) }; } },

  // ── Técnicas negativas
  rsi_high: { cat: 'tec', pol: -1, w: 2, label: 'RSI sobrecompra', p: { nivel: 70 },
    eval: (t, f, c, p) => ({ met: t.rsiNow > p.nivel, val: f1(t.rsiNow, 0) }) },
  div_bear: { cat: 'tec', pol: -1, w: 2, tg: 1, label: 'Divergencia bajista', p: { ventana: 60, reciente: 10 },
    eval: (t, f, c, p) => { const d = t.div('bear', p.ventana, p.reciente); return { met: !!d, val: d ? t.dates[d.b] : '—' }; } },
  ema200_lost: { cat: 'tec', pol: -1, w: 3, tg: 1, label: 'Pierde EMA200', p: { dias: 5 },
    eval: (t, f, c, p) => { const d = t.crossed(t.close, t.ema200, p.dias, -1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : pct(t.d200) }; } },
  death_cross: { cat: 'tec', pol: -1, w: 2, tg: 1, label: 'Death cross 50/200', p: { dias: 15 },
    eval: (t, f, c, p) => { const d = t.crossed(t.ema50, t.ema200, p.dias, -1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : '—' }; } },
  macd_down: { cat: 'tec', pol: -1, w: 1, label: 'Cruce MACD bajista', p: { dias: 5 },
    eval: (t, f, c, p) => { const d = t.crossed(t.macd, t.macdSig, p.dias, -1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : '—' }; } },
  rs_weak: { cat: 'tec', pol: -1, w: 1, label: 'Pierde vs benchmark', p: { dias: 63, margen: 10 }, hint: 'queda atrás más de margen%',
    eval: (t, f, c, p) => { if (!t.benchRet) return { met: null, val: 'sin benchmark' }; const d = t.ret(p.dias) - t.benchRet(p.dias); return { met: d < -p.margen, val: pct(d) }; } },
  stretched: { cat: 'tec', pol: -1, w: 1, label: 'Estirada vs EMA200', p: { max: 40 }, hint: 'precio más de max% arriba de la EMA200',
    eval: (t, f, c, p) => ({ met: t.d200 == null ? null : t.d200 > p.max, val: pct(t.d200) }) },

  // ── Fundamentals positivos
  fpe: { cat: 'fun', pol: 1, w: 2, label: 'P/E forward ≤', p: { max: 25 },
    eval: (t, f, c, p) => ({ met: f.forwardPE == null ? null : f.forwardPE > 0 && f.forwardPE <= p.max, val: f1(f.forwardPE) }) },
  peg: { cat: 'fun', pol: 1, w: 2, label: 'PEG ≤', p: { max: 1 },
    eval: (t, f, c, p) => ({ met: f.peg == null ? null : f.peg > 0 && f.peg <= p.max, val: f1(f.peg, 2) }) },
  eps_gap: { cat: 'fun', pol: 1, w: 2, label: 'Precio atrás del EPS', p: { gap: 0 }, hint: 'var. precio 12m − var. EPS YoY ≤ gap (pp)',
    eval: (t, f, c, p) => { if (f.epsYoY == null || t.priceYoY == null) return { met: null, val: '—' }; const g = t.priceYoY - f.epsYoY; return { met: g <= p.gap, val: `${pct(t.priceYoY)} vs ${pct(f.epsYoY)}` }; } },
  evebitda: { cat: 'fun', pol: 1, w: 1, label: 'EV/EBITDA ≤', p: { max: 18 },
    eval: (t, f, c, p) => ({ met: f.evEbitda == null ? null : f.evEbitda > 0 && f.evEbitda <= p.max, val: f1(f.evEbitda) }) },
  de: { cat: 'fun', pol: 1, w: 1, label: 'Deuda/Equity ≤', p: { max: 1 },
    eval: (t, f, c, p) => ({ met: f.debtEquity == null ? null : f.debtEquity <= p.max, val: f1(f.debtEquity, 2) + 'x' }) },
  insider: { cat: 'fun', pol: 1, w: 2, tg: 1, label: 'Compra de insiders', p: { min: 1, dias: 90 }, hint: 'solo compras, últimos N días',
    eval: (t, f, c, p) => { if (!f.insiderBuys) return { met: null, val: '—' }; const lim = Date.now() - p.dias * 864e5; const b = f.insiderBuys.filter((x) => +new Date(x.date) >= lim); return { met: b.length >= p.min, val: b.length ? `${b.length} compra(s)` : '0' }; } },
  drawdown: { cat: 'fun', pol: 1, w: 2, label: 'Drawdown ≥', p: { min: 20 }, hint: 'caída desde máximo 52 semanas',
    eval: (t, f, c, p) => ({ met: t.dd <= -p.min, val: pct(t.dd) }) },
  beat: { cat: 'fun', pol: 1, w: 2, label: 'Earnings > estimado', p: { sorpresa: 0, trimestres: 1 }, hint: 'últimos N trimestres superan por ≥ sorpresa%',
    eval: (t, f, c, p) => { const e = (f.earnings || []).slice(-p.trimestres); if (!e.length) return { met: null, val: '—' }; return { met: e.every((x) => x.surprise >= p.sorpresa), val: e.map((x) => pct(x.surprise)).join(' · ') }; } },

  // ── Métricas sectoriales (se activan por grupo; apagadas por defecto) ──
  div_range: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'Dividend yield en rango', p: { min: 2, max: 7 }, hint: 'cuanto más alto dentro del rango, más suma',
    eval: (t, f, c, p) => rangeUp(f.divYield, p.min, p.max, (x) => x.toFixed(2) + '%') },
  div_vs_avg: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'Yield sobre su promedio 5a', p: { margen: 0 }, hint: 'yield actual vs promedio 5 años: precio atrasado vs su historia',
    eval: (t, f, c, p) => { if (!f.divYield || !f.divYield5y) return { met: null, val: '—' }; const d = (f.divYield / f.divYield5y - 1) * 100; return { met: d >= p.margen, val: `${f.divYield.toFixed(2)}% vs ${f.divYield5y.toFixed(2)}%`, frac: d >= p.margen ? clamp(0.5 + d / 40) : 0 }; } },
  payout_range: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Payout en rango', p: { min: 60, max: 75 }, hint: 'dividendo cubierto sin descuidar la reinversión',
    eval: (t, f, c, p) => (f.payout == null ? { met: null, val: '—' } : { met: f.payout >= p.min && f.payout <= p.max, val: f.payout.toFixed(0) + '%' }) },
  efficiency: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'Efficiency ratio ≤', p: { max: 60 }, hint: 'gastos / ingresos: cuanto más bajo, mejor',
    eval: (t, f, c, p) => rangeDown(f.efficiency, p.max, (x) => x.toFixed(1) + '%') },
  roe: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'ROE ≥', p: { min: 15 },
    eval: (t, f, c, p) => (f.roe == null ? { met: null, val: '—' } : { met: f.roe >= p.min, val: f.roe.toFixed(1) + '%' }) },
  pb: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'P/Book ≤', p: { max: 2 },
    eval: (t, f, c, p) => rangeDown(f.pb, p.max, (x) => x.toFixed(2) + 'x') },
  op_margin: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Margen operativo ≥', p: { min: 20 },
    eval: (t, f, c, p) => (f.opMargin == null ? { met: null, val: '—' } : { met: f.opMargin >= p.min, val: f.opMargin.toFixed(1) + '%' }) },
  gross_margin: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Margen bruto ≥', p: { min: 50 },
    eval: (t, f, c, p) => (f.grossMargin == null ? { met: null, val: '—' } : { met: f.grossMargin >= p.min, val: f.grossMargin.toFixed(1) + '%' }) },
  rev_growth: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Crecimiento de ventas ≥', p: { min: 10 }, hint: 'interanual, último trimestre',
    eval: (t, f, c, p) => (f.revGrowth == null ? { met: null, val: '—' } : { met: f.revGrowth >= p.min, val: pct(f.revGrowth) }) },
  fcf_yield: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'FCF yield ≥', p: { min: 3 }, hint: 'flujo de caja libre / market cap',
    eval: (t, f, c, p) => (f.fcfYield == null ? { met: null, val: '—' } : { met: f.fcfYield >= p.min, val: f.fcfYield.toFixed(1) + '%' }) },
  debt_ebitda: { cat: 'fun', pol: 1, w: 1, off: 1, label: 'Deuda/EBITDA ≤', p: { max: 3 },
    eval: (t, f, c, p) => (f.debtEbitda == null ? { met: null, val: '—' } : { met: f.debtEbitda <= p.max, val: f.debtEbitda.toFixed(1) + 'x' }) },
  ev_sales: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'EV/Ventas ≤', p: { max: 15 },
    eval: (t, f, c, p) => rangeDown(f.evSales, p.max, (x) => x.toFixed(1) + 'x') },
  rule40: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'Regla del 40 ≥', p: { min: 40 }, hint: 'crecimiento de ventas % + margen FCF %',
    eval: (t, f, c, p) => (f.rule40 == null ? { met: null, val: '—' } : { met: f.rule40 >= p.min, val: f.rule40.toFixed(0) }) },
  eps_rev_up: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Suben EPS estimado', p: { pct: 2 }, hint: 'revisión EPS año en curso, 90 días',
    eval: (t, f, c, p) => ({ met: f.epsRev90 == null ? null : f.epsRev90 >= p.pct, val: pct(f.epsRev90) }) },
  cash_debt: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Caja / Deuda ≥', p: { min: 30 }, hint: 'colchón de liquidez frente a la deuda',
    eval: (t, f, c, p) => (f.cashDebt == null ? { met: null, val: '—' } : { met: f.cashDebt >= p.min, val: f.cashDebt.toFixed(0) + '%' }) },
  debt_mcap: { cat: 'fun', pol: 1, w: 1, off: 1, label: 'Deuda / Market cap ≤', p: { max: 50 }, hint: 'cuánto pesa la deuda sobre lo que vale la empresa',
    eval: (t, f, c, p) => rangeDown(f.debtMcap, p.max, (x) => x.toFixed(0) + '%') },
  current_ratio: { cat: 'fun', pol: 1, w: 1, off: 1, label: 'Liquidez corriente ≥', p: { min: 1 }, hint: 'activo corriente / pasivo corriente',
    eval: (t, f, c, p) => (f.currentRatio == null ? { met: null, val: '—' } : { met: f.currentRatio >= p.min, val: f.currentRatio.toFixed(2) + 'x' }) },
  dilution: { cat: 'fun', pol: -1, w: 2, off: 1, label: 'Dilución alta', p: { max: 10 }, hint: 'acciones en circulación: suba interanual mayor a max%',
    eval: (t, f, c, p) => (f.sharesYoY == null ? { met: null, val: '—' } : { met: f.sharesYoY > p.max, val: pct(f.sharesYoY) }) },
  ev_arr: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'EV / ARR proyectado ≤', p: { max: 8 }, hint: 'ARR proyectado (USD bn) lo cargás vos en la ficha',
    eval: (t, f, c, p) => (f.evArr == null ? { met: null, val: f.arrProj ? 'falta EV' : 'cargá el ARR' } : { ...rangeDown(f.evArr, p.max, (x) => x.toFixed(1) + 'x') }) },
  ev_gw: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'EV por GW ≤', p: { max: 15 }, hint: 'USD bn de EV por cada GW de capacidad total (los GW los cargás vos)',
    eval: (t, f, c, p) => (f.evGw == null ? { met: null, val: f.gwTotal ? 'falta EV' : 'cargá los GW' } : { ...rangeDown(f.evGw, p.max, (x) => 'US$' + x.toFixed(1) + 'bn/GW') }) },
  payout_high: { cat: 'fun', pol: -1, w: 2, off: 1, label: 'Payout insostenible', p: { max: 90 },
    eval: (t, f, c, p) => (f.payout == null ? { met: null, val: '—' } : { met: f.payout > p.max, val: f.payout.toFixed(0) + '%' }) },
  rev_decline: { cat: 'fun', pol: -1, w: 2, off: 1, label: 'Ventas desaceleran', p: { margen: 5 }, hint: 'crecimiento del último trimestre (YoY) vs el del último año fiscal: resta si cae más de margen pp',
    eval: (t, f, c, p) => { if (f.revGrowth == null || f.revGrowthFY == null) return { met: null, val: '—' }; const d = f.revGrowth - f.revGrowthFY; return { met: d < -p.margen, val: `trim. ${pct(f.revGrowth)} vs año ${pct(f.revGrowthFY)}` }; } },

  // ── Fundamentals negativos
  miss: { cat: 'fun', pol: -1, w: 2, tg: 1, label: 'Earnings bajo estimado', p: {}, hint: 'último trimestre no llegó al estimado',
    eval: (t, f) => { const e = (f.earnings || []).at(-1); if (!e) return { met: null, val: '—' }; return { met: e.surprise < 0, val: pct(e.surprise) }; } },
  eps_rev_down: { cat: 'fun', pol: -1, w: 2, tg: 1, label: 'Recortan EPS estimado', p: { pct: -2 }, hint: 'revisión EPS año en curso, 30 días',
    eval: (t, f, c, p) => ({ met: f.epsRev30 == null ? null : f.epsRev30 <= p.pct, val: pct(f.epsRev30) }) },
  price_ahead: { cat: 'fun', pol: -1, w: 2, label: 'Precio adelantado al EPS', p: { gap: 40 }, hint: 'var. precio 12m − var. EPS YoY ≥ gap (pp)',
    eval: (t, f, c, p) => { if (f.epsYoY == null || t.priceYoY == null) return { met: null, val: '—' }; const g = t.priceYoY - f.epsYoY; return { met: g >= p.gap, val: `${(g > 0 ? '+' : '') + g.toFixed(0)}pp` }; } },
  fpe_high: { cat: 'fun', pol: -1, w: 1, label: 'P/E forward caro ≥', p: { max: 45 },
    eval: (t, f, c, p) => ({ met: f.forwardPE == null ? null : f.forwardPE >= p.max, val: f1(f.forwardPE) }) },
  earnings_soon: { cat: 'fun', pol: -1, w: 0, label: 'Earnings cerca', p: { dias: 7 }, hint: 'aviso: reporta en N días (peso 0 = no resta)',
    eval: (t, f, c, p) => { if (!f.nextEarnings) return { met: null, val: '—' }; const d = Math.ceil((+new Date(f.nextEarnings) - Date.now()) / 864e5); return { met: d >= 0 && d <= p.dias, val: d >= 0 ? `en ${d}d` : '—' }; } },

  // ── Objetivos personales (venta / promedio por ticker)
  target_hit: { cat: 'obj', pol: -1, w: 3, tg: 1, label: 'Llegó a objetivo de venta', p: {}, hint: 'alguna métrica tocó tu número de venta',
    eval: (t, f, c) => { const hits = (c.targets || []).filter((x) => x.hit); if (!(c.targets || []).some((x) => x.venta != null)) return { met: null, val: 'sin objetivos' }; return { met: hits.length > 0, val: hits.map((x) => x.label).join(', ') || '—' }; } },
  below_avg: { cat: 'obj', pol: 1, w: 2, tg: 1, label: 'Debajo de su promedio', p: { margen: 10 }, hint: 'métricas ≥ margen% por debajo de tu promedio cargado',
    eval: (t, f, c, p) => { const ts = (c.targets || []).filter((x) => x.promedio != null && x.cur != null); if (!ts.length) return { met: null, val: 'sin promedios' }; const under = ts.filter((x) => x.dAvg <= -p.margen); return { met: under.length > 0, val: under.map((x) => `${x.label} ${pct(x.dAvg)}`).join(', ') || '—' }; } },
};

// Métricas a las que se les puede cargar número de venta y promedio
export const TARGET_METRICS = {
  price: { label: 'Precio', get: (t) => t.price },
  forwardPE: { label: 'P/E fwd', get: (t, f) => f.forwardPE },
  trailingPE: { label: 'P/E ttm', get: (t, f) => f.trailingPE },
  peg: { label: 'PEG', get: (t, f) => f.peg },
  evEbitda: { label: 'EV/EBITDA', get: (t, f) => f.evEbitda },
  rsi: { label: 'RSI', get: (t) => t.rsiNow },
};

export function evalTargets(t, f, targets = []) {
  return targets.map((x) => {
    const m = TARGET_METRICS[x.metric]; if (!m) return null;
    const cur = m.get(t, f || {});
    const r = { ...x, label: m.label, cur };
    if (cur != null && x.venta != null) { r.dVenta = (x.venta / cur - 1) * 100; r.hit = cur >= x.venta; }
    if (cur != null && x.promedio != null) r.dAvg = (cur / x.promedio - 1) * 100;
    return r;
  }).filter(Boolean);
}

// Defaults para un grupo nuevo: todo encendido con pesos sugeridos
export function defaultRules() {
  const o = {};
  for (const [id, r] of Object.entries(RULES)) o[id] = { on: !r.off, w: r.w, p: { ...r.p }, tg: !!r.tg };
  return o;
}

// Evalúa un ticker contra las reglas de su grupo (+ overrides propios)
export function scoreTicker(ticker, group, data, benchData) {
  if (!data?.prices?.close?.length) return { error: data?.error || 'sin datos' };
  const t = technicals(data.prices, benchData?.prices);
  const auto = data.fund && !data.fund.error ? data.fund : {};
  // valores cargados a mano por el usuario: pisan a los automáticos
  const man = Object.fromEntries(Object.entries(ticker.fundOverrides || {}).filter(([, v]) => v != null && v !== '' && isFinite(v)).map(([k, v]) => [k, +v]));
  const f = { ...auto, ...man, _manual: Object.keys(man) };
  // KPIs operativos cargados a mano (neoclouds): múltiplos sobre ARR proyectado y capacidad en GW
  if (f.ev > 0 && f.arrProj > 0) f.evArr = Math.round((f.ev / f.arrProj) * 100) / 100;
  if (f.ev > 0 && f.gwTotal > 0) f.evGw = Math.round((f.ev / f.gwTotal) * 100) / 100;
  const targets = evalTargets(t, f, ticker.targets);
  const ctx = { targets };
  const res = []; let pos = 0, neg = 0, posMax = 0, metPos = 0, totPos = 0;
  // puntaje separado: AT (técnicas) y AF (fundamentals + objetivos propios)
  const by = { tec: { pos: 0, neg: 0, posMax: 0, metPos: 0, totPos: 0 }, fun: { pos: 0, neg: 0, posMax: 0, metPos: 0, totPos: 0 } };
  for (const [id, def] of Object.entries(RULES)) {
    const g = group.rules?.[id] || { on: false, w: def.w, p: def.p };
    const ov = ticker.overrides?.[id] || {};
    const on = ov.on ?? g.on; if (!on) continue;
    const w = ov.w ?? g.w; const p = { ...def.p, ...g.p, ...(ov.p || {}) };
    let r; try { r = def.eval(t, f, ctx, p); } catch { r = { met: null, val: 'err' }; }
    res.push({ id, label: def.label, cat: def.cat, pol: def.pol, w, met: r.met, val: r.val, frac: r.frac, tg: g.tg ?? !!def.tg });
    if (r.met == null) continue; // sin dato: no cuenta ni a favor ni en contra
    const b = by[def.cat === 'tec' ? 'tec' : 'fun'];
    const pts = r.met ? w * (r.frac ?? 1) : 0;
    if (def.pol > 0) { posMax += w; totPos++; b.posMax += w; b.totPos++; if (r.met) { pos += pts; metPos++; b.pos += pts; b.metPos++; } }
    else if (r.met) { neg += w; b.neg += w; }
  }
  const rd = (x) => Math.round(x * 10) / 10;
  pos = rd(pos); neg = rd(neg);
  for (const k of ['tec', 'fun']) { by[k].pos = rd(by[k].pos); by[k].neg = rd(by[k].neg); }
  return {
    t, f, targets, rules: res, pos, neg, posMax, metPos, totPos,
    score: rd(pos - neg), pct: posMax ? pos / posMax : 0,
    tec: { ...by.tec, score: rd(by.tec.pos - by.tec.neg), pct: by.tec.posMax ? by.tec.pos / by.tec.posMax : 0 },
    fun: { ...by.fun, score: rd(by.fun.pos - by.fun.neg), pct: by.fun.posMax ? by.fun.pos / by.fun.posMax : 0 },
  };
}

// ───────────────────────── Mercado (alertas generales) ─────────────────────────
export const MARKET_RULES = {
  vix_high: { pol: 1, label: 'VIX alto → compra', p: { nivel: 25 }, eval: (m, p) => ({ met: m.vix >= p.nivel, val: f1(m.vix) }) },
  spy_dd: { pol: 1, label: 'SPY desde máximos', p: { caida: 10 }, eval: (m, p) => ({ met: m.spyDD <= -p.caida, val: pct(m.spyDD) }) },
  vix_low: { pol: -1, label: 'VIX bajo (complacencia)', p: { nivel: 13 }, eval: (m, p) => ({ met: m.vix <= p.nivel, val: f1(m.vix) }) },
  spy_stretched: { pol: -1, label: 'SPY estirado vs EMA200', p: { max: 10 }, eval: (m, p) => ({ met: m.spyD200 >= p.max, val: pct(m.spyD200) }) },
  spy_below200: { pol: -1, label: 'SPY bajo EMA200', p: {}, eval: (m) => ({ met: m.spyD200 < 0, val: pct(m.spyD200) }) },
  spy_death: { pol: -1, label: 'SPY death cross', p: { dias: 20 }, eval: (m, p) => { const d = m.spyT.crossed(m.spyT.ema50, m.spyT.ema200, p.dias, -1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : '—' }; } },
};

export function defaultMarket() {
  const o = {}; for (const [id, r] of Object.entries(MARKET_RULES)) o[id] = { on: true, p: { ...r.p }, tg: true }; return o;
}

export function evalMarket(cfg, spy, vix) {
  if (!spy?.prices || !vix?.prices) return null;
  const spyT = technicals(spy.prices);
  const m = { vix: vix.prices.close.at(-1), spy: spyT.price, spyT, spyD200: spyT.d200,
    spyHigh: Math.max(...spy.prices.close), };
  m.spyDD = (m.spy / m.spyHigh - 1) * 100; // vs máximo de los ~2 años cargados (≈ máximo histórico en tendencia alcista)
  m.rules = Object.entries(MARKET_RULES).filter(([id]) => cfg[id]?.on !== false).map(([id, d]) => {
    const r = d.eval(m, { ...d.p, ...(cfg[id]?.p || {}) }); return { id, label: d.label, pol: d.pol, tg: cfg[id]?.tg ?? true, ...r };
  });
  return m;
}

// Métricas fundamentales editables a mano (clave en fund → etiqueta y unidad)
export const FUND_FIELDS = [
  ['forwardPE', 'P/E forward', 'x'], ['trailingPE', 'P/E ttm', 'x'], ['peg', 'PEG', 'x'], ['evEbitda', 'EV/EBITDA', 'x'], ['evSales', 'EV/Ventas', 'x'], ['pb', 'P/Book', 'x'],
  ['divYield', 'Dividend yield', '%'], ['divYield5y', 'Yield promedio 5a', '%'], ['payout', 'Payout', '%'],
  ['roe', 'ROE', '%'], ['efficiency', 'Efficiency ratio', '%'], ['grossMargin', 'Margen bruto', '%'], ['opMargin', 'Margen operativo', '%'],
  ['revGrowth', 'Crecimiento ventas (trim. YoY)', '%'], ['revGrowthFY', 'Crecimiento ventas (último año)', '%'], ['epsYoY', 'Crecimiento EPS YoY', '%'], ['fcfYield', 'FCF yield', '%'], ['rule40', 'Regla del 40', ''],
  ['debtEbitda', 'Deuda/EBITDA', 'x'], ['cashDebt', 'Caja / Deuda', '%'], ['debtMcap', 'Deuda / Market cap', '%'], ['currentRatio', 'Liquidez corriente', 'x'], ['ev', 'Enterprise value (USD bn)', ''], ['arrProj', 'ARR proyectado (USD bn)', ''], ['gwTotal', 'Capacidad total (GW)', ''], ['sharesYoY', 'Dilución (acciones YoY)', '%'], ['debtEquity', 'Deuda/Equity', 'x'], ['epsRev30', 'Revisión EPS 30d', '%'], ['epsRev90', 'Revisión EPS 90d', '%'],
];
