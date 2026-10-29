// Perfiles sectoriales: qué métricas fundamentales mira cada tipo de empresa.
// Las técnicas no se tocan. Las fundamentales que no están en el perfil (ni en COMMON) se apagan.
import { RULES } from './engine.js';

// Siempre activas: sorpresas de earnings, revisiones, insiders, precio vs EPS y tus objetivos
export const COMMON = ['upside', 'over_fair', 'beat', 'miss', 'eps_rev_down', 'insider', 'earnings_soon', 'eps_gap', 'price_ahead', 'drawdown', 'target_hit', 'below_avg'];

export const PROFILES = {
  defensiva: {
    label: 'Defensiva / dividendos', desc: 'Rol: renta y estabilidad. Busca yield alto y sostenible, y precio atrasado vs su yield histórico.',
    rules: { div_range: { w: 3, p: { min: 2, max: 7 } }, div_vs_avg: { w: 3, p: { margen: 0 } }, payout_range: { w: 2, p: { min: 60, max: 75 } }, payout_high: { w: 2, p: { max: 90 } }, fpe: { w: 2, p: { max: 22 } }, debt_ebitda: { w: 1, p: { max: 3 } }, rev_decline: { w: 1, p: { margen: 5 } }, drawdown: { w: 2, p: { min: 15 } } },
  },
  banco: {
    label: 'Banco / financiera', desc: 'Rol: valor cíclico. Eficiencia, rentabilidad sobre patrimonio y precio vs libros.',
    rules: { efficiency: { w: 3, p: { max: 60 } }, roe: { w: 2, p: { min: 12 } }, pb: { w: 2, p: { max: 2 } }, fpe: { w: 2, p: { max: 14 } }, div_vs_avg: { w: 1, p: { margen: 0 } }, fpe_high: { w: 1, p: { max: 22 } } },
  },
  pagos: {
    label: 'Redes de pago', desc: 'Rol: compounder de calidad. Márgenes altísimos, crecimiento estable y caja.',
    rules: { op_margin: { w: 2, p: { min: 40 } }, rev_growth: { w: 2, p: { min: 10 } }, fcf_yield: { w: 2, p: { min: 3 } }, peg: { w: 2, p: { max: 2 } }, fpe: { w: 2, p: { max: 28 } }, fpe_high: { w: 1, p: { max: 40 } }, rev_decline: { w: 2, p: { margen: 5 } } },
  },
  energia: {
    label: 'Energía / utilities', desc: 'Rol: demanda eléctrica de la IA. Apalancamiento controlado, EV/EBITDA y crecimiento.',
    rules: { debt_ebitda: { w: 2, p: { max: 3.5 } }, evebitda: { w: 2, p: { max: 15 } }, rev_growth: { w: 2, p: { min: 10 } }, fcf_yield: { w: 1, p: { min: 3 } }, peg: { w: 2, p: { max: 1.5 } }, fpe: { w: 1, p: { max: 25 } }, rev_decline: { w: 2, p: { margen: 5 } } },
  },
  plataforma: {
    label: 'Plataforma / contenido', desc: 'Rol: crecimiento rentable. Ventas creciendo, margen operativo en expansión y caja.',
    rules: { rev_growth: { w: 2, p: { min: 15 } }, op_margin: { w: 2, p: { min: 15 } }, fcf_yield: { w: 2, p: { min: 3 } }, peg: { w: 2, p: { max: 1.5 } }, fpe: { w: 1, p: { max: 30 } }, fpe_high: { w: 1, p: { max: 60 } }, rev_decline: { w: 2, p: { margen: 5 } } },
  },
  discrecional: {
    label: 'Consumo discrecional / retail', desc: 'Rol: consumo cíclico y retail. Crecimiento de ventas, márgenes, caja y valuación vs EBITDA.',
    rules: { rev_growth: { w: 2, p: { min: 5 } }, op_margin: { w: 2, p: { min: 8 } }, fcf_yield: { w: 2, p: { min: 4 } }, fpe: { w: 2, p: { max: 25 } }, peg: { w: 2, p: { max: 2 } }, evebitda: { w: 1, p: { max: 14 } }, rev_decline: { w: 2, p: { margen: 5 } } },
  },
  neocloud: {
    label: 'Neocloud / infra IA', desc: 'Rol: apuesta de alto crecimiento con mucha deuda. Importa crecer rápido sin quedarse sin caja ni diluir de más; el P/E no aplica.',
    rules: { ev_arr: { w: 3, p: { max: 8 } }, ev_gw: { w: 2, p: { max: 15 } }, rev_growth: { w: 2, p: { min: 50 } }, ev_sales: { w: 1, p: { max: 15 } }, gross_margin: { w: 1, p: { min: 40 } }, cash_debt: { w: 2, p: { min: 30 } }, current_ratio: { w: 1, p: { min: 1 } }, debt_mcap: { w: 1, p: { max: 60 } }, dilution: { w: 2, p: { max: 10 } } },
  },
  ciber: {
    label: 'Ciberseguridad', desc: 'Rol: software de crecimiento recurrente. Regla del 40, EV/Ventas, margen bruto y caja.',
    rules: { rule40: { w: 3, p: { min: 40 } }, ev_sales: { w: 2, p: { max: 15 } }, rev_growth: { w: 2, p: { min: 15 } }, gross_margin: { w: 1, p: { min: 70 } }, fcf_yield: { w: 2, p: { min: 2.5 } }, dilution: { w: 1, p: { max: 5 } }, rev_decline: { w: 2, p: { margen: 5 } } },
  },
  defensa: {
    label: 'Defensa', desc: 'Rol: cíclica estable con contratos de gobierno. Caja, márgenes, valuación y dividendo vs su historia.',
    rules: { fcf_yield: { w: 2, p: { min: 4 } }, evebitda: { w: 2, p: { max: 16 } }, op_margin: { w: 1, p: { min: 10 } }, fpe: { w: 2, p: { max: 22 } }, div_vs_avg: { w: 2, p: { margen: 0 } }, debt_ebitda: { w: 1, p: { max: 3.5 } }, rev_decline: { w: 1, p: { margen: 5 } } },
  },
  petroleo: {
    label: 'Petróleo', desc: 'Rol: renta y cobertura de inflación. FCF, dividendo, poca deuda y múltiplo bajo (es cíclico: el P/E engaña en el pico).',
    rules: { fcf_yield: { w: 3, p: { min: 6 } }, div_range: { w: 2, p: { min: 3, max: 7 } }, debt_ebitda: { w: 2, p: { max: 1.5 } }, evebitda: { w: 2, p: { max: 7 } }, payout_high: { w: 1, p: { max: 100 } }, div_vs_avg: { w: 1, p: { margen: 0 } } },
  },
  minera: {
    label: 'Minería (oro / cobre)', desc: 'Rol: cobertura y electrificación. EV/EBITDA bajo, caja, poca deuda y márgenes (siguen al precio del metal).',
    rules: { evebitda: { w: 2, p: { max: 8 } }, fcf_yield: { w: 2, p: { min: 5 } }, debt_ebitda: { w: 2, p: { max: 1.5 } }, op_margin: { w: 1, p: { min: 25 } }, rev_growth: { w: 1, p: { min: 10 } }, fpe: { w: 1, p: { max: 20 } } },
  },
  cripto: {
    label: 'Cripto / ciclo BTC', common: [], desc: 'Rol: exposición al ciclo de Bitcoin. Manda el análisis técnico; de fundamentales solo el upside al precio justo (si cargás uno).',
    rules: {},
  },
  reit: {
    label: 'Real estate (REITs)', desc: 'Rol: renta inmobiliaria. Dividendo, yield vs su historia, apalancamiento y crecimiento (el payout alto es normal en REITs).',
    rules: { div_range: { w: 3, p: { min: 2.5, max: 7 } }, div_vs_avg: { w: 3, p: { margen: 0 } }, debt_ebitda: { w: 2, p: { max: 6.5 } }, rev_growth: { w: 2, p: { min: 5 } }, evebitda: { w: 1, p: { max: 25 } } },
  },
  materiales: {
    label: 'Materiales de calidad', desc: 'Rol: compounder industrial. Márgenes, caja, valuación y dividendo vs su historia.',
    rules: { op_margin: { w: 2, p: { min: 18 } }, fcf_yield: { w: 2, p: { min: 3 } }, fpe: { w: 2, p: { max: 28 } }, peg: { w: 2, p: { max: 2.5 } }, div_vs_avg: { w: 1, p: { margen: 0 } }, debt_ebitda: { w: 1, p: { max: 3 } }, rev_decline: { w: 1, p: { margen: 5 } } },
  },
  salud: {
    label: 'Salud', desc: 'Rol: defensiva con crecimiento. Valuación, caja y yield vs su historia.',
    rules: { fpe: { w: 2, p: { max: 20 } }, peg: { w: 2, p: { max: 1.5 } }, fcf_yield: { w: 2, p: { min: 4 } }, div_vs_avg: { w: 2, p: { margen: 0 } }, debt_ebitda: { w: 1, p: { max: 3 } }, rev_decline: { w: 2, p: { margen: 5 } } },
  },
  industrial: {
    label: 'Industrial', desc: 'Rol: cíclica de calidad. EV/EBITDA, márgenes, caja y deuda.',
    rules: { evebitda: { w: 2, p: { max: 18 } }, op_margin: { w: 2, p: { min: 12 } }, rev_growth: { w: 1, p: { min: 5 } }, fcf_yield: { w: 2, p: { min: 3 } }, debt_ebitda: { w: 1, p: { max: 3 } }, fpe: { w: 1, p: { max: 25 } }, fpe_high: { w: 1, p: { max: 45 } } },
  },
  megacap: {
    label: 'Mega cap tech', desc: 'Rol: núcleo de crecimiento. PEG, márgenes, crecimiento y revisiones al alza.',
    rules: { peg: { w: 2, p: { max: 1.5 } }, fpe: { w: 2, p: { max: 30 } }, rev_growth: { w: 2, p: { min: 10 } }, op_margin: { w: 2, p: { min: 25 } }, fcf_yield: { w: 1, p: { min: 2.5 } }, eps_rev_up: { w: 1, p: { pct: 2 } }, fpe_high: { w: 1, p: { max: 50 } } },
  },
  semis: {
    label: 'Semiconductores', desc: 'Rol: ciclo de IA. PEG, margen bruto (poder de precio) y revisiones de EPS.',
    rules: { peg: { w: 3, p: { max: 1.2 } }, fpe: { w: 2, p: { max: 30 } }, gross_margin: { w: 2, p: { min: 45 } }, rev_growth: { w: 2, p: { min: 15 } }, eps_rev_up: { w: 2, p: { pct: 2 } }, fpe_high: { w: 1, p: { max: 50 } } },
  },
  software: {
    label: 'Software', desc: 'Rol: alto crecimiento. Regla del 40, EV/Ventas y margen bruto (el P/E suele no aplicar).',
    rules: { rule40: { w: 3, p: { min: 40 } }, ev_sales: { w: 2, p: { max: 15 } }, rev_growth: { w: 2, p: { min: 20 } }, gross_margin: { w: 1, p: { min: 70 } }, peg: { w: 2, p: { max: 1.5 } }, fpe_high: { w: 1, p: { max: 80 } }, rev_decline: { w: 2, p: { margen: 5 } } },
  },
  fintech: {
    label: 'Fintech / Fast Grower', desc: 'Rol: crecimiento alto. ROE, ventas, PEG y eficiencia.',
    rules: { roe: { w: 2, p: { min: 20 } }, rev_growth: { w: 2, p: { min: 25 } }, peg: { w: 3, p: { max: 1 } }, efficiency: { w: 2, p: { max: 35 } }, fpe: { w: 1, p: { max: 30 } }, fpe_high: { w: 1, p: { max: 55 } } },
  },
};

// Aplica un perfil a las reglas de un grupo (muta y devuelve rules)
export function applyProfile(rules, key) {
  const prof = PROFILES[key]; if (!prof) return rules;
  for (const [id, def] of Object.entries(RULES)) {
    if (def.cat === 'tec') continue;
    const r = (rules[id] ||= { on: false, w: def.w, p: { ...def.p }, tg: !!def.tg });
    const pr = prof.rules[id];
    if (pr) { r.on = true; r.w = pr.w; r.p = { ...def.p, ...pr.p }; }
    else if ((prof.common || COMMON).includes(id)) { r.on = true; }
    else r.on = false;
  }
  return rules;
}
