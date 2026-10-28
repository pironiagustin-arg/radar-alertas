import { RULES, MARKET_RULES, TARGET_METRICS, defaultRules, defaultMarket, scoreTicker, evalMarket } from './engine.js';

// ───────────────────────── Estado ─────────────────────────
const KEY = 'radar-alertas-v1';
const COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#ef4444', '#eab308'];
const uid = () => Math.random().toString(36).slice(2, 9);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function seed() {
  const ia = { id: uid(), name: 'IA / Semis', benchmark: 'SMH', color: COLORS[0], rules: defaultRules() };
  const cal = { id: uid(), name: 'Calidad', benchmark: 'SPY', color: COLORS[1], rules: defaultRules() };
  ia.rules.fpe.p.max = 35; ia.rules.peg.p.max = 1.5; ia.rules.fpe_high.p.max = 60; ia.rules.stretched.p.max = 50;
  cal.rules.fpe.p.max = 25; cal.rules.peg.p.max = 2; cal.rules.drawdown.p.min = 15;
  return {
    market: defaultMarket(), refreshMin: 15,
    groups: [ia, cal],
    tickers: [
      ...['NVDA', 'AVGO', 'MU'].map((s) => ({ symbol: s, group: ia.id, targets: [], overrides: {} })),
      ...['MSFT', 'GOOGL'].map((s) => ({ symbol: s, group: cal.id, targets: [], overrides: {} })),
    ],
  };
}

let S = load();
let DATA = { symbols: {} }, RESULTS = [], MARKET = null;
let LOG = JSON.parse(localStorage.getItem(KEY + ':log') || '[]');
let ACTIVE = JSON.parse(localStorage.getItem(KEY + ':active') || 'null');
let filterGroup = 'all', openSym = null, unseen = 0;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.groups) {
      // completa reglas nuevas que no existían cuando se guardó
      for (const g of s.groups) { const d = defaultRules(); for (const k in d) if (!g.rules[k]) g.rules[k] = d[k]; }
      s.market = { ...defaultMarket(), ...(s.market || {}) };
      return s;
    }
  } catch {}
  return seed();
}
const save = () => localStorage.setItem(KEY, JSON.stringify(S));
const groupOf = (t) => S.groups.find((g) => g.id === t.group) || S.groups[0];

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2400); }

// ───────────────────────── Datos ─────────────────────────
function neededSymbols() {
  const syms = new Set(['SPY', '^VIX']);
  S.tickers.forEach((t) => syms.add(t.symbol));
  S.groups.forEach((g) => g.benchmark && syms.add(g.benchmark.toUpperCase()));
  const fund = S.tickers.filter((t) => Object.entries(groupOf(t)?.rules || {}).some(([id, r]) => r.on && RULES[id]?.cat === 'fun')).map((t) => t.symbol);
  return { syms: [...syms], fund };
}

async function refresh(manual) {
  const { syms, fund } = neededSymbols();
  const btn = $('#btnRefresh'); btn.disabled = true; btn.textContent = 'Cargando…';
  try {
    const qs = `symbols=${encodeURIComponent(syms.join(','))}&fund=${encodeURIComponent(fund.join(','))}`;
    const r = await fetch('/api/data?' + qs + (manual ? `&t=${Date.now()}` : ''));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    DATA = await r.json();
    evaluate(); detectAlerts(); render();
    $('#asof').textContent = 'Act. ' + new Date(DATA.asOf).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { toast('Error trayendo datos: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Actualizar';
}

function evaluate() {
  MARKET = evalMarket(S.market, DATA.symbols.SPY, DATA.symbols['^VIX']);
  RESULTS = S.tickers.map((t) => {
    const g = groupOf(t);
    const r = scoreTicker(t, g, DATA.symbols[t.symbol], g.benchmark ? DATA.symbols[g.benchmark.toUpperCase()] : null);
    return { ticker: t, group: g, ...r };
  }).sort((a, b) => (b.score ?? -99) - (a.score ?? -99) || (b.pct ?? 0) - (a.pct ?? 0));
}

// Alertas: se disparan cuando una condición pasa de "no" a "sí" entre una actualización y otra
function detectAlerts() {
  const now = {}; const fresh = [];
  for (const m of MARKET?.rules || []) if (m.met) now['MKT:' + m.id] = { sym: 'Mercado', label: m.label, pol: m.pol, val: m.val };
  for (const r of RESULTS) for (const x of r.rules || []) if (x.met) now[r.ticker.symbol + ':' + x.id] = { sym: r.ticker.symbol, label: x.label, pol: x.pol, val: x.val, score: r.score };
  const first = ACTIVE == null;
  for (const [k, v] of Object.entries(now)) if (!first && !ACTIVE[k]) fresh.push({ ...v, k, t: Date.now() });
  ACTIVE = Object.fromEntries(Object.keys(now).map((k) => [k, 1]));
  localStorage.setItem(KEY + ':active', JSON.stringify(ACTIVE));
  if (first) toast('Primera carga: las alertas arrancan a partir de la próxima actualización');
  if (!fresh.length) return;
  LOG = [...fresh.reverse(), ...LOG].slice(0, 400);
  localStorage.setItem(KEY + ':log', JSON.stringify(LOG));
  unseen += fresh.length;
  if ('Notification' in window && Notification.permission === 'granted') {
    const pos = fresh.filter((f) => f.pol > 0), neg = fresh.filter((f) => f.pol < 0);
    new Notification(`Radar: ${fresh.length} alerta(s) nueva(s)`, {
      body: [...pos.slice(0, 4).map((f) => `▲ ${f.sym} · ${f.label}`), ...neg.slice(0, 4).map((f) => `▼ ${f.sym} · ${f.label}`)].join('\n'),
    });
  }
}

// ───────────────────────── Render ─────────────────────────
function render() {
  renderMarket(); renderRanking(); renderGroups(); renderAlerts(); renderSettings();
  if (openSym) renderDrawer(openSym);
  $('#alertCount').textContent = unseen || '';
}

function renderMarket() {
  const el = $('#market');
  if (!MARKET) { el.innerHTML = '<div class="mcard"><div class="k">Mercado</div><div class="v">…</div></div>'; return; }
  const cards = [
    { k: 'VIX', v: MARKET.vix.toFixed(1), ids: ['vix_high', 'vix_low'] },
    { k: 'SPY desde máximo', v: (MARKET.spyDD > 0 ? '+' : '') + MARKET.spyDD.toFixed(1) + '%', ids: ['spy_dd'] },
    { k: 'SPY vs EMA200', v: (MARKET.spyD200 > 0 ? '+' : '') + MARKET.spyD200.toFixed(1) + '%', ids: ['spy_stretched', 'spy_below200', 'spy_death'] },
  ];
  el.innerHTML = cards.map((c) => {
    const act = MARKET.rules.filter((r) => c.ids.includes(r.id) && r.met);
    const cls = act.some((a) => a.pol > 0) ? 'on-pos' : act.length ? 'on-neg' : '';
    return `<div class="mcard ${cls}"><div class="k">${c.k}</div><div class="v">${c.v}</div>
      <div class="chips" style="margin-top:6px">${act.map((a) => `<span class="chip ${a.pol > 0 ? 'p' : 'n'}">${esc(a.label)}</span>`).join('') || '<span class="muted">sin señal</span>'}</div></div>`;
  }).join('');
}

const fmt = (x, d = 1) => (x == null || !isFinite(x) ? '—' : x.toFixed(d));
const sgn = (x, d = 1) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : '') + x.toFixed(d) + '%');

function renderRanking() {
  const el = $('#tab-ranking');
  if (!S.tickers.length) { el.innerHTML = '<div class="empty">Todavía no cargaste tickers. Andá a <b>Grupos</b>, creá uno y sumale acciones.</div>'; return; }
  const rows = RESULTS.filter((r) => filterGroup === 'all' || r.group.id === filterGroup);
  const maxW = Math.max(1, ...RESULTS.map((r) => r.posMax || 0));
  el.innerHTML = `
    <div class="row spread">
      <div class="chips">
        <span class="chip f ${filterGroup === 'all' ? 'on' : ''}" data-g="all">Todos (${S.tickers.length})</span>
        ${S.groups.map((g) => `<span class="chip f ${filterGroup === g.id ? 'on' : ''}" data-g="${g.id}" style="border-left:3px solid ${g.color}">${esc(g.name)} (${S.tickers.filter((t) => t.group === g.id).length})</span>`).join('')}
      </div>
      <span class="muted">Score = peso de condiciones positivas cumplidas − peso de negativas activas</span>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>#</th><th>Ticker</th><th class="hide-m">Grupo</th><th style="text-align:right">Precio</th><th>Score</th><th>Cumple</th><th>Señales activas</th><th style="text-align:right">RSI</th><th style="text-align:right">vs EMA200</th><th style="text-align:right">A venta</th></tr></thead>
      <tbody>${rows.map((r, i) => rowHtml(r, i, maxW)).join('') || '<tr><td colspan="10" class="muted">Sin tickers en este grupo</td></tr>'}</tbody>
    </table></div>`;
  el.querySelectorAll('[data-g]').forEach((c) => (c.onclick = () => { filterGroup = c.dataset.g; renderRanking(); }));
  el.querySelectorAll('tbody tr[data-s]').forEach((tr) => (tr.onclick = () => openDrawer(tr.dataset.s)));
}

function rowHtml(r, i, maxW) {
  const s = r.ticker.symbol;
  if (r.error) return `<tr data-s="${s}"><td class="rank">${i + 1}</td><td class="sym">${s}</td><td colspan="8" class="muted">${esc(r.error)}</td></tr>`;
  const met = r.rules.filter((x) => x.met);
  const closest = r.targets.filter((x) => x.dVenta != null).sort((a, b) => a.dVenta - b.dVenta)[0];
  const name = r.f?.name || DATA.symbols[s]?.prices?.name || '';
  return `<tr data-s="${s}">
    <td class="rank">${i + 1}</td>
    <td class="sym">${s}<small>${esc(name)}</small></td>
    <td class="hide-m"><span class="gtag" style="border-left-color:${r.group.color}">${esc(r.group.name)}</span></td>
    <td class="num">${fmt(r.t.price, 2)}</td>
    <td><div class="score"><b class="${r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : ''}">${r.score}</b>
      <div class="bar"><i style="width:${(r.pos / maxW) * 100}%"></i><u style="width:${Math.min(100, (r.neg / maxW) * 100)}%"></u></div></div></td>
    <td class="num">${r.metPos}/${r.totPos}</td>
    <td><div class="chips">${met.sort((a, b) => b.pol - a.pol || b.w - a.w).map((x) => `<span class="chip ${x.pol > 0 ? 'p' : 'n'}">${esc(x.label)}</span>`).join('') || '<span class="muted">—</span>'}</div></td>
    <td class="num ${r.t.rsiNow > 70 ? 'neg' : r.t.rsiNow < 35 ? 'pos' : ''}">${fmt(r.t.rsiNow, 0)}</td>
    <td class="num">${sgn(r.t.d200)}</td>
    <td class="num ${closest?.hit ? 'neg' : ''}">${closest ? (closest.hit ? 'LLEGÓ' : sgn(closest.dVenta)) + `<br><span class="muted">${closest.label}</span>` : '—'}</td>
  </tr>`;
}

// ── Editor de reglas reutilizable (grupo u override de ticker)
function rulesEditor(rules, { overrides, onChange, results } = {}) {
  const cats = [['tec', 'Técnicas'], ['fun', 'Fundamentals'], ['obj', 'Objetivos propios']];
  const wrap = document.createElement('div'); wrap.className = 'rules';
  for (const [cat, title] of cats) {
    const h = document.createElement('h4'); h.textContent = title; wrap.appendChild(h);
    for (const pol of [1, -1]) for (const [id, def] of Object.entries(RULES).filter(([, d]) => d.cat === cat && d.pol === pol)) {
      const base = rules[id] || { on: false, w: def.w, p: { ...def.p } };
      const ov = overrides?.[id] || {};
      const on = ov.on ?? base.on, w = ov.w ?? base.w, p = { ...def.p, ...base.p, ...(ov.p || {}) };
      const res = results?.find((x) => x.id === id);
      const row = document.createElement('div'); row.className = 'rule' + (on ? '' : ' off');
      const status = res ? (res.met == null ? '<span class="st nd">n/d</span>' : res.met ? `<span class="st ${def.pol > 0 ? 'y' : 'yn'}">SÍ</span>` : '<span class="st no">no</span>') + ` <span class="muted mono">${esc(res.val)}</span>` : '';
      row.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''} data-k="on">
        <div class="lbl"><span class="pol ${def.pol > 0 ? 'p' : 'n'}">${def.pol > 0 ? '+' : '−'}</span><span>${def.label}</span>${def.hint ? `<span class="muted">· ${def.hint}</span>` : ''} ${status}</div>
        <div class="params">${Object.keys(def.p).map((k) => `<label>${k}<input type="number" step="any" value="${p[k]}" data-p="${k}"></label>`).join('')}</div>
        <div class="w params"><label>peso<input type="number" step="1" value="${w}" data-k="w"></label></div>`;
      row.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
        const target = overrides ? (overrides[id] ||= {}) : (rules[id] ||= { on: false, w: def.w, p: { ...def.p } });
        if (inp.dataset.k === 'on') target.on = inp.checked;
        else if (inp.dataset.k === 'w') target.w = +inp.value;
        else { target.p = { ...(target.p || {}), [inp.dataset.p]: +inp.value }; }
        row.classList.toggle('off', !(overrides ? (overrides[id].on ?? base.on) : rules[id].on));
        onChange?.();
      }));
      wrap.appendChild(row);
    }
  }
  return wrap;
}

function renderGroups() {
  const el = $('#tab-grupos'); el.innerHTML = '';
  const head = document.createElement('div'); head.className = 'row spread';
  head.innerHTML = `<span class="muted">Cada grupo tiene su benchmark y su set de condiciones. Las acciones heredan las del grupo (podés ajustar una puntual desde su ficha).</span><button class="primary" id="newG">+ Nuevo grupo</button>`;
  el.appendChild(head);
  $('#newG', head).onclick = () => {
    S.groups.push({ id: uid(), name: 'Nuevo grupo', benchmark: 'SPY', color: COLORS[S.groups.length % COLORS.length], rules: defaultRules() });
    save(); renderGroups();
  };
  const grid = document.createElement('div'); grid.className = 'grid'; grid.style.marginTop = '12px'; el.appendChild(grid);
  for (const g of S.groups) {
    const card = document.createElement('div'); card.className = 'card'; card.style.borderTop = `3px solid ${g.color}`;
    const tks = S.tickers.filter((t) => t.group === g.id);
    card.innerHTML = `
      <div class="row spread">
        <div class="row"><input value="${esc(g.name)}" data-f="name" style="font-weight:600;width:180px">
          <label class="muted">Benchmark <input value="${esc(g.benchmark || '')}" data-f="benchmark" placeholder="ej. SMH" style="width:90px;text-transform:uppercase"></label>
          <input type="color" value="${g.color}" data-f="color" style="width:36px;padding:0;height:30px"></div>
        <div class="row"><button class="sm" data-a="dup">Duplicar</button><button class="sm danger" data-a="del">Eliminar</button></div>
      </div>
      <div class="chips" style="margin-top:12px">${tks.map((t) => `<span class="chip">${t.symbol} <a data-rm="${t.symbol}" style="cursor:pointer;color:var(--mut)">✕</a></span>`).join('') || '<span class="muted">Sin acciones todavía</span>'}</div>
      <div class="add"><input placeholder="Agregar tickers: NVDA, AVGO, TSM" data-add><button class="sm primary" data-a="add">Agregar</button></div>`;
    card.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('change', () => {
      g[inp.dataset.f] = inp.dataset.f === 'benchmark' ? inp.value.trim().toUpperCase() : inp.value;
      save(); if (inp.dataset.f === 'benchmark') refresh(); else { evaluate(); render(); }
    }));
    const addInp = $('[data-add]', card);
    const doAdd = () => {
      const syms = addInp.value.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
      let n = 0;
      for (const s of syms) {
        const ex = S.tickers.find((t) => t.symbol === s);
        if (ex) { ex.group = g.id; } else { S.tickers.push({ symbol: s, group: g.id, targets: [], overrides: {} }); n++; }
      }
      save(); addInp.value = ''; if (syms.length) { toast(`${syms.length} ticker(s) en ${g.name}`); refresh(); }
    };
    $('[data-a=add]', card).onclick = doAdd; addInp.onkeydown = (e) => e.key === 'Enter' && doAdd();
    card.querySelectorAll('[data-rm]').forEach((a) => (a.onclick = () => { S.tickers = S.tickers.filter((t) => t.symbol !== a.dataset.rm); save(); evaluate(); render(); }));
    $('[data-a=dup]', card).onclick = () => { S.groups.push({ ...structuredClone(g), id: uid(), name: g.name + ' (copia)' }); save(); renderGroups(); };
    $('[data-a=del]', card).onclick = () => {
      if (S.groups.length === 1) return toast('Tiene que quedar al menos un grupo');
      if (!confirm(`¿Eliminar "${g.name}"? Sus acciones pasan al primer grupo.`)) return;
      S.groups = S.groups.filter((x) => x.id !== g.id); S.tickers.forEach((t) => t.group === g.id && (t.group = S.groups[0].id));
      save(); evaluate(); render();
    };
    const det = document.createElement('details'); det.className = 'collapse';
    const on = Object.values(g.rules).filter((r) => r.on).length;
    det.innerHTML = `<summary>Condiciones del grupo (${on} activas)</summary>`;
    det.appendChild(rulesEditor(g.rules, { onChange: () => { save(); evaluate(); renderRanking(); } }));
    card.appendChild(det); grid.appendChild(card);
  }
}

function renderAlerts() {
  const el = $('#tab-alertas');
  el.innerHTML = `<div class="row spread"><span class="muted">Se registra cada condición que pasa de "no" a "sí" entre actualizaciones. Con la pestaña abierta se actualiza cada ${S.refreshMin} min.</span><button class="sm" id="clr">Limpiar</button></div>
  <div class="feed card" style="margin-top:12px">${LOG.map((a) => `<div class="it">
      <span class="chip ${a.pol > 0 ? 'p' : 'n'}">${a.pol > 0 ? '▲' : '▼'} ${esc(a.sym)}</span>
      <div>${esc(a.label)} <span class="muted mono">${esc(a.val)}</span>${a.score != null ? ` <span class="muted">· score ${a.score}</span>` : ''}</div>
      <span class="muted">${new Date(a.t).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`).join('') || '<div class="muted">Sin alertas todavía.</div>'}</div>`;
  $('#clr', el).onclick = () => { LOG = []; localStorage.setItem(KEY + ':log', '[]'); renderAlerts(); };
}

function renderSettings() {
  const el = $('#tab-ajustes');
  el.innerHTML = `<div class="grid">
    <div class="card"><h3>Alertas generales de mercado</h3><div class="rules" id="mk"></div></div>
    <div class="card"><h3>Actualización</h3><div class="row" style="margin-top:10px"><label>Refrescar cada <input type="number" id="rf" value="${S.refreshMin}"> minutos (con la pestaña abierta)</label></div></div>
    <div class="card"><h3>Backup</h3><p class="muted">La configuración vive en este navegador. Exportala para pasarla a otro dispositivo o guardarla.</p>
      <div class="row"><button id="exp">Exportar JSON</button><button id="imp">Importar JSON</button><button class="danger" id="rst">Restaurar ejemplo</button></div>
      <textarea id="io" placeholder="Pegá acá un JSON exportado y tocá Importar" style="margin-top:10px"></textarea></div></div>`;
  const mk = $('#mk', el);
  for (const [id, def] of Object.entries(MARKET_RULES)) {
    const c = S.market[id] ||= { on: true, p: { ...def.p } };
    const res = MARKET?.rules.find((r) => r.id === id);
    const row = document.createElement('div'); row.className = 'rule' + (c.on ? '' : ' off');
    row.innerHTML = `<input type="checkbox" ${c.on ? 'checked' : ''}><div class="lbl"><span class="pol ${def.pol > 0 ? 'p' : 'n'}">${def.pol > 0 ? '+' : '−'}</span>${def.label}
      ${res ? (res.met ? `<span class="st ${def.pol > 0 ? 'y' : 'yn'}">SÍ</span>` : '<span class="st no">no</span>') + ` <span class="muted mono">${esc(res.val)}</span>` : ''}</div>
      <div class="params">${Object.keys(def.p).map((k) => `<label>${k}<input type="number" step="any" data-p="${k}" value="${c.p?.[k] ?? def.p[k]}"></label>`).join('')}</div><div></div>`;
    row.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
      if (inp.type === 'checkbox') c.on = inp.checked; else c.p = { ...c.p, [inp.dataset.p]: +inp.value };
      save(); evaluate(); renderMarket(); renderSettings();
    }));
    mk.appendChild(row);
  }
  $('#rf', el).onchange = (e) => { S.refreshMin = Math.max(5, +e.target.value || 15); save(); schedule(); };
  $('#exp', el).onclick = () => { $('#io', el).value = JSON.stringify(S, null, 1); navigator.clipboard?.writeText($('#io', el).value); toast('Copiado al portapapeles'); };
  $('#imp', el).onclick = () => { try { const s = JSON.parse($('#io', el).value); if (!s.groups) throw 0; S = s; save(); S = load(); refresh(true); toast('Configuración importada'); } catch { toast('JSON inválido'); } };
  $('#rst', el).onclick = () => { if (confirm('¿Reemplazar tu configuración por el ejemplo?')) { S = seed(); save(); refresh(true); } };
}

// ───────────────────────── Ficha del ticker ─────────────────────────
function openDrawer(sym) { openSym = sym; renderDrawer(sym); $('#drawer').classList.add('on'); $('#scrim').classList.add('on'); }
function closeDrawer() { openSym = null; $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); }
$('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

function chartSvg(t, n = 250) {
  const c = t.close.slice(-n), e50 = t.ema50.slice(-n), e200 = t.ema200.slice(-n);
  const all = [...c, ...e50, ...e200].filter((x) => x != null);
  const lo = Math.min(...all), hi = Math.max(...all), W = 520, H = 170, pad = 8;
  const X = (i) => pad + (i / (c.length - 1)) * (W - 2 * pad), Y = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const path = (a) => a.map((v, i) => (v == null ? '' : `${i && a[i - 1] != null ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${path(e200)}" fill="none" stroke="#f59e0b" stroke-width="1.4"/>
    <path d="${path(e50)}" fill="none" stroke="#a855f7" stroke-width="1.2"/>
    <path d="${path(c)}" fill="none" stroke="#60a5fa" stroke-width="1.6"/></svg>
    <div class="legend"><span><i style="background:#60a5fa"></i>Precio</span><span><i style="background:#a855f7"></i>EMA50</span><span><i style="background:#f59e0b"></i>EMA200</span><span>~1 año</span></div>`;
}

function renderDrawer(sym) {
  const r = RESULTS.find((x) => x.ticker.symbol === sym); const el = $('#drawerIn');
  const tk = S.tickers.find((t) => t.symbol === sym);
  if (!r || !tk) { closeDrawer(); return; }
  if (r.error) { el.innerHTML = `<div class="dhead"><h2>${sym}</h2><button class="ghost" id="x">✕</button></div><p class="muted">${esc(r.error)}</p>`; $('#x', el).onclick = closeDrawer; return; }
  const f = r.f || {};
  el.innerHTML = `
    <div class="dhead"><div><h2>${sym} <span class="mono" style="font-size:16px">${fmt(r.t.price, 2)}</span></h2>
      <div class="muted">${esc(f.name || DATA.symbols[sym]?.prices?.name || '')} · <span class="gtag" style="border-left-color:${r.group.color}">${esc(r.group.name)}</span> ${r.group.benchmark ? `· vs ${r.group.benchmark}` : ''}</div></div>
      <button class="ghost" id="x">✕</button></div>
    <div class="kpis">
      <div class="kpi"><div class="k">Score</div><div class="v ${r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : ''}">${r.score}</div></div>
      <div class="kpi"><div class="k">Cumple</div><div class="v">${r.metPos}/${r.totPos}</div></div>
      <div class="kpi"><div class="k">RSI</div><div class="v">${fmt(r.t.rsiNow, 0)}</div></div>
      <div class="kpi"><div class="k">Drawdown</div><div class="v">${sgn(r.t.dd)}</div></div>
      <div class="kpi"><div class="k">P/E fwd</div><div class="v">${fmt(f.forwardPE)}</div></div>
      <div class="kpi"><div class="k">PEG</div><div class="v">${fmt(f.peg, 2)}</div></div>
      <div class="kpi"><div class="k">EV/EBITDA</div><div class="v">${fmt(f.evEbitda)}</div></div>
      <div class="kpi"><div class="k">D/E</div><div class="v">${fmt(f.debtEquity, 2)}</div></div>
    </div>
    ${chartSvg(r.t)}
    <h4 style="margin:18px 0 6px">Objetivos: venta y promedio</h4>
    <div class="muted">Cargás tu número de venta (dispara alerta negativa al tocarlo) y el promedio de referencia para medir distancia.</div>
    <table class="tgt"><thead><tr><th>Métrica</th><th>Venta</th><th>Promedio</th><th style="text-align:right">Actual</th><th style="text-align:right">A venta</th><th style="text-align:right">vs prom.</th><th></th></tr></thead>
    <tbody>${r.targets.map((x, i) => `<tr><td>${x.label}</td>
      <td><input type="number" step="any" value="${x.venta ?? ''}" data-i="${i}" data-k="venta"></td>
      <td><input type="number" step="any" value="${x.promedio ?? ''}" data-i="${i}" data-k="promedio"></td>
      <td class="num">${fmt(x.cur, 2)}</td><td class="num ${x.hit ? 'neg' : ''}">${x.hit ? 'LLEGÓ' : sgn(x.dVenta)}</td><td class="num">${sgn(x.dAvg)}</td>
      <td><button class="sm ghost" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table>
    <div class="add"><select id="tm">${Object.entries(TARGET_METRICS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('')}</select><button class="sm" id="addT">+ Agregar objetivo</button></div>
    <h4 style="margin:18px 0 6px">Condiciones <span class="muted">(cambios acá aplican solo a ${sym}; el resto hereda de ${esc(r.group.name)})</span></h4>
    <div id="rulesBox"></div>
    <div class="row" style="margin-top:8px"><button class="sm" id="resetOv">Volver a las del grupo</button>
      <label class="muted">Mover a <select id="mv">${S.groups.map((g) => `<option value="${g.id}" ${g.id === r.group.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label></div>
    ${f.insiderBuys?.length ? `<h4 style="margin:18px 0 6px">Compras de insiders (180d)</h4>${f.insiderBuys.map((b) => `<div class="muted">${b.date} · ${esc(b.who)} (${esc(b.role)}) · ${b.shares?.toLocaleString('es-AR')} acc.</div>`).join('')}` : ''}
    ${f.earnings?.length ? `<h4 style="margin:18px 0 6px">EPS vs estimado</h4><div class="chips">${f.earnings.map((e) => `<span class="chip ${e.surprise >= 0 ? 'p' : 'n'}">${e.q?.slice(0, 7)} · ${e.actual} vs ${e.est} (${sgn(e.surprise)})</span>`).join('')}</div>` : ''}
    ${f.nextEarnings ? `<p class="muted">Próximo reporte: ${f.nextEarnings}</p>` : ''}`;
  $('#x', el).onclick = closeDrawer;
  el.querySelectorAll('.tgt input').forEach((inp) => inp.addEventListener('change', () => {
    const v = inp.value === '' ? null : +inp.value; tk.targets[+inp.dataset.i][inp.dataset.k] = v; save(); evaluate(); render();
  }));
  el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { tk.targets.splice(+b.dataset.del, 1); save(); evaluate(); render(); }));
  $('#addT', el).onclick = () => { tk.targets.push({ metric: $('#tm', el).value, venta: null, promedio: null }); save(); evaluate(); render(); };
  tk.overrides ||= {};
  $('#rulesBox', el).appendChild(rulesEditor(r.group.rules, { overrides: tk.overrides, results: r.rules, onChange: () => { save(); evaluate(); renderRanking(); } }));
  $('#resetOv', el).onclick = () => { tk.overrides = {}; save(); evaluate(); render(); };
  $('#mv', el).onchange = (e) => { tk.group = e.target.value; save(); refresh(); };
}

// ───────────────────────── Arranque ─────────────────────────
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'alertas') { unseen = 0; $('#alertCount').textContent = ''; }
}));
$('#btnRefresh').onclick = () => refresh(true);
$('#btnNotif').onclick = async () => {
  if (!('Notification' in window)) return toast('Este navegador no soporta notificaciones');
  const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Notificaciones activadas' : 'Notificaciones bloqueadas');
};
let timer; function schedule() { clearInterval(timer); timer = setInterval(() => refresh(), S.refreshMin * 60 * 1000); }
render(); refresh(); schedule();
