import { FUND_FIELDS, RULES, MARKET_RULES, TARGET_METRICS, defaultRules, defaultMarket, scoreTicker, evalMarket } from './engine.js';
import DEFAULT_CONFIG from './default-config.js';
import { PROFILES, COMMON, applyProfile } from './profiles.js';

// ───────────────────────── Estado ─────────────────────────
const KEY = 'radar-alertas-v2';
const COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#ef4444', '#eab308'];
const uid = () => Math.random().toString(36).slice(2, 9);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function seed() { return normalize(structuredClone(DEFAULT_CONFIG)); }

let S = load();
let DATA = { symbols: {} }, RESULTS = [], MARKET = null;
let LOG = JSON.parse(localStorage.getItem(KEY + ':log') || '[]');
let ACTIVE = JSON.parse(localStorage.getItem(KEY + ':active') || 'null');
let filterGroup = 'all', openSym = null, unseen = 0;
const SEL = new Set(); // tickers elegidos para comparar

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.groups) return normalize(s);
  } catch {}
  return seed();
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(S));
  clearTimeout(save.h); save.h = setTimeout(pushConfig, 1200); // sincroniza con la base (Telegram y la IA leen de ahí)
}

// ───────────────────────── Servidor (contraseña + sync) ─────────────────────────
let PASS = localStorage.getItem(KEY + ':pass') || localStorage.getItem('radar-alertas-v1:pass') || '';
let SERVER = { ok: false };
export async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'x-app-password': PASS, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { askPass(true); throw new Error('Contraseña incorrecta'); }
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
let BASE_REV = null;
async function pushConfig() {
  if (!SERVER.ok) return;
  try {
    const r = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-app-password': PASS }, body: JSON.stringify({ config: S, baseRev: BASE_REV }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409 && j.config) { // otra pestaña/dispositivo guardó algo más nuevo
      S = normalize(j.config); BASE_REV = j.config.rev; localStorage.setItem(KEY, JSON.stringify(S)); evaluate(); render();
      return toast('Había una versión más nueva en la nube: la cargué (tu último cambio no se guardó)');
    }
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    BASE_REV = j.rev;
  } catch (e) { toast('No se pudo guardar en la nube: ' + e.message); }
}
function normalize(s) {
  for (const g of s.groups) { const d = defaultRules(); for (const k in d) if (!g.rules[k]) g.rules[k] = d[k]; }
  s.market = { ...defaultMarket(), ...(s.market || {}) }; s.telegram ||= { minScore: null }; s.alertMin ||= { at: 5, af: 8, negAlways: true };
  return s;
}
function askPass(wrong) {
  const m = $('#login'); m.classList.add('on'); $('#loginErr').textContent = wrong ? 'Contraseña incorrecta' : '';
  $('#loginBtn').onclick = async () => { PASS = $('#loginPass').value; localStorage.setItem(KEY + ':pass', PASS); m.classList.remove('on'); await connect(); };
  $('#loginSkip').onclick = () => { m.classList.remove('on'); toast('Modo local: sin IA, sin Telegram, config solo en este navegador'); };
}
async function connect() {
  if (!PASS) return askPass();
  try {
    const { config } = await api('/api/config');
    SERVER.ok = true;
    if (config?.groups) { S = normalize(config); BASE_REV = config.rev ?? null; localStorage.setItem(KEY, JSON.stringify(S)); }
    else await pushConfig(); // primera vez: sube la config local
    document.body.classList.add('online');
    evaluate(); render(); refresh();
  } catch (e) { if (!/Contraseña/.test(e.message)) toast('Servidor: ' + e.message); }
}
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
  });
  sortResults();
}
let sortBy = localStorage.getItem(KEY + ':sort') || 'total';
const scoreOf = (r) => (sortBy === 'total' ? r : r[sortBy]) || {};
function sortResults() {
  RESULTS.sort((a, b) => (scoreOf(b).score ?? -99) - (scoreOf(a).score ?? -99) || (scoreOf(b).pct ?? 0) - (scoreOf(a).pct ?? 0) || (b.score ?? -99) - (a.score ?? -99));
}

// Alertas: se disparan cuando una condición pasa de "no" a "sí" entre una actualización y otra
function detectAlerts() {
  const now = {}; const fresh = [];
  for (const m of MARKET?.rules || []) if (m.met) now['MKT:' + m.id] = { sym: 'Mercado', label: m.label, pol: m.pol, val: m.val };
  for (const r of RESULTS) for (const x of r.rules || []) if (x.met && passesMin(r, x, S.alertMin)) now[r.ticker.symbol + ':' + x.id] = { sym: r.ticker.symbol, label: x.label, pol: x.pol, val: x.val, score: r.score };
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
  renderMarket(); renderRanking(); renderGroups(); renderAlerts(); renderSettings(); renderIA(); renderTesis();
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
  const maxT = Math.max(1, ...RESULTS.map((r) => r.tec?.posMax || 0)), maxF = Math.max(1, ...RESULTS.map((r) => r.fun?.posMax || 0));
  const sortBtn = (k, l) => `<button class="sm ${sortBy === k ? 'primary' : ''}" data-sort="${k}">${l}</button>`;
  el.innerHTML = `
    <div class="row spread">
      <div class="chips">
        <span class="chip f ${filterGroup === 'all' ? 'on' : ''}" data-g="all">Todos (${S.tickers.length})</span>
        ${S.groups.map((g) => `<span class="chip f ${filterGroup === g.id ? 'on' : ''}" data-g="${g.id}" style="border-left:3px solid ${g.color}">${esc(g.name)} (${S.tickers.filter((t) => t.group === g.id).length})</span>`).join('')}
      </div>
    </div>
    <div class="row spread" style="margin-top:10px">
      <div class="row"><span class="muted">Rankear por</span>${sortBtn('tec', 'Técnico (AT)')}${sortBtn('fun', 'Fundamental (AF)')}${sortBtn('total', 'Total')}
        <button class="sm ${SEL.size >= 2 ? 'primary' : ''}" id="cmpBtn" ${SEL.size >= 2 ? '' : 'disabled'}>Comparar ${SEL.size ? `(${SEL.size})` : ''}</button>${SEL.size ? '<button class="sm ghost" id="cmpClr">Limpiar selección</button>' : ''}</div>
      <span class="muted">Score = peso de positivas cumplidas − peso de negativas activas · AF incluye tus objetivos</span>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th title="Elegí 2 o más para comparar">⇄</th><th>#</th><th>Ticker</th><th class="hide-m">Grupo</th><th style="text-align:right">Precio</th>
        <th class="${sortBy === 'tec' ? 'sorted' : ''}">AT</th><th class="${sortBy === 'fun' ? 'sorted' : ''}">AF</th><th class="${sortBy === 'total' ? 'sorted' : ''}" style="text-align:right">Total</th>
        <th>Señales activas</th><th style="text-align:right">RSI</th><th style="text-align:right">vs EMA200</th><th style="text-align:right">A venta</th></tr></thead>
      <tbody>${rows.map((r, i) => rowHtml(r, i, maxT, maxF)).join('') || '<tr><td colspan="11" class="muted">Sin tickers en este grupo</td></tr>'}</tbody>
    </table></div>`;
  el.querySelectorAll('[data-g]').forEach((c) => (c.onclick = () => { filterGroup = c.dataset.g; renderRanking(); }));
  el.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => { sortBy = b.dataset.sort; localStorage.setItem(KEY + ':sort', sortBy); sortResults(); renderRanking(); }));
  el.querySelectorAll('tbody tr[data-s]').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('.selc')) return; openDrawer(tr.dataset.s); }));
  el.querySelectorAll('.selc input').forEach((c) => (c.onchange = () => { c.checked ? SEL.add(c.dataset.sel) : SEL.delete(c.dataset.sel); renderRanking(); }));
  const cb = $('#cmpBtn', el); if (cb) cb.onclick = () => openCompare();
  const cc = $('#cmpClr', el); if (cc) cc.onclick = () => { SEL.clear(); renderRanking(); };
}

function scoreCell(c, max) {
  if (!c) return '<td>—</td>';
  return `<td><div class="score"><b class="${c.score > 0 ? 'pos' : c.score < 0 ? 'neg' : ''}">${c.score}</b>
    <div class="bar"><i style="width:${(c.pos / max) * 100}%"></i><u style="width:${Math.min(100, (c.neg / max) * 100)}%"></u></div>
    <span class="muted mono">${c.metPos}/${c.totPos}</span></div></td>`;
}

function rowHtml(r, i, maxT, maxF) {
  const s = r.ticker.symbol;
  const selc = `<td class="selc"><input type="checkbox" data-sel="${s}" ${SEL.has(s) ? 'checked' : ''}></td>`;
  if (r.error) return `<tr data-s="${s}">${selc}<td class="rank">${i + 1}</td><td class="sym">${s}</td><td colspan="9" class="muted">${esc(r.error)}</td></tr>`;
  const met = r.rules.filter((x) => x.met).sort((a, b) => b.pol - a.pol || b.w - a.w);
  const chips = (arr) => arr.map((x) => `<span class="chip ${x.pol > 0 ? 'p' : 'n'}">${esc(x.label)}</span>`).join('');
  const at = met.filter((x) => x.cat === 'tec'), af = met.filter((x) => x.cat !== 'tec');
  const closest = r.targets.filter((x) => x.dVenta != null).sort((a, b) => a.dVenta - b.dVenta)[0];
  const name = r.f?.name || DATA.symbols[s]?.prices?.name || '';
  return `<tr data-s="${s}">${selc}
    <td class="rank">${i + 1}</td>
    <td class="sym">${s}<small>${esc(name)}</small></td>
    <td class="hide-m"><span class="gtag" style="border-left-color:${r.group.color}">${esc(r.group.name)}</span></td>
    <td class="num">${fmt(r.t.price, 2)}</td>
    ${scoreCell(r.tec, maxT)}${scoreCell(r.fun, maxF)}
    <td class="num"><b class="${r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : ''}">${r.score}</b></td>
    <td><div class="sig">${at.length ? `<div class="chips"><span class="tag">AT</span>${chips(at)}</div>` : ''}${af.length ? `<div class="chips"><span class="tag">AF</span>${chips(af)}</div>` : ''}${met.length ? '' : '<span class="muted">—</span>'}</div></td>
    <td class="num ${r.t.rsiNow > 70 ? 'neg' : r.t.rsiNow < 35 ? 'pos' : ''}">${fmt(r.t.rsiNow, 0)}</td>
    <td class="num">${sgn(r.t.d200)}</td>
    <td class="num ${closest?.hit ? 'neg' : ''}">${closest ? (closest.hit ? 'LLEGÓ' : sgn(closest.dVenta)) + `<br><span class="muted">${closest.label}</span>` : '—'}</td>
  </tr>`;
}

// ── Editor de reglas reutilizable (grupo u override de ticker)
function rulesEditor(rules, { overrides, onChange, results, exclude = [] } = {}) {
  const cats = [['tec', 'Técnicas'], ['fun', 'Fundamentals'], ['obj', 'Objetivos propios']];
  const wrap = document.createElement('div'); wrap.className = 'rules';
  for (const [cat, title] of cats) {
    const h = document.createElement('h4'); h.textContent = title; wrap.appendChild(h);
    // las activas a la vista; las apagadas, plegadas en "métricas disponibles"
    const more = document.createElement('details'); more.className = 'collapse more';
    let nOff = 0;
    for (const pol of [1, -1]) for (const [id, def] of Object.entries(RULES).filter(([rid, d]) => d.cat === cat && d.pol === pol && !exclude.includes(rid))) {
      const base = rules[id] || { on: false, w: def.w, p: { ...def.p } };
      const ov = overrides?.[id] || {};
      const on = ov.on ?? base.on, w = ov.w ?? base.w, p = { ...def.p, ...base.p, ...(ov.p || {}) };
      const res = results?.find((x) => x.id === id);
      const row = document.createElement('div'); row.className = 'rule' + (on ? '' : ' off');
      const status = res ? (res.met == null ? '<span class="st nd">n/d</span>' : res.met ? `<span class="st ${def.pol > 0 ? 'y' : 'yn'}">SÍ</span>` : '<span class="st no">no</span>') + ` <span class="muted mono">${esc(res.val)}</span>` : '';
      row.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''} data-k="on">
        <div class="lbl"><span class="pol ${def.pol > 0 ? 'p' : 'n'}">${def.pol > 0 ? '+' : '−'}</span><span>${def.label}</span>${def.hint ? `<span class="muted">· ${def.hint}</span>` : ''} ${status}</div>
        <div class="params">${Object.keys(def.p).map((k) => `<label>${k}<input type="number" step="any" value="${p[k]}" data-p="${k}"></label>`).join('')}</div>
        <div class="w params"><label>peso<input type="number" step="1" value="${w}" data-k="w"></label>${overrides ? '' : `<label class="tgl" title="Avisar por Telegram cuando se active">📲<input type="checkbox" data-k="tg" ${(base.tg ?? !!def.tg) ? 'checked' : ''}></label>`}</div>`;
      row.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
        const target = overrides ? (overrides[id] ||= {}) : (rules[id] ||= { on: false, w: def.w, p: { ...def.p } });
        if (inp.dataset.k === 'tg') { target.tg = inp.checked; onChange?.(); return; }
        if (inp.dataset.k === 'on') target.on = inp.checked;
        else if (inp.dataset.k === 'w') target.w = +inp.value;
        else { target.p = { ...(target.p || {}), [inp.dataset.p]: +inp.value }; }
        row.classList.toggle('off', !(overrides ? (overrides[id].on ?? base.on) : rules[id].on));
        onChange?.();
      }));
      if (on) wrap.appendChild(row); else { more.appendChild(row); nOff++; }
    }
    if (nOff) { more.insertAdjacentHTML('afterbegin', `<summary>+ ${nOff} métrica(s) disponibles para activar</summary>`); wrap.appendChild(more); }
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
      <div class="row" style="margin-top:12px"><label class="muted">Tipo de empresa
        <select data-prof><option value="">Personalizado</option>${Object.entries(PROFILES).map(([k, p]) => `<option value="${k}" ${g.profile === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
        ${g.profile && PROFILES[g.profile] ? `<span class="muted">${PROFILES[g.profile].desc}</span>` : ''}</div>
      <div class="keyed" data-keyed></div>
      <div class="chips" style="margin-top:12px">${tks.map((t) => `<span class="chip">${t.symbol} <a data-rm="${t.symbol}" style="cursor:pointer;color:var(--mut)">✕</a></span>`).join('') || '<span class="muted">Sin acciones todavía</span>'}</div>
      <div class="add"><input placeholder="Agregar tickers: NVDA, AVGO, TSM" data-add><button class="sm primary" data-a="add">Agregar</button></div>`;
    card.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('change', () => {
      g[inp.dataset.f] = inp.dataset.f === 'benchmark' ? inp.value.trim().toUpperCase() : inp.value;
      save(); if (inp.dataset.f === 'benchmark') refresh(); else { evaluate(); render(); }
    }));
    $('[data-prof]', card).onchange = (e) => {
      const k = e.target.value; g.profile = k || null;
      if (k) { applyProfile(g.rules, k); toast(`${g.name}: perfil "${PROFILES[k].label}" aplicado`); }
      save(); evaluate(); render();
    };
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
    // Métricas propias del grupo: editor compacto
    const keyed = $('[data-keyed]', card);
    const keys = keyRules(g);
    const avail = Object.entries(RULES).filter(([id, d]) => d.cat === 'fun' && !COMMON.includes(id) && !g.rules[id]?.on);
    keyed.innerHTML = `<h4>Métricas del grupo</h4>
      ${keys.map(([id, r]) => `<div class="krow"><span class="pol ${RULES[id].pol > 0 ? 'p' : 'n'}">${RULES[id].pol > 0 ? '+' : '−'}</span>
        <span class="kl">${RULES[id].label.replace(/ [≤≥]$/, '')}</span>
        <span class="kp">${Object.keys(RULES[id].p).map((k) => `<label>${k === 'max' ? (RULES[id].label.includes('≥') ? '≥' : RULES[id].pol < 0 ? '>' : '≤') : k === 'min' ? '≥' : k}<input type="number" step="any" value="${r.p?.[k] ?? RULES[id].p[k]}" data-kp="${id}:${k}"></label>`).join(' ')}</span>
        <label class="muted">peso<input type="number" value="${r.w}" data-kw="${id}"></label>
        <button class="sm ghost" data-koff="${id}" title="Quitar">✕</button></div>`).join('') || '<div class="muted">Sin métricas propias. Elegí un tipo de empresa o agregá una.</div>'}
      ${avail.length ? `<div class="row" style="margin-top:6px"><select data-kadd><option value="">+ Agregar métrica…</option>${avail.map(([id, d]) => `<option value="${id}">${d.pol < 0 ? '(−) ' : ''}${d.label}</option>`).join('')}</select></div>` : ''}`;
    const touched = () => { g.profile = g.profile ? g.profile : null; save(); evaluate(); renderRanking(); };
    keyed.querySelectorAll('[data-kp]').forEach((i) => (i.onchange = () => { const [id, k] = i.dataset.kp.split(':'); g.rules[id].p = { ...g.rules[id].p, [k]: +i.value }; touched(); }));
    keyed.querySelectorAll('[data-kw]').forEach((i) => (i.onchange = () => { g.rules[i.dataset.kw].w = +i.value; touched(); }));
    keyed.querySelectorAll('[data-koff]').forEach((b) => (b.onclick = () => { g.rules[b.dataset.koff].on = false; save(); evaluate(); render(); }));
    const ka = $('[data-kadd]', keyed);
    if (ka) ka.onchange = () => { const id = ka.value; if (!id) return; const d = RULES[id]; g.rules[id] = { ...(g.rules[id] || { w: d.w, p: { ...d.p }, tg: !!d.tg }), on: true }; save(); evaluate(); render(); };

    const det = document.createElement('details'); det.className = 'collapse';
    det.innerHTML = `<summary>Técnicas y señales comunes</summary>`;
    det.appendChild(rulesEditor(g.rules, { exclude: Object.keys(RULES).filter((id) => RULES[id].cat === 'fun' && !COMMON.includes(id)), onChange: () => { save(); evaluate(); renderRanking(); } }));
    card.appendChild(det); grid.appendChild(card);
  }
}

function podium() {
  const ok = RESULTS.filter((r) => !r.error);
  if (!ok.length) return '';
  const col = (title, k) => `<div class="card pod"><h3>${title}</h3>${[...ok].sort((a, b) => b[k].score - a[k].score || b[k].pct - a[k].pct).slice(0, 3).map((r, i) => `
    <div class="podr" data-s="${r.ticker.symbol}"><span class="medal">${['🥇', '🥈', '🥉'][i]}</span><b>${r.ticker.symbol}</b>
      <span class="gtag" style="border-left-color:${r.group.color}">${esc(r.group.name)}</span><span class="pos mono">${r[k].score}</span><span class="muted mono">${r[k].metPos}/${r[k].totPos}</span></div>`).join('')}</div>`;
  return `<div class="grid podium">${col('Top 3 técnico (AT)', 'tec')}${col('Top 3 fundamental (AF)', 'fun')}</div>`;
}

function renderAlerts() {
  const el = $('#tab-alertas');
  el.innerHTML = `${podium()}<div class="row spread" style="margin-top:14px"><span class="muted">Se registra cada condición que pasa de "no" a "sí" entre actualizaciones. Con la pestaña abierta se actualiza cada ${S.refreshMin} min.</span><button class="sm" id="clr">Limpiar</button></div>
  <div class="feed card" style="margin-top:12px">${LOG.map((a) => `<div class="it">
      <span class="chip ${a.pol > 0 ? 'p' : 'n'}">${a.pol > 0 ? '▲' : '▼'} ${esc(a.sym)}</span>
      <div>${esc(a.label)} <span class="muted mono">${esc(a.val)}</span>${a.score != null ? ` <span class="muted">· score ${a.score}</span>` : ''}</div>
      <span class="muted">${new Date(a.t).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`).join('') || '<div class="muted">Sin alertas todavía.</div>'}</div>`;
  $('#clr', el).onclick = () => { LOG = []; localStorage.setItem(KEY + ':log', '[]'); renderAlerts(); };
  el.querySelectorAll('.podr').forEach((d) => (d.onclick = () => openDrawer(d.dataset.s)));
  if (SERVER.ok) api('/api/alerts').then(({ alerts }) => {
    if (!alerts?.length) return;
    const box = document.createElement('div');
    const anchor = el.querySelector('.podium');
    box.innerHTML = `<h4 style="margin:18px 0 6px">Detectadas por el servidor (las que van a Telegram)</h4><div class="feed card">${alerts.map((a) => `<div class="it">
      <span class="chip ${a.pol > 0 ? 'p' : 'n'}">${a.pol > 0 ? '▲' : '▼'} ${esc(a.sym)}</span>
      <div>${esc(a.label)} <span class="muted mono">${esc(a.val)}</span></div>
      <span class="muted">${new Date(a.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')}</div>`;
    anchor ? anchor.after(box) : el.prepend(box);
  }).catch(() => {});
}

function renderSettings() {
  const el = $('#tab-ajustes');
  el.innerHTML = `<div class="grid">
    <div class="card"><h3>Alertas generales de mercado</h3><div class="rules" id="mk"></div></div>
    <div class="card"><h3>Avisos (Telegram y mail)</h3><div id="tgBox" class="muted" style="margin-top:8px">${SERVER.ok ? 'Revisando…' : 'Iniciá sesión para configurarlo.'}</div></div>
    <div class="card"><h3>Puntaje mínimo para alertar</h3>
      <p class="muted">Una señal positiva de un ticker solo genera alerta (en la página, mail y Telegram) si su score de esa categoría supera el mínimo. Así te llegan solo las que valen la pena.</p>
      <div class="row"><label>Técnicas: AT ≥ <input type="number" step="0.5" id="amAT" value="${S.alertMin.at ?? ''}"></label>
        <label>Fundamentales: AF ≥ <input type="number" step="0.5" id="amAF" value="${S.alertMin.af ?? ''}"></label>
        <label><input type="checkbox" id="amNeg" ${S.alertMin.negAlways !== false ? 'checked' : ''}> Las negativas (venta, recortes, pierde EMA200…) avisan siempre</label></div></div>
    <div class="card"><h3>Actualización</h3><div class="row" style="margin-top:10px"><label>Refrescar cada <input type="number" id="rf" value="${S.refreshMin}"> minutos (con la pestaña abierta)</label></div></div>
    <div class="card"><h3>Backup</h3><p class="muted">Con sesión iniciada la configuración se guarda en la nube y se sincroniza entre dispositivos. El JSON sirve de backup.</p>
      <div class="row"><button id="exp">Exportar JSON</button><button id="imp">Importar JSON</button><button class="danger" id="rst">Restaurar ejemplo</button></div>
      <textarea id="io" placeholder="Pegá acá un JSON exportado y tocá Importar" style="margin-top:10px"></textarea></div></div>`;
  const mk = $('#mk', el);
  for (const [id, def] of Object.entries(MARKET_RULES)) {
    const c = S.market[id] ||= { on: true, p: { ...def.p } };
    const res = MARKET?.rules.find((r) => r.id === id);
    const row = document.createElement('div'); row.className = 'rule' + (c.on ? '' : ' off');
    row.innerHTML = `<input type="checkbox" ${c.on ? 'checked' : ''}><div class="lbl"><span class="pol ${def.pol > 0 ? 'p' : 'n'}">${def.pol > 0 ? '+' : '−'}</span>${def.label}
      ${res ? (res.met ? `<span class="st ${def.pol > 0 ? 'y' : 'yn'}">SÍ</span>` : '<span class="st no">no</span>') + ` <span class="muted mono">${esc(res.val)}</span>` : ''}</div>
      <div class="params">${Object.keys(def.p).map((k) => `<label>${k}<input type="number" step="any" data-p="${k}" value="${c.p?.[k] ?? def.p[k]}"></label>`).join('')}</div>
      <div class="w params"><label class="tgl" title="Avisar por Telegram">📲<input type="checkbox" data-tg ${c.tg !== false ? 'checked' : ''}></label></div>`;
    row.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
      if (inp.hasAttribute('data-tg')) c.tg = inp.checked;
      else if (inp.type === 'checkbox') c.on = inp.checked; else c.p = { ...c.p, [inp.dataset.p]: +inp.value };
      save(); evaluate(); renderMarket(); renderSettings();
    }));
    mk.appendChild(row);
  }
  if (SERVER.ok) loadTg();
  const am = () => { S.alertMin = { at: $('#amAT', el).value === '' ? null : +$('#amAT', el).value, af: $('#amAF', el).value === '' ? null : +$('#amAF', el).value, negAlways: $('#amNeg', el).checked }; save(); toast('Puntaje mínimo guardado'); };
  ['#amAT', '#amAF', '#amNeg'].forEach((q) => ($(q, el).onchange = am));
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
  const keyIds = keyRules(r.group).map(([id]) => id);
  const keyRows = keyIds.map((id) => r.rules.find((x) => x.id === id)).filter(Boolean);
  const atMet = r.rules.filter((x) => x.cat === 'tec' && x.met), comMet = r.rules.filter((x) => x.cat !== 'tec' && x.met && !keyIds.includes(x.id));
  const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const prof = PROFILES[r.group.profile];
  el.innerHTML = `
    <div class="dhead"><div><h2>${sym} <span class="mono" style="font-size:16px">${fmt(r.t.price, 2)}</span></h2>
      <div class="muted">${esc(f.name || DATA.symbols[sym]?.prices?.name || '')} · <span class="gtag" style="border-left-color:${r.group.color}">${esc(r.group.name)}</span> ${r.group.benchmark ? `· vs ${r.group.benchmark}` : ''}</div></div>
      <button class="ghost" id="x">✕</button></div>
    <div class="kpis">
      <div class="kpi"><div class="k">Total</div><div class="v ${cls(r.score)}">${r.score}</div></div>
      <div class="kpi"><div class="k">AT</div><div class="v ${cls(r.tec.score)}">${r.tec.score} <span class="muted">${r.tec.metPos}/${r.tec.totPos}</span></div></div>
      <div class="kpi"><div class="k">AF</div><div class="v ${cls(r.fun.score)}">${r.fun.score} <span class="muted">${r.fun.metPos}/${r.fun.totPos}</span></div></div>
      <div class="kpi"><div class="k">RSI · vs EMA200</div><div class="v">${fmt(r.t.rsiNow, 0)} · ${sgn(r.t.d200)}</div></div>
    </div>
    ${chartSvg(r.t)}
    <h4 style="margin:18px 0 4px">Métricas ${prof ? `de ${esc(prof.label.toLowerCase())}` : 'del grupo'}</h4>
    ${keyRows.length ? `<table class="tgt keym"><thead><tr><th>Métrica</th><th>Valor</th><th>Regla</th><th></th></tr></thead><tbody>${keyRows.map((x) => keyRow(x, sym, tk)).join('')}</tbody></table>
      <div class="muted" style="margin-top:4px">El valor viene de Yahoo; si no coincide con tu fuente, escribí el tuyo (queda ✎). Porcentajes como número.</div>`
      : '<div class="muted">Este grupo no tiene métricas propias. Elegí un tipo de empresa en Grupos.</div>'}
    <h4 style="margin:16px 0 6px">Señales</h4>
    ${atMet.length ? `<div class="chips"><span class="tag">AT</span>${atMet.map((x) => `<span class="chip ${x.pol > 0 ? 'p' : 'n'}">${esc(x.label)}</span>`).join('')}</div>` : ''}
    ${comMet.length ? `<div class="chips" style="margin-top:6px"><span class="tag">AF</span>${comMet.map((x) => `<span class="chip ${x.pol > 0 ? 'p' : 'n'}" title="${esc(x.val)}">${esc(x.label)}</span>`).join('')}</div>` : ''}
    ${!atMet.length && !comMet.length ? '<div class="muted">Sin señales activas.</div>' : ''}
    ${f.nextEarnings ? `<div class="muted" style="margin-top:6px">Próximo reporte: ${f.nextEarnings}</div>` : ''}
    <h4 style="margin:16px 0 6px">Objetivos</h4>
    ${r.targets.length ? `<table class="tgt tgts"><thead><tr><th>Métrica</th><th>Venta</th><th>Promedio</th><th style="text-align:right">Actual</th><th style="text-align:right">A venta</th><th></th></tr></thead>
    <tbody>${r.targets.map((x, i) => `<tr><td>${x.label}</td>
      <td><input type="number" step="any" value="${x.venta ?? ''}" data-i="${i}" data-k="venta"></td>
      <td><input type="number" step="any" value="${x.promedio ?? ''}" data-i="${i}" data-k="promedio"></td>
      <td class="num">${fmt(x.cur, 2)}</td><td class="num ${x.hit ? 'neg' : ''}">${x.hit ? 'LLEGÓ' : sgn(x.dVenta)}</td>
      <td><button class="sm ghost" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table>` : ''}
    <div class="add"><select id="tm">${Object.entries(TARGET_METRICS).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('')}</select><button class="sm" id="addT">+ Objetivo de venta / promedio</button></div>
    <details class="collapse"><summary>Más opciones</summary>
      ${fundTable(sym, r, tk, keyIds)}
      <h4 style="margin:18px 0 6px">Condiciones solo para ${sym} <span class="muted">(el resto hereda de ${esc(r.group.name)})</span></h4>
      <div id="rulesBox"></div>
      <div class="row" style="margin-top:8px"><button class="sm" id="resetOv">Volver a las del grupo</button>
        <label class="muted">Mover a <select id="mv">${S.groups.map((g) => `<option value="${g.id}" ${g.id === r.group.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label></div>
      ${f.earnings?.length ? `<h4 style="margin:18px 0 6px">EPS vs estimado</h4><div class="chips">${f.earnings.map((e) => `<span class="chip ${e.surprise >= 0 ? 'p' : 'n'}">${e.q?.slice(0, 7)} · ${e.actual} vs ${e.est} (${sgn(e.surprise)})</span>`).join('')}</div>` : ''}
      ${f.insiderBuys?.length ? `<h4 style="margin:18px 0 6px">Compras de insiders (180d)</h4>${f.insiderBuys.map((b) => `<div class="muted">${b.date} · ${esc(b.who)} (${esc(b.role)}) · ${b.shares?.toLocaleString('es-AR')} acc.</div>`).join('')}` : ''}
    </details>`;
  $('#x', el).onclick = closeDrawer;
  el.querySelectorAll('[data-fo]').forEach((inp) => inp.addEventListener('change', () => {
    tk.fundOverrides ||= {};
    const v = inp.value.trim().replace(',', '.');
    const auto = DATA.symbols[sym]?.fund?.[inp.dataset.fo];
    if (v === '' || (auto != null && Math.abs(+v - auto) < 1e-9)) delete tk.fundOverrides[inp.dataset.fo]; else tk.fundOverrides[inp.dataset.fo] = +v;
    save(); evaluate(); render(); toast(tk.fundOverrides[inp.dataset.fo] == null ? 'Vuelve al dato automático' : 'Valor manual guardado');
  }));
  el.querySelectorAll('[data-foclr]').forEach((b) => (b.onclick = () => { delete tk.fundOverrides[b.dataset.foclr]; save(); evaluate(); render(); }));
  el.querySelectorAll('.tgts input').forEach((inp) => inp.addEventListener('change', () => {
    const v = inp.value === '' ? null : +inp.value; tk.targets[+inp.dataset.i][inp.dataset.k] = v; save(); evaluate(); render();
  }));
  el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { tk.targets.splice(+b.dataset.del, 1); save(); evaluate(); render(); }));
  $('#addT', el).onclick = () => { tk.targets.push({ metric: $('#tm', el).value, venta: null, promedio: null }); save(); evaluate(); render(); };
  tk.overrides ||= {};
  $('#rulesBox', el).appendChild(rulesEditor(r.group.rules, { overrides: tk.overrides, results: r.rules, onChange: () => { save(); evaluate(); renderRanking(); } }));
  $('#resetOv', el).onclick = () => { tk.overrides = {}; save(); evaluate(); render(); };
  $('#mv', el).onchange = (e) => { tk.group = e.target.value; save(); refresh(); };
}

// Métricas propias del grupo = fundamentales activas que no son de las "comunes"
function keyRules(g) {
  return Object.entries(g.rules || {}).filter(([id, r]) => r.on && RULES[id] && RULES[id].cat === 'fun' && !COMMON.includes(id))
    .sort(([a], [b]) => RULES[b].pol - RULES[a].pol || (g.rules[b].w ?? 0) - (g.rules[a].w ?? 0));
}
function ruleText(id, p) {
  const d = RULES[id]; const u = /yield|payout|efficiency|margin|growth|roe|drawdown|div|rule40|rev|eps/.test(id) && id !== 'rule40' ? '%' : '';
  if (p.min != null && p.max != null) return `${p.min}–${p.max}${u}`;
  if (id === 'div_vs_avg') return 'yield actual ≥ este';
  if (id === 'ev_arr') return `EV/ARR ≤ ${p.max}x`;
  if (id === 'ev_gw') return `≤ US$${p.max}bn/GW`;
  if (id === 'rev_decline') return `alerta si trim. < año − ${p.margen}pp`;
  const op = /[≤≥]/.exec(d.label)?.[0] || (p.max != null ? (d.pol < 0 ? '>' : '≤') : '≥');
  const v = p.max ?? p.min ?? p.pct;
  return v != null ? `${op} ${v}${u}` : '';
}
function keyRow(x, sym, tk) {
  const field = RULE_FIELD[x.id];
  const g = S.groups.find((gg) => gg.id === tk.group) || S.groups[0];
  const p = { ...RULES[x.id].p, ...(g.rules[x.id]?.p || {}), ...(tk.overrides?.[x.id]?.p || {}) };
  const auto = DATA.symbols[sym]?.fund?.[field], man = tk.fundOverrides?.[field];
  const cur = man ?? auto;
  const st = x.met == null ? '<span class="st nd">s/d</span>' : x.met ? `<span class="st ${x.pol > 0 ? 'y' : 'yn'}">${x.pol > 0 ? '✔' : '⚠'}</span>` : `<span class="st no">${x.pol > 0 ? '✘' : 'ok'}</span>`;
  const inp = (fld, lbl) => { const a = DATA.symbols[sym]?.fund?.[fld], m = tk.fundOverrides?.[fld], c = m ?? a;
    return `<label class="mini">${lbl}<input type="text" inputmode="decimal" data-fo="${fld}" value="${c == null ? '' : +(+c).toFixed(2)}" placeholder="cargar"${m != null ? ' class="man"' : ''}></label>`; };
  if (x.id === 'ev_arr' || x.id === 'ev_gw') {
    const k = x.id === 'ev_arr' ? 'arrProj' : 'gwTotal';
    const src = tk.kpiSrc?.[k];
    return `<tr><td>${esc(x.label.replace(/ [≤≥]$/, ''))}${src ? `<div class="muted" style="font-size:11px">${esc(src)}</div>` : ''}</td>
      <td>${inp(k, x.id === 'ev_arr' ? 'ARR US$bn' : 'GW')} <span class="mono muted">→ ${esc(x.val)}</span></td><td class="muted">${esc(ruleText(x.id, p))}</td><td>${st}</td></tr>`;
  }
  if (x.id === 'rev_decline') {
    return `<tr><td>${esc(x.label)}</td><td>${inp('revGrowth', 'trim.')} ${inp('revGrowthFY', 'año')}</td><td class="muted">${esc(ruleText(x.id, p))}</td><td>${st}</td></tr>`;
  }
  const label = x.id === 'div_vs_avg' ? 'Yield promedio 5 años' : x.label.replace(/ [≤≥]$/, '');
  return `<tr${man != null ? ' class="manual"' : ''}><td>${esc(label)}${man != null ? ' <span title="Valor tuyo">✎</span>' : ''}</td>
    <td>${field ? `<input type="text" inputmode="decimal" data-fo="${field}" value="${cur == null ? '' : +(+cur).toFixed(2)}" placeholder="cargar">` : `<span class="mono">${esc(x.val)}</span>`}${man != null ? `<button class="sm ghost" data-foclr="${field}" title="Volver al dato de Yahoo${auto != null ? ' (' + (+auto).toFixed(2) + ')' : ''}">↺</button>` : ''}</td>
    <td class="muted">${esc(ruleText(x.id, p))}</td><td>${st}</td></tr>`;
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
render(); refresh(); schedule(); connect();


// ───────────────────────── Telegram (Ajustes) ─────────────────────────
async function loadTg() {
  const box = $('#tgBox'); if (!box) return;
  let st; try { st = await api('/api/setup'); } catch (e) { box.textContent = e.message; return; }
  const ok = (b) => (b ? '<span class="pos">✔</span>' : '<span class="neg">✘</span>');
  box.innerHTML = `
    <div>${ok(st.telegramToken)} Token del bot ${st.bot ? `(<b>@${esc(st.bot)}</b>)` : ''}</div>
    <div>${ok(st.webhook)} Webhook conectado ${st.webhookError ? `<span class="neg">· ${esc(st.webhookError)}</span>` : ''}</div>
    <div>${ok(st.chatVinculado)} Tu chat vinculado</div>
    <div>${ok(st.email)} Mail (RESEND_API_KEY + ALERT_EMAIL)</div>
    <div>${ok(st.anthropic)} IA ${st.aiProvider ? `(${st.aiProvider})` : '(cargá GEMINI_API_KEY, gratis en aistudio.google.com)'}</div>
    ${st.error ? `<div class="neg">${esc(st.error)}</div>` : ''}
    <div class="row" style="margin-top:10px"><button class="primary sm" id="tgConnect" ${st.telegramToken ? '' : 'disabled'}>Conectar bot</button>
      <button class="sm" id="tgScan">Escanear ahora</button>
      <label>Avisar si un score llega a <input type="number" id="tgMin" value="${S.telegram?.minScore ?? ''}" placeholder="—"></label></div>
    <ol style="margin:10px 0 0;padding-left:18px;line-height:1.7">
      ${st.telegramToken ? '' : '<li>En Telegram abrí <b>@BotFather</b> → <code>/newbot</code> → copiá el token. Cargalo en Vercel como <code>TELEGRAM_BOT_TOKEN</code> y redeployá.</li>'}
      ${st.webhook ? '' : '<li>Tocá <b>Conectar bot</b>.</li>'}
      ${st.chatVinculado ? '' : `<li>Abrí ${st.bot ? `<a href="https://t.me/${esc(st.bot)}" target="_blank" style="color:var(--acc2)">@${esc(st.bot)}</a>` : 'tu bot'} y mandá <code>/start TU_CONTRASEÑA</code>.</li>`}
      ${st.email ? '' : '<li>Mail: creá cuenta gratis en <b>resend.com</b> con tu mail → API Keys → cargá en Vercel <code>RESEND_API_KEY</code> y <code>ALERT_EMAIL</code> (ese mismo mail) y redeployá.</li>'}
      <li>En cada condición de los grupos, el 📲 define si avisa (Telegram y mail). Se escanea solo cada 30 min en horario de mercado.</li>
    </ol>`;
  $('#tgConnect', box).onclick = async () => { try { await api('/api/setup', { method: 'POST' }); toast('Bot conectado'); loadTg(); } catch (e) { toast(e.message); } };
  $('#tgScan', box).onclick = async () => { try { await pushConfig(); const r = await api('/api/scan', { method: 'POST' }); toast(r.first ? 'Estado inicial guardado' : `${r.fresh || 0} cambio(s), ${r.sent || 0} enviado(s)`); } catch (e) { toast(e.message); } };
  $('#tgMin', box).onchange = (e) => { S.telegram = { ...(S.telegram || {}), minScore: e.target.value === '' ? null : +e.target.value }; save(); };
}

// ───────────────────────── Markdown mínimo ─────────────────────────
function md(t) {
  const lines = esc(t).split('\n'); let html = '', inList = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/_\((.+?)\)_/g, '<em>($1)</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const h = l.match(/^#{1,4}\s+(.*)/); const li = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (h) html += `<p><b>${h[1]}</b></p>`; else if (l.trim()) html += `<p>${l}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

// ───────────────────────── Chat IA ─────────────────────────
let CHAT = null, PENDING = [], SENDING = false;
const SUGS = ['¿Qué acción del radar está mejor para comprar hoy según mi marco?', 'Revisá las negativas activas y decime qué vigilar', 'Compará NVDA vs AVGO con mis criterios'];

async function compress(file, max = 1568) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { media_type: 'image/jpeg', data: url.split(',')[1], url };
}

function renderIA() {
  const el = $('#tab-ia');
  if (!SERVER.ok) { el.innerHTML = '<div class="empty">La IA necesita que inicies sesión. <button class="primary sm" id="iaLogin">Entrar</button></div>'; $('#iaLogin', el).onclick = () => askPass(); return; }
  if (el.dataset.ready) return;
  el.dataset.ready = 1;
  el.innerHTML = `<div class="chat"><div class="msgs" id="msgs"></div>
    <div class="composer"><div class="thumbs" id="thumbs"></div>
      <div class="row"><button class="ghost" id="attach" title="Adjuntar screenshots">📎</button>
        <textarea id="prompt" placeholder="Preguntá, o pegá/adjuntá screenshots de métricas para que las guarde…" rows="1"></textarea>
        <button class="primary" id="sendBtn">Enviar</button></div>
      <input type="file" id="files" accept="image/*" multiple hidden></div></div>`;
  const ta = $('#prompt', el);
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  ta.addEventListener('paste', async (e) => { const fs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); await addFiles(fs); } });
  $('#attach', el).onclick = () => $('#files', el).click();
  $('#files', el).onchange = (e) => addFiles([...e.target.files]);
  $('#sendBtn', el).onclick = sendChat;
  const box = $('.chat', el);
  box.addEventListener('dragover', (e) => e.preventDefault());
  box.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); });
  loadChat();
}

async function addFiles(files) {
  for (const f of files.slice(0, 6 - PENDING.length)) PENDING.push(await compress(f));
  drawThumbs();
}
function drawThumbs() {
  const t = $('#thumbs'); t.innerHTML = PENDING.map((p, i) => `<div><img src="${p.url}"><a data-i="${i}">✕</a></div>`).join('');
  t.querySelectorAll('a').forEach((a) => (a.onclick = () => { PENDING.splice(+a.dataset.i, 1); drawThumbs(); }));
}

async function loadChat() {
  try { CHAT = (await api('/api/chat')).messages; } catch { CHAT = []; }
  drawMsgs();
}
function drawMsgs(extra = '') {
  const box = $('#msgs'); if (!box) return;
  box.innerHTML = (CHAT.length ? CHAT.map((m) => `<div class="msg ${m.role}">${m.imgs ? m.imgs.map((u) => `<img src="${u}">`).join('') : ''}${md(m.text)}${m.channel === 'tg' ? '<div class="src">vía Telegram</div>' : ''}</div>`).join('')
    : `<div class="muted" style="margin:auto;text-align:center;max-width:420px">Soy tu analista interno. Conozco tu radar, tus tesis y las métricas que me pases.<br><br><div class="sugs" style="justify-content:center">${SUGS.map((x) => `<span class="chip f" data-sug="${esc(x)}">${esc(x)}</span>`).join('')}</div></div>`) + extra;
  box.querySelectorAll('[data-sug]').forEach((c) => (c.onclick = () => { $('#prompt').value = c.dataset.sug; sendChat(); }));
  box.scrollTop = box.scrollHeight;
}

async function sendChat() {
  if (SENDING) return;
  const ta = $('#prompt'); const text = ta.value.trim();
  if (!text && !PENDING.length) return;
  const imgs = PENDING; PENDING = []; drawThumbs(); ta.value = ''; ta.style.height = 'auto';
  CHAT.push({ role: 'user', text: text || '(screenshots)', imgs: imgs.map((i) => i.url) });
  SENDING = true; drawMsgs('<div class="typing">Analizando…</div>');
  try {
    await pushConfig();
    const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ text, images: imgs.map(({ media_type, data }) => ({ media_type, data })) }) });
    CHAT.push({ role: 'assistant', text: r.text });
    if (r.tools?.some((t) => t === 'set_target' || t === 'add_tickers')) { const { config } = await api('/api/config'); if (config) { S = normalize(config); BASE_REV = config.rev ?? null; localStorage.setItem(KEY, JSON.stringify(S)); refresh(); } }
  } catch (e) { CHAT.push({ role: 'assistant', text: '⚠️ ' + e.message }); }
  SENDING = false; drawMsgs();
}

// ───────────────────────── Tesis ─────────────────────────
let THESES = null, PROFILE = null;
function renderTesis() {
  const el = $('#tab-tesis');
  if (!SERVER.ok) { el.innerHTML = '<div class="empty">Iniciá sesión para cargar tesis.</div>'; return; }
  if (THESES == null) { el.innerHTML = '<div class="muted">Cargando…</div>'; api('/api/thesis').then((r) => { THESES = r.theses; PROFILE = r.profile; renderTesis(); }).catch((e) => (el.innerHTML = `<div class="empty">${esc(e.message)}</div>`)); return; }
  el.innerHTML = `<div class="grid">
    <div class="card"><h3>Subir tesis</h3><p class="muted">PDF, Markdown o texto. La IA extrae ticker, criterios, umbrales, precio justo y reglas de venta, guarda los números clave y actualiza tu perfil de análisis.</p>
      <div class="drop" id="drop">Arrastrá archivos acá o tocá para elegir (.pdf, .md, .txt)</div>
      <input type="file" id="thFile" accept=".pdf,.md,.txt,.html,application/pdf,text/*" multiple hidden>
      <details class="collapse"><summary>…o pegar el texto</summary><textarea id="thText" placeholder="Pegá tu tesis completa"></textarea><button class="sm primary" id="thSend" style="margin-top:8px">Procesar texto</button></details>
      <div id="thStatus" class="muted" style="margin-top:8px"></div></div>
    <div class="card"><div class="row spread"><h3>Tu perfil de análisis</h3><span class="muted">${PROFILE?.basedOn ? `basado en ${PROFILE.basedOn} tesis · ${new Date(PROFILE.updated).toLocaleDateString('es-AR')}` : ''}</span></div>
      <div class="profile" style="margin-top:8px">${PROFILE?.text ? md(PROFILE.text) : '<span class="muted">Se genera solo cuando subas tu primera tesis. Es lo que la IA usa para pensar como vos.</span>'}</div>
      ${THESES.length ? `<button class="sm" id="pfRebuild" style="margin-top:10px">${PROFILE?.text ? 'Regenerar perfil' : 'Generar perfil ahora'}</button>` : ''}
      ${PROFILE?.text ? `<details class="collapse"><summary>Corregir el perfil</summary><textarea id="pfNotes" placeholder="Ej: no uso dividendos; para Fast Growers tolero PEG hasta 1.5; vendo si el FCF cae 2 trimestres seguidos">${esc(PROFILE.notes || '')}</textarea><button class="sm primary" id="pfSave" style="margin-top:8px">Guardar y regenerar</button></details>` : ''}</div>
    ${THESES.map((t) => `<div class="card thesis"><div class="row spread"><h3><span class="gtag">${esc(t.ticker || '—')}</span>${esc(t.title || '')}</h3>
      <div class="row"><span class="muted">${new Date(t.created_at).toLocaleDateString('es-AR')}</span><button class="sm danger" data-del="${t.id}">Eliminar</button></div></div>
      <p style="margin:10px 0 0">${esc(t.summary || '')}</p>
      ${t.criteria ? `<details class="collapse"><summary>Criterios extraídos</summary><div style="margin-top:6px">${Object.entries(t.criteria).map(([k, v]) => `<div style="margin:4px 0"><span class="muted">${esc(k.replace(/_/g, ' '))}:</span> ${esc(Array.isArray(v) ? v.join(' · ') : v)}</div>`).join('')}</div></details>` : ''}</div>`).join('')}
  </div>`;
  const drop = $('#drop', el), fi = $('#thFile', el);
  drop.onclick = () => fi.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); uploadTheses([...e.dataTransfer.files]); };
  fi.onchange = (e) => uploadTheses([...e.target.files]);
  $('#thSend', el).onclick = () => { const t = $('#thText', el).value.trim(); if (t) uploadTheses([{ name: 'texto pegado', text: t }]); };
  el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('¿Eliminar esta tesis? El perfil se regenera sin ella.')) return;
    b.disabled = true; const r = await api('/api/thesis?id=' + b.dataset.del, { method: 'DELETE' });
    PROFILE = r.profile; THESES = THESES.filter((x) => x.id !== +b.dataset.del); renderTesis();
  }));
  const rb = $('#pfRebuild', el);
  if (rb) rb.onclick = async () => { rb.disabled = true; rb.textContent = 'Generando… (30-60 s)'; try { PROFILE = (await api('/api/thesis', { method: 'POST', body: JSON.stringify({ action: 'rebuild_profile' }) })).profile; } catch (e) { toast(e.message); } renderTesis(); };
  const pf = $('#pfSave', el);
  if (pf) pf.onclick = async () => { pf.disabled = true; pf.textContent = 'Regenerando…'; try { PROFILE = (await api('/api/thesis', { method: 'POST', body: JSON.stringify({ action: 'profile_notes', notes: $('#pfNotes', el).value }) })).profile; } catch (e) { toast(e.message); } renderTesis(); };
}

const toB64 = (file) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(file); });

// Lee el PDF en el navegador: texto + páginas renderizadas como imagen (sirve para carruseles)
let pdfjs = null;
async function readPdf(file, maxPages = 12) {
  if (!pdfjs) {
    pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let text = ''; const images = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    text += `\n--- Página ${i} ---\n` + tc.items.map((x) => x.str).join(' ');
    if (i <= maxPages) {
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(2, 1100 / Math.max(vp0.width, vp0.height)) });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      images.push({ media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.72).split(',')[1] });
    }
  }
  const words = text.replace(/--- Página \d+ ---/g, '').trim().split(/\s+/).length;
  // si tiene mucho texto, no hace falta mandar todas las imágenes
  return { text, images: words > 1500 ? images.slice(0, 3) : images, pages: doc.numPages };
}

async function uploadTheses(files) {
  const st = $('#thStatus');
  let ok = 0;
  for (const f of files) {
    try {
      let body;
      if (f.text && !(f instanceof File)) body = { text: f.text, filename: f.name };
      else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        st.textContent = `Leyendo ${f.name}…`;
        const r = await readPdf(f);
        body = { text: r.text, images: r.images, filename: f.name };
      } else body = { text: await f.text(), filename: f.name };
      st.textContent = `Analizando ${f.name} con la IA… (30-60 s)`;
      const r = await api('/api/thesis', { method: 'POST', body: JSON.stringify(body) });
      THESES = [{ ...r.thesis, created_at: new Date().toISOString() }, ...THESES]; ok++;
      toast(`${r.thesis.ticker}: tesis cargada, ${r.metrics} métricas guardadas`);
      renderTesis();
    } catch (e) { toast(`${f.name}: ${e.message}`); st.textContent = `⚠️ ${f.name}: ${e.message}`; }
  }
  if (ok) {
    $('#thStatus').textContent = 'Actualizando tu perfil de análisis…';
    try { PROFILE = (await api('/api/thesis', { method: 'POST', body: JSON.stringify({ action: 'rebuild_profile' }) })).profile; } catch (e) { toast('Perfil: ' + e.message); }
    renderTesis();
  }
}


// ───────────────────────── Métricas fundamentales editables ─────────────────────────
// qué campo usa cada regla (para mostrar primero las relevantes del grupo)
const RULE_FIELD = { fpe: 'forwardPE', fpe_high: 'forwardPE', peg: 'peg', evebitda: 'evEbitda', de: 'debtEquity', div_range: 'divYield', div_vs_avg: 'divYield5y', payout_range: 'payout', payout_high: 'payout', efficiency: 'efficiency', roe: 'roe', pb: 'pb', op_margin: 'opMargin', gross_margin: 'grossMargin', rev_growth: 'revGrowth', rev_decline: 'revGrowthFY', fcf_yield: 'fcfYield', debt_ebitda: 'debtEbitda', ev_sales: 'evSales', rule40: 'rule40', ev_arr: 'arrProj', ev_gw: 'gwTotal', cash_debt: 'cashDebt', debt_mcap: 'debtMcap', current_ratio: 'currentRatio', dilution: 'sharesYoY', eps_rev_up: 'epsRev90', eps_rev_down: 'epsRev30', eps_gap: 'epsYoY', price_ahead: 'epsYoY' };

function fundTable(sym, r, tk, keyIds = []) {
  const auto = DATA.symbols[sym]?.fund || {};
  const man = tk.fundOverrides || {};
  const skip = new Set(keyIds.map((id) => RULE_FIELD[id]).filter(Boolean));
  const row = ([k, label, unit]) => {
    const a = auto[k], m = man[k];
    const fa = a == null ? '—' : (+a).toFixed(unit === '%' ? 1 : 2) + (unit === '%' ? '%' : unit);
    return `<tr${m != null ? ' class="manual"' : ''}><td>${label}${m != null ? ' ✎' : ''}</td><td class="num muted">${fa}</td>
      <td><input type="text" inputmode="decimal" data-fo="${k}" value="${m ?? ''}" placeholder="igual"></td>
      <td>${m != null ? `<button class="sm ghost" data-foclr="${k}">↺</button>` : ''}</td></tr>`;
  };
  return `<h4 style="margin:14px 0 6px">Otras métricas (no puntúan en este grupo)</h4>
    <table class="tgt fund"><thead><tr><th>Métrica</th><th style="text-align:right">Yahoo</th><th>Tu valor</th><th></th></tr></thead>
    <tbody>${FUND_FIELDS.filter(([k]) => !skip.has(k)).map(row).join('')}</tbody></table>`;
}


// ───────────────────────── Filtro de alertas por puntaje ─────────────────────────
function passesMin(r, x, m = {}) {
  if (x.pol < 0) return m.negAlways !== false || (r.score >= (m.at ?? -99));
  const min = x.cat === 'tec' ? m.at : m.af;
  return min == null || (x.cat === 'tec' ? r.tec.score : r.fun.score) >= min;
}

// ───────────────────────── Comparador ─────────────────────────
let CMP_METRICS = null;
const BASE_METRICS = [
  ['_at', 'Score AT', (r) => r.tec.score, 1], ['_af', 'Score AF', (r) => r.fun.score, 1], ['_tot', 'Score total', (r) => r.score, 1],
  ['_price', 'Precio', (r) => r.t.price, 0], ['_rsi', 'RSI', (r) => r.t.rsiNow, 0], ['_d200', 'vs EMA200 %', (r) => r.t.d200, 0],
  ['_dd', 'Drawdown 52s %', (r) => r.t.dd, 0], ['_yoy', 'Var. precio 12m %', (r) => r.t.priceYoY, 0],
];
// 1 = más alto mejor, -1 = más bajo mejor, 0 = sin color
const BETTER = { arrProj: 1, gwTotal: 1, cashDebt: 1, debtMcap: -1, currentRatio: 1, sharesYoY: -1, forwardPE: -1, trailingPE: -1, peg: -1, evEbitda: -1, evSales: -1, pb: -1, debtEbitda: -1, debtEquity: -1, efficiency: -1, divYield: 1, roe: 1, grossMargin: 1, opMargin: 1, revGrowth: 1, revGrowthFY: 1, epsYoY: 1, fcfYield: 1, rule40: 1, epsRev30: 1, epsRev90: 1 };

function openCompare() {
  const rs = [...SEL].map((s) => RESULTS.find((r) => r.ticker.symbol === s)).filter((r) => r && !r.error);
  if (rs.length < 2) return;
  if (!CMP_METRICS) {
    const keys = new Set(['_at', '_af', '_rsi', '_d200']);
    for (const r of rs) for (const [id] of keyRules(r.group)) if (RULE_FIELD[id]) keys.add(RULE_FIELD[id]);
    CMP_METRICS = [...keys];
  }
  const all = [...BASE_METRICS.map(([k, l]) => [k, l]), ...FUND_FIELDS.map(([k, l]) => [k, l])];
  const val = (r, k) => { const b = BASE_METRICS.find((m) => m[0] === k); return b ? b[2](r) : r.f?.[k]; };
  const rows = CMP_METRICS.map((k) => {
    const label = all.find((a) => a[0] === k)?.[1] || k;
    const vals = rs.map((r) => val(r, k));
    const dir = k.startsWith('_') ? (BASE_METRICS.find((m) => m[0] === k)[3]) : (BETTER[k] || 0);
    const nums = vals.filter((v) => v != null && isFinite(v) && !(dir === -1 && v <= 0));
    const best = dir && nums.length > 1 ? (dir > 0 ? Math.max(...nums) : Math.min(...nums)) : null;
    const unit = FUND_FIELDS.find((f) => f[0] === k)?.[2] || '';
    return `<tr><td>${esc(label)}</td>${vals.map((v) => `<td class="num ${best != null && v === best ? 'best' : ''}">${v == null || !isFinite(v) ? '—' : (+v).toFixed(2) + (unit === '%' ? '%' : unit === 'x' ? 'x' : '')}</td>`).join('')}</tr>`;
  }).join('');
  const m = $('#cmp');
  m.innerHTML = `<div class="modal-in cmp-in">
    <div class="row spread"><h3>Comparar</h3><button class="ghost" id="cmpX">✕</button></div>
    <div class="tablewrap"><table class="cmpt"><thead><tr><th>Métrica</th>${rs.map((r) => `<th style="text-align:right">${r.ticker.symbol}<br><span class="muted" style="font-weight:400;text-transform:none">${esc(r.group.name)}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted" style="margin:8px 0 4px">En verde, la mejor de cada fila. Elegí qué métricas ver:</p>
    <div class="chips">${all.map(([k, l]) => `<span class="chip f ${CMP_METRICS.includes(k) ? 'on' : ''}" data-cm="${k}">${esc(l)}</span>`).join('')}</div>
  </div>`;
  m.classList.add('on');
  $('#cmpX', m).onclick = () => m.classList.remove('on');
  m.onclick = (e) => { if (e.target === m) m.classList.remove('on'); };
  m.querySelectorAll('[data-cm]').forEach((c) => (c.onclick = () => { const k = c.dataset.cm; CMP_METRICS = CMP_METRICS.includes(k) ? CMP_METRICS.filter((x) => x !== k) : [...CMP_METRICS, k]; openCompare(); }));
}
