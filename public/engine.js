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

// ───────────────────────── Figuras técnicas ─────────────────────────
function linreg(ys) {
  const n = ys.length; let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  return { m, b: (sy - m * sx) / n };
}
const argmax = (a, from, to) => { let k = from; for (let i = from; i <= to; i++) if (a[i] > a[k]) k = i; return k; };
const argmin = (a, from, to) => { let k = from; for (let i = from; i <= to; i++) if (a[i] < a[k]) k = i; return k; };

// Devuelve figuras recientes: [{ name, dir: +1 alcista / -1 bajista, stage: 'formando' | 'ruptura' }]
export function detectPatterns(high, low, close) {
  const n = close.length, out = [];
  if (n < 80) return out;
  const last = close[n - 1];

  // Bandera / banderín: mástil fuerte (≥12% en ≤15 ruedas) + consolidación corta que retrocede ≤50%
  for (const dir of [1, -1]) {
    const p = dir > 0 ? argmax(high, n - 25, n - 5) : argmin(low, n - 25, n - 5);
    const s = dir > 0 ? argmin(low, Math.max(0, p - 15), p - 1) : argmax(high, Math.max(0, p - 15), p - 1);
    const pole = dir > 0 ? high[p] / low[s] - 1 : 1 - low[p] / high[s];
    const L = n - 1 - p;
    if (pole < 0.12 || L < 4 || L > 22) continue;
    const ch = high.slice(p + 1, n - 1), cl = low.slice(p + 1, n - 1);
    if (ch.length < 3) continue;
    const retr = dir > 0 ? (high[p] - Math.min(...low.slice(p + 1))) / (high[p] - low[s]) : (Math.max(...high.slice(p + 1)) - low[p]) / (high[s] - low[p]);
    if (retr > 0.5) continue;
    const ref = close[p], sH = linreg(ch).m / ref, sL = linreg(cl).m / ref;
    const pennant = sH < -0.0005 && sL > 0.0005;
    const flag = dir > 0 ? sH <= 0.002 && sL <= 0.002 : sH >= -0.002 && sL >= -0.002;
    if (!pennant && !flag) continue;
    const broke = dir > 0 ? last > Math.max(...ch) : last < Math.min(...cl);
    out.push({ name: `${pennant ? 'Banderín' : 'Bandera'} ${dir > 0 ? 'alcista' : 'bajista'}`, dir, stage: broke ? 'ruptura' : 'formando' });
  }

  // Hombro-cabeza-hombro (HCH) e invertido
  const from = Math.max(5, n - 160);
  for (const dir of [-1, 1]) {
    const src = dir < 0 ? high : low;
    const pv = pivots(src, 5, dir < 0 ? 'high' : 'low', from);
    if (pv.length < 3) continue;
    const [A, B, C] = pv.slice(-3);
    const a = src[A], b = src[B], c = src[C];
    const headOk = dir < 0 ? b > a * 1.03 && b > c * 1.03 : b < a * 0.97 && b < c * 0.97;
    if (!headOk || Math.abs(a - c) / b > 0.06 || C - A < 15 || n - 1 - C > 45 || n - 1 - C < 3) continue;
    const preH = close[Math.max(0, A - 25)];
    if (dir < 0 ? preH > a * 0.95 : preH < a * 1.05) continue; // HCH viene de suba; el invertido, de baja
    const T1 = dir < 0 ? argmin(low, A, B) : argmax(high, A, B), T2 = dir < 0 ? argmin(low, B, C) : argmax(high, B, C);
    const nv = (dir < 0 ? low : high);
    const neck = nv[T1] + ((nv[T2] - nv[T1]) / ((T2 - T1) || 1)) * (n - 1 - T1);
    const broke = dir < 0 ? last < neck : last > neck;
    const valid = dir < 0 ? last < c : last > c;
    if (!broke && !valid) continue;
    out.push({ name: dir < 0 ? 'HCH (hombro-cabeza-hombro)' : 'HCH invertido', dir, stage: broke ? 'ruptura' : 'formando' });
  }

  // Doble piso / doble techo
  for (const dir of [1, -1]) {
    const src = dir > 0 ? low : high;
    const pv = pivots(src, 5, dir > 0 ? 'low' : 'high', Math.max(5, n - 120));
    if (pv.length < 2) continue;
    const [A, B] = pv.slice(-2);
    if (B - A < 10 || n - 1 - B > 40 || n - 1 - B < 3) continue;
    if (Math.abs(src[A] - src[B]) / src[A] > 0.025) continue;
    const mid = dir > 0 ? Math.max(...high.slice(A, B + 1)) : Math.min(...low.slice(A, B + 1));
    const depth = dir > 0 ? mid / Math.max(src[A], src[B]) - 1 : 1 - mid / Math.min(src[A], src[B]);
    if (depth < 0.08) continue;
    // tiene que venir de una tendencia previa: caída hacia el doble piso / suba hacia el doble techo
    const pre = close[Math.max(0, A - 25)];
    if (dir > 0 ? pre < src[A] * 1.08 : pre > src[A] * 0.92) continue;
    const broke = dir > 0 ? last > mid : last < mid;
    const valid = dir > 0 ? last > src[B] : last < src[B];
    if (!broke && !valid) continue;
    out.push({ name: dir > 0 ? 'Doble piso' : 'Doble techo', dir, stage: broke ? 'ruptura' : 'formando' });
  }

  // Triángulo ascendente (techo plano + pisos crecientes) y descendente
  for (const dir of [1, -1]) {
    const f0 = Math.max(3, n - 60);
    const flat = pivots(dir > 0 ? high : low, 3, dir > 0 ? 'high' : 'low', f0).filter((i) => i < n - 3);
    const slope = pivots(dir > 0 ? low : high, 3, dir > 0 ? 'low' : 'high', f0).filter((i) => i < n - 3);
    if (flat.length < 2 || slope.length < 2) continue;
    const fv = flat.map((i) => (dir > 0 ? high[i] : low[i]));
    const lvl = dir > 0 ? Math.max(...fv) : Math.min(...fv);
    const near = flat.filter((i, k) => Math.abs(fv[k] - lvl) / lvl <= 0.015);
    if (near.length < 2 || near.at(-1) - near[0] < 15) continue;
    const sv = slope.map((i) => (dir > 0 ? low[i] : high[i]));
    const rising = dir > 0 ? sv.at(-1) > sv[0] * 1.03 : sv.at(-1) < sv[0] * 0.97;
    if (!rising) continue;
    const broke = dir > 0 ? last > lvl * 1.005 : last < lvl * 0.995;
    const close5 = dir > 0 ? last >= lvl * 0.95 : last <= lvl * 1.05;
    if (!broke && !close5) continue;
    out.push({ name: dir > 0 ? 'Triángulo ascendente' : 'Triángulo descendente', dir, stage: broke ? 'ruptura' : 'formando' });
  }
  return out;
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
  const e200ago = t.ema200[n - 21];
  t.slope200 = t.e200 && e200ago ? (t.e200 / e200ago - 1) * 100 : null;
  const last252 = close.slice(-252);
  t.high52 = Math.max(...last252);
  t.dd = (t.price / t.high52 - 1) * 100;
  t.priceYoY = n > 252 ? (t.price / close[n - 253] - 1) * 100 : null;
  t.ret = (d) => (n > d ? (t.price / close[n - 1 - d] - 1) * 100 : null);
  if (benchP?.close?.length && benchP.dates) {
    // benchmark alineado por fecha (sirve aunque el benchmark opere 7 días, como BTC)
    const bd = benchP.dates, bc = benchP.close;
    const at = (date) => { let lo = 0, hi = bd.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (bd[mid] <= date) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k >= 0 ? bc[k] : null; };
    t.benchRet = (d) => { if (n <= d) return null; const a = at(p.dates[n - 1 - d]), b = at(p.dates[n - 1]); return a && b ? (b / a - 1) * 100 : null; };
  }
  t.crossed = (a, b, days, dir) => crossedWithin(a, b, days, dir);
  t.div = (kind, lb, rc) => divergence(t, kind, lb, rc);
  let pats = null;
  Object.defineProperty(t, 'patterns', { get: () => (pats ||= detectPatterns(p.high, p.low, close)) });
  return t;
}

// ───────────────────────── Catálogo de reglas ─────────────────────────
// pol: +1 suma, -1 resta. cat: tec | fun | obj. sub (técnicas): trend | trig
// eval(t, f, ctx, params) → { met: bool|null (null = sin dato), val: texto, frac?: 0..1 (puntaje gradual) }
const f1 = (x, d = 1) => (x == null || !isFinite(x) ? '—' : x.toFixed(d));
const pct = (x) => (x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(1) + '%');
const clamp = (x) => Math.max(0, Math.min(1, x));
// "≥ mínimo": cumplir da 75–100% del peso; quedarse cerca da hasta 50%
const gMin = (v, min, fmt) => {
  if (v == null || !isFinite(v)) return { met: null, val: '—' };
  const u = Math.abs(min) || 1, met = v >= min;
  return { met, val: fmt(v), frac: met ? 0.75 + 0.25 * clamp((v - min) / u) : 0.5 * clamp(1 - (min - v) / u) };
};
// "≤ máximo" (múltiplos: valores ≤ 0 = pérdidas, no suman)
const gMax = (v, max, fmt) => {
  if (v == null || !isFinite(v)) return { met: null, val: '—' };
  if (v <= 0) return { met: false, val: fmt(v), frac: 0 };
  const met = v <= max;
  return { met, val: fmt(v), frac: met ? 0.75 + 0.25 * clamp((max - v) / max) : 0.5 * clamp(1 - (v - max) / max) };
};
// rango "cuanto más mejor"
const rangeUp = (v, min, max, fmt) => (v == null ? { met: null, val: '—' } : { met: v >= min && v <= max, val: fmt(v), frac: v >= min && v <= max ? 0.6 + 0.4 * clamp((v - min) / ((max - min) || 1)) : v < min ? 0.4 * clamp(v / min) : 0.3 });
const x1 = (d) => (x) => x.toFixed(d) + 'x', pc = (d) => (x) => x.toFixed(d) + '%';
const fair = (t, f) => (f.fairValue > 0 ? { v: f.fairValue, src: f._manual?.includes('fairValue') ? (f.fairSrc || 'tuyo') : 'tuyo' } : f.targetMean > 0 ? { v: f.targetMean, src: 'consenso' } : null);

export const RULES = {
  // ── Técnicas · TENDENCIA (estado de fondo)
  above200: { cat: 'tec', sub: 'trend', pol: 1, w: 3, label: 'Arriba de la EMA200', p: {}, hint: 'tendencia de largo plazo',
    eval: (t) => (t.d200 == null ? { met: null, val: '—' } : { met: t.d200 > 0, val: pct(t.d200), frac: t.d200 > 0 ? 0.75 + 0.25 * clamp(t.d200 / 15) : 0.4 * clamp(1 + t.d200 / 10) }) },
  slope200: { cat: 'tec', sub: 'trend', pol: 1, w: 2, label: 'EMA200 subiendo', p: {}, hint: 'pendiente de la EMA200 en 20 ruedas',
    eval: (t) => (t.slope200 == null ? { met: null, val: '—' } : { met: t.slope200 > 0, val: pct(t.slope200), frac: t.slope200 > 0 ? 0.75 + 0.25 * clamp(t.slope200 / 3) : 0 }) },
  golden: { cat: 'tec', sub: 'trend', pol: 1, w: 2, label: 'EMA50 sobre EMA200', p: {}, hint: 'medias alineadas al alza',
    eval: (t) => (t.e50 == null || t.e200 == null ? { met: null, val: '—' } : { met: t.e50 > t.e200, val: pct((t.e50 / t.e200 - 1) * 100) }) },
  rs_strong: { cat: 'tec', sub: 'trend', pol: 1, w: 2, opt: 1, label: 'Le gana al benchmark (3m)', p: { dias: 63, margen: 0 }, hint: 'retorno vs benchmark del grupo',
    eval: (t, f, c, p) => { if (!t.benchRet) return { met: null, val: 'sin benchmark' }; const d = t.ret(p.dias) - t.benchRet(p.dias); return isFinite(d) ? { met: d > p.margen, val: pct(d), frac: d > p.margen ? 0.75 + 0.25 * clamp(d / 20) : 0.4 * clamp(1 + d / 15) } : { met: null, val: '—' }; } },
  rs_6m: { cat: 'tec', sub: 'trend', pol: 1, w: 1, opt: 1, label: 'Le gana al benchmark (6m)', p: { dias: 126, margen: 0 },
    eval: (t, f, c, p) => { if (!t.benchRet) return { met: null, val: 'sin benchmark' }; const d = t.ret(p.dias) - t.benchRet(p.dias); return isFinite(d) ? { met: d > p.margen, val: pct(d) } : { met: null, val: '—' }; } },

  // ── Técnicas · GATILLO (momento de entrada)
  ema200_touch: { cat: 'tec', sub: 'trig', pol: 1, w: 1, tg: 1, label: 'Tocando EMA200', p: { banda: 2 }, hint: 'precio a ±banda% de la EMA200',
    eval: (t, f, c, p) => ({ met: t.d200 == null ? null : Math.abs(t.d200) <= p.banda, val: pct(t.d200) }) },
  ema200_cross: { cat: 'tec', sub: 'trig', pol: 1, w: 1, tg: 1, label: 'Supera EMA200', p: { dias: 5 }, hint: 'cruce alcista en las últimas N ruedas',
    eval: (t, f, c, p) => { const d = t.crossed(t.close, t.ema200, p.dias, 1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : pct(t.d200) }; } },
  ema50_touch: { cat: 'tec', sub: 'trig', pol: 1, w: 1, label: 'Pullback a EMA50', p: { banda: 1.5 }, hint: 'toca la EMA50 estando arriba de la EMA200',
    eval: (t, f, c, p) => ({ met: t.d50 == null ? null : Math.abs(t.d50) <= p.banda && (t.d200 ?? -1) > 0, val: pct(t.d50) }) },
  ema50_cross: { cat: 'tec', sub: 'trig', pol: 1, w: 1, label: 'Supera EMA50', p: { dias: 5 },
    eval: (t, f, c, p) => { const d = t.crossed(t.close, t.ema50, p.dias, 1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : pct(t.d50) }; } },
  rsi_low: { cat: 'tec', sub: 'trig', pol: 1, w: 3, tg: 1, label: 'RSI bajo', p: { nivel: 35 }, hint: 'RSI(14) por debajo del nivel',
    eval: (t, f, c, p) => ({ met: t.rsiNow == null ? null : t.rsiNow < p.nivel, val: f1(t.rsiNow, 0) }) },
  div_bull: { cat: 'tec', sub: 'trig', pol: 1, w: 2, tg: 1, label: 'Divergencia alcista', p: { ventana: 60, reciente: 10 }, hint: 'precio mínimo más bajo + RSI mínimo más alto',
    eval: (t, f, c, p) => { const d = t.div('bull', p.ventana, p.reciente); return { met: !!d, val: d ? t.dates[d.b] : '—' }; } },
  macd_up: { cat: 'tec', sub: 'trig', pol: 1, w: 1, label: 'Cruce MACD alcista', p: { dias: 5 },
    eval: (t, f, c, p) => { const d = t.crossed(t.macd, t.macdSig, p.dias, 1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : '—' }; } },
  pattern_bull: { cat: 'tec', sub: 'trig', pol: 1, w: 3, tg: 1, label: 'Figura alcista', p: {}, hint: 'bandera, banderín, HCH invertido, doble piso, triángulo ascendente',
    eval: (t) => { const ps = t.patterns.filter((x) => x.dir > 0); return { met: ps.length > 0, val: ps.map((x) => `${x.name} (${x.stage})`).join(', ') || '—', frac: ps.some((x) => x.stage === 'formando') ? 1 : 0.7 }; } },

  // ── Técnicas negativas
  rsi_high: { cat: 'tec', pol: -1, w: 1, label: 'RSI sobrecompra', p: { nivel: 70 },
    eval: (t, f, c, p) => ({ met: t.rsiNow == null ? null : t.rsiNow > p.nivel, val: f1(t.rsiNow, 0) }) },
  div_bear: { cat: 'tec', pol: -1, w: 2, tg: 1, label: 'Divergencia bajista', p: { ventana: 60, reciente: 10 },
    eval: (t, f, c, p) => { const d = t.div('bear', p.ventana, p.reciente); return { met: !!d, val: d ? t.dates[d.b] : '—' }; } },
  ema200_lost: { cat: 'tec', pol: -1, w: 3, tg: 1, label: 'Pierde EMA200', p: { dias: 5 },
    eval: (t, f, c, p) => { const d = t.crossed(t.close, t.ema200, p.dias, -1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : pct(t.d200) }; } },
  death_cross: { cat: 'tec', pol: -1, w: 2, tg: 1, label: 'Death cross 50/200', p: { dias: 15 },
    eval: (t, f, c, p) => { const d = t.crossed(t.ema50, t.ema200, p.dias, -1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : '—' }; } },
  macd_down: { cat: 'tec', pol: -1, w: 1, label: 'Cruce MACD bajista', p: { dias: 5 },
    eval: (t, f, c, p) => { const d = t.crossed(t.macd, t.macdSig, p.dias, -1); return { met: d >= 0, val: d >= 0 ? `hace ${d}d` : '—' }; } },
  rs_weak: { cat: 'tec', pol: -1, w: 0, label: 'Pierde vs benchmark', p: { dias: 63, margen: 10 }, hint: 'queda atrás más de margen%',
    eval: (t, f, c, p) => { if (!t.benchRet) return { met: null, val: 'sin benchmark' }; const d = t.ret(p.dias) - t.benchRet(p.dias); return { met: isFinite(d) ? d < -p.margen : null, val: pct(d) }; } },
  stretched: { cat: 'tec', pol: -1, w: 0, label: 'Estirada vs EMA200', p: { max: 40 }, hint: 'precio más de max% arriba de la EMA200',
    eval: (t, f, c, p) => ({ met: t.d200 == null ? null : t.d200 > p.max, val: pct(t.d200) }) },
  pattern_bear: { cat: 'tec', pol: -1, w: 1, tg: 1, label: 'Figura bajista', p: {}, hint: 'HCH, bandera bajista, doble techo, triángulo descendente',
    eval: (t) => { const ps = t.patterns.filter((x) => x.dir < 0); return { met: ps.length > 0, val: ps.map((x) => `${x.name} (${x.stage})`).join(', ') || '—' }; } },

  // ── Fundamentals comunes
  upside: { cat: 'fun', pol: 1, w: 3, opt: 1, label: 'Upside a precio justo ≥', p: { min: 15 }, hint: 'tu precio justo (tesis o manual); si no hay, el consenso de analistas',
    eval: (t, f, c, p) => { const fv = fair(t, f); if (!fv) return { met: null, val: 'sin precio justo' }; const u = (fv.v / t.price - 1) * 100; return { ...gMin(u, p.min, pct), val: `${pct(u)} a US$${fv.v.toFixed(2)} (${fv.src})` }; } },
  over_fair: { cat: 'fun', pol: -1, w: 2, tg: 1, label: 'Arriba de su precio justo', p: { margen: 0 }, hint: 'precio supera el precio justo + margen%',
    eval: (t, f, c, p) => { const fv = fair(t, f); if (!fv) return { met: null, val: '—' }; const u = (t.price / fv.v - 1) * 100; return { met: u > p.margen, val: `${pct(u)} vs US$${fv.v.toFixed(2)} (${fv.src})` }; } },
  fpe: { cat: 'fun', pol: 1, w: 2, label: 'P/E forward ≤', p: { max: 25 }, eval: (t, f, c, p) => gMax(f.forwardPE, p.max, x1(1)) },
  peg: { cat: 'fun', pol: 1, w: 2, label: 'PEG ≤', p: { max: 1 }, eval: (t, f, c, p) => gMax(f.peg, p.max, x1(2)) },
  eps_gap: { cat: 'fun', pol: 1, w: 2, opt: 1, label: 'Precio atrás del EPS', p: { gap: 0 }, hint: 'var. precio 12m − var. EPS YoY ≤ gap (pp)',
    eval: (t, f, c, p) => { if (f.epsYoY == null || t.priceYoY == null) return { met: null, val: '—' }; const g = t.priceYoY - f.epsYoY; return { met: g <= p.gap, val: `${pct(t.priceYoY)} vs ${pct(f.epsYoY)}`, frac: g <= p.gap ? 0.75 + 0.25 * clamp((p.gap - g) / 50) : 0.5 * clamp(1 - (g - p.gap) / 40) }; } },
  evebitda: { cat: 'fun', pol: 1, w: 1, label: 'EV/EBITDA ≤', p: { max: 18 }, eval: (t, f, c, p) => gMax(f.evEbitda, p.max, x1(1)) },
  de: { cat: 'fun', pol: 1, w: 1, label: 'Deuda/Equity ≤', p: { max: 1 }, eval: (t, f, c, p) => (f.debtEquity === 0 ? { met: true, val: '0x' } : gMax(f.debtEquity, p.max, x1(2))) },
  insider: { cat: 'fun', pol: 1, w: 2, tg: 1, opt: 1, label: 'Compra de insiders', p: { min: 1, dias: 90 }, hint: 'solo compras; si no hay, no resta',
    eval: (t, f, c, p) => { if (!f.insiderBuys) return { met: null, val: '—' }; const lim = Date.now() - p.dias * 864e5; const b = f.insiderBuys.filter((x) => +new Date(x.date) >= lim); return b.length >= p.min ? { met: true, val: `${b.length} compra(s)` } : { met: null, val: '0' }; } },
  drawdown: { cat: 'fun', pol: 1, w: 2, label: 'Drawdown ≥', p: { min: 20 }, hint: 'caída desde máximo 52 semanas', eval: (t, f, c, p) => gMin(-t.dd, p.min, (x) => pct(-x)) },
  beat: { cat: 'fun', pol: 1, w: 2, label: 'Earnings > estimado', p: { sorpresa: 0, trimestres: 1 }, hint: 'últimos N trimestres superan por ≥ sorpresa%',
    eval: (t, f, c, p) => { const e = (f.earnings || []).slice(-p.trimestres); if (!e.length) return { met: null, val: '—' }; return { met: e.every((x) => x.surprise >= p.sorpresa), val: e.map((x) => pct(x.surprise)).join(' · ') }; } },

  // ── Métricas sectoriales (se activan por grupo)
  div_range: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'Dividend yield en rango', p: { min: 2, max: 7 }, hint: 'cuanto más alto dentro del rango, más suma', eval: (t, f, c, p) => rangeUp(f.divYield, p.min, p.max, pc(2)) },
  div_vs_avg: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'Yield sobre su promedio 5a', p: { margen: 0 }, hint: 'yield actual vs promedio 5 años: precio atrasado vs su historia',
    eval: (t, f, c, p) => { if (!f.divYield || !f.divYield5y) return { met: null, val: '—' }; const d = (f.divYield / f.divYield5y - 1) * 100; return { met: d >= p.margen, val: `${f.divYield.toFixed(2)}% vs ${f.divYield5y.toFixed(2)}%`, frac: d >= p.margen ? 0.75 + 0.25 * clamp(d / 25) : 0.5 * clamp(1 + d / 30) }; } },
  payout_range: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Payout en rango', p: { min: 60, max: 75 }, hint: 'dividendo cubierto sin descuidar la reinversión',
    eval: (t, f, c, p) => (f.payout == null ? { met: null, val: '—' } : { met: f.payout >= p.min && f.payout <= p.max, val: f.payout.toFixed(0) + '%', frac: f.payout >= p.min && f.payout <= p.max ? 1 : 0.5 * clamp(1 - Math.min(Math.abs(f.payout - p.min), Math.abs(f.payout - p.max)) / 30) }) },
  efficiency: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'Efficiency ratio ≤', p: { max: 60 }, hint: 'gastos / ingresos: cuanto más bajo, mejor', eval: (t, f, c, p) => gMax(f.efficiency, p.max, pc(1)) },
  roe: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'ROE ≥', p: { min: 15 }, eval: (t, f, c, p) => gMin(f.roe, p.min, pc(1)) },
  pb: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'P/Book ≤', p: { max: 2 }, eval: (t, f, c, p) => gMax(f.pb, p.max, x1(2)) },
  op_margin: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Margen operativo ≥', p: { min: 20 }, eval: (t, f, c, p) => gMin(f.opMargin, p.min, pc(1)) },
  gross_margin: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Margen bruto ≥', p: { min: 50 }, eval: (t, f, c, p) => gMin(f.grossMargin, p.min, pc(1)) },
  rev_growth: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Crecimiento de ventas ≥', p: { min: 10 }, hint: 'interanual, último trimestre', eval: (t, f, c, p) => gMin(f.revGrowth, p.min, pct) },
  fcf_yield: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'FCF yield ≥', p: { min: 3 }, hint: 'flujo de caja libre / market cap', eval: (t, f, c, p) => gMin(f.fcfYield, p.min, pc(1)) },
  debt_ebitda: { cat: 'fun', pol: 1, w: 1, off: 1, label: 'Deuda/EBITDA ≤', p: { max: 3 }, eval: (t, f, c, p) => (f.debtEbitda === 0 ? { met: true, val: '0x' } : gMax(f.debtEbitda, p.max, x1(1))) },
  ev_sales: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'EV/Ventas ≤', p: { max: 15 }, eval: (t, f, c, p) => gMax(f.evSales, p.max, x1(1)) },
  rule40: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'Regla del 40 ≥', p: { min: 40 }, hint: 'crecimiento de ventas % + margen FCF %', eval: (t, f, c, p) => gMin(f.rule40, p.min, (x) => x.toFixed(0)) },
  eps_rev_up: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Suben EPS estimado', p: { pct: 2 }, hint: 'revisión EPS año en curso, 90 días', eval: (t, f, c, p) => gMin(f.epsRev90, p.pct, pct) },
  cash_debt: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'Caja / Deuda ≥', p: { min: 30 }, hint: 'colchón de liquidez frente a la deuda', eval: (t, f, c, p) => gMin(f.cashDebt, p.min, pc(0)) },
  debt_mcap: { cat: 'fun', pol: 1, w: 1, off: 1, label: 'Deuda / Market cap ≤', p: { max: 50 }, hint: 'cuánto pesa la deuda sobre lo que vale la empresa', eval: (t, f, c, p) => gMax(f.debtMcap, p.max, pc(0)) },
  current_ratio: { cat: 'fun', pol: 1, w: 1, off: 1, label: 'Liquidez corriente ≥', p: { min: 1 }, hint: 'activo corriente / pasivo corriente', eval: (t, f, c, p) => gMin(f.currentRatio, p.min, x1(2)) },
  ev_arr: { cat: 'fun', pol: 1, w: 3, off: 1, label: 'EV / ARR proyectado ≤', p: { max: 8 }, hint: 'ARR proyectado (USD bn) lo cargás vos en la ficha',
    eval: (t, f, c, p) => (f.evArr == null ? { met: null, val: f.arrProj ? 'falta EV' : 'cargá el ARR' } : gMax(f.evArr, p.max, x1(1))) },
  ev_gw: { cat: 'fun', pol: 1, w: 2, off: 1, label: 'EV por GW ≤', p: { max: 15 }, hint: 'USD bn de EV por cada GW de capacidad total (los GW los cargás vos)',
    eval: (t, f, c, p) => (f.evGw == null ? { met: null, val: f.gwTotal ? 'falta EV' : 'cargá los GW' } : gMax(f.evGw, p.max, (x) => 'US$' + x.toFixed(1) + 'bn/GW')) },
  dilution: { cat: 'fun', pol: -1, w: 2, off: 1, label: 'Dilución alta', p: { max: 10 }, hint: 'acciones en circulación: suba interanual mayor a max%',
    eval: (t, f, c, p) => (f.sharesYoY == null ? { met: null, val: '—' } : { met: f.sharesYoY > p.max, val: pct(f.sharesYoY) }) },
  payout_high: { cat: 'fun', pol: -1, w: 2, off: 1, label: 'Payout insostenible', p: { max: 90 },
    eval: (t, f, c, p) => (f.payout == null ? { met: null, val: '—' } : { met: f.payout > p.max, val: f.payout.toFixed(0) + '%' }) },
  rev_decline: { cat: 'fun', pol: -1, w: 2, off: 1, label: 'Ventas desaceleran', p: { margen: 5 }, hint: 'crecimiento del último trimestre (YoY) vs el del último año fiscal: resta si cae más de margen pp',
    eval: (t, f, c, p) => { if (f.revGrowth == null || f.revGrowthFY == null) return { met: null, val: '—' }; const d = f.revGrowth - f.revGrowthFY; return { met: d < -p.margen, val: `trim. ${pct(f.revGrowth)} vs año ${pct(f.revGrowthFY)}` }; } },

  // ── Fundamentals negativos comunes
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
  below_avg: { cat: 'obj', pol: 1, w: 2, tg: 1, opt: 1, label: 'Debajo de su promedio', p: { margen: 10 }, hint: 'métricas ≥ margen% por debajo de tu promedio cargado',
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

export function defaultRules() {
  const o = {};
  for (const [id, r] of Object.entries(RULES)) o[id] = { on: !r.off, w: r.w, p: { ...r.p }, tg: !!r.tg };
  return o;
}

// Evalúa un ticker contra las reglas de su grupo. Scores 0–100, pensados para comparar DENTRO del grupo.
//   AT = 60% Tendencia + 40% Gatillo − negativas    ·    AF = puntaje gradual ponderado − negativas
//   Los datos faltantes cuentan como 0 (salvo reglas opcionales) y bajan la "cobertura".
const TRIG_FULL = 5; // con 5 puntos de gatillos activos el gatillo está al 100%
export function scoreTicker(ticker, group, data, benchData) {
  if (!data?.prices?.close?.length) return { error: data?.error || 'sin datos' };
  const t = technicals(data.prices, benchData?.prices);
  const auto = data.fund && !data.fund.error ? data.fund : {};
  const man = Object.fromEntries(Object.entries(ticker.fundOverrides || {}).filter(([, v]) => v != null && v !== '' && isFinite(v)).map(([k, v]) => [k, +v]));
  const f = { ...auto, ...man, _manual: Object.keys(man), fairSrc: ticker.kpiSrc?.fairValue ? 'tesis' : 'tuyo' };
  if (f.ev > 0 && f.arrProj > 0) f.evArr = Math.round((f.ev / f.arrProj) * 100) / 100;
  if (f.ev > 0 && f.gwTotal > 0) f.evGw = Math.round((f.ev / f.gwTotal) * 100) / 100;
  const targets = evalTargets(t, f, ticker.targets);
  const ctx = { targets };
  const res = [];
  const acc = { trend: { got: 0, max: 0, have: 0 }, trig: { got: 0 }, tecNeg: 0, fun: { got: 0, max: 0, have: 0 }, funNeg: 0 };
  let metT = 0, totT = 0, metF = 0, totF = 0;
  for (const [id, def] of Object.entries(RULES)) {
    const g = group.rules?.[id] || { on: false, w: def.w, p: def.p };
    const ov = ticker.overrides?.[id] || {};
    const on = ov.on ?? g.on; if (!on) continue;
    const w = ov.w ?? g.w; const p = { ...def.p, ...g.p, ...(ov.p || {}) };
    let r; try { r = def.eval(t, f, ctx, p); } catch { r = { met: null, val: 'err' }; }
    const s = r.met == null ? 0 : (r.frac ?? (r.met ? 1 : 0));
    res.push({ id, label: def.label, cat: def.cat, sub: def.sub, pol: def.pol, w, met: r.met, val: r.val, frac: r.frac, s, tg: g.tg ?? !!def.tg });
    if (!w) continue;
    if (def.cat === 'tec') {
      if (def.pol < 0) { if (r.met) acc.tecNeg += w; continue; }
      if (def.sub === 'trend') { if (r.met == null && def.opt) continue; acc.trend.max += w; acc.trend.got += w * s; if (r.met != null) acc.trend.have += w; totT++; if (r.met) metT++; }
      else { if (r.met) { acc.trig.got += w * (r.frac ?? 1); metT++; } }
    } else {
      if (def.pol < 0) { if (r.met) acc.funNeg += w; continue; }
      if (r.met == null && def.opt) continue;
      acc.fun.max += w; acc.fun.got += w * s; if (r.met != null) acc.fun.have += w; totF++; if (r.met) metF++;
    }
  }
  const trend = acc.trend.max ? acc.trend.got / acc.trend.max : 0;
  const trig = Math.min(1, acc.trig.got / TRIG_FULL);
  const at = Math.max(0, Math.min(100, 100 * (0.6 * trend + 0.4 * trig) - (100 * acc.tecNeg) / ((acc.trend.max || 10) + TRIG_FULL)));
  const hasAF = acc.fun.max > 0;
  const af = hasAF ? Math.max(0, Math.min(100, (100 * (acc.fun.got - acc.funNeg)) / acc.fun.max)) : null;
  const R = (x) => Math.round(x);
  const tec = { score: R(at), trend: R(trend * 100), trig: R(trig * 100), metPos: metT, totPos: totT, neg: acc.tecNeg, coverage: acc.trend.max ? R((100 * acc.trend.have) / acc.trend.max) : 0, pct: at / 100 };
  const fun = { score: hasAF ? R(af) : null, metPos: metF, totPos: totF, neg: acc.funNeg, coverage: hasAF ? R((100 * acc.fun.have) / acc.fun.max) : null, pct: hasAF ? af / 100 : 0 };
  const total = hasAF ? R(0.5 * at + 0.5 * af) : R(at);
  return { t, f, targets, rules: res, tec, fun, score: total, pct: total / 100, metPos: metT + metF, totPos: totT + totF, hasAF };
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
  ['debtEbitda', 'Deuda/EBITDA', 'x'], ['cashDebt', 'Caja / Deuda', '%'], ['debtMcap', 'Deuda / Market cap', '%'], ['currentRatio', 'Liquidez corriente', 'x'], ['ev', 'Enterprise value (USD bn)', ''], ['fairValue', 'Precio justo (US$)', ''], ['targetMean', 'Precio objetivo consenso (US$)', ''], ['arrProj', 'ARR proyectado (USD bn)', ''], ['gwTotal', 'Capacidad total (GW)', ''], ['sharesYoY', 'Dilución (acciones YoY)', '%'], ['debtEquity', 'Deuda/Equity', 'x'], ['epsRev30', 'Revisión EPS 30d', '%'], ['epsRev90', 'Revisión EPS 90d', '%'],
];
