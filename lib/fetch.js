// Trae precios diarios + fundamentals de Yahoo Finance.
// El servidor solo trae datos crudos; los indicadores y las reglas se calculan en el navegador,
// así cambiar un umbral no obliga a volver a pedir datos.
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const cache = new Map(); // cache en memoria (vive mientras la función esté "caliente")
const TTL = 10 * 60 * 1000;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10000) / 10000);

export async function getPrices(symbol) {
  return cached('p:' + symbol, async () => {
    const from = new Date(Date.now() - 2.2 * 365 * 864e5); // ~2 años: alcanza para EMA200 estable
    const c = await yf.chart(symbol, { period1: from, interval: '1d' });
    const q = c.quotes.filter((x) => x.close != null);
    return {
      dates: q.map((x) => x.date.toISOString().slice(0, 10)),
      close: q.map((x) => r2(x.close)),
      high: q.map((x) => r2(x.high ?? x.close)),
      low: q.map((x) => r2(x.low ?? x.close)),
      name: c.meta?.shortName || c.meta?.longName || symbol,
      price: c.meta?.regularMarketPrice ?? q.at(-1)?.close,
    };
  });
}

export async function getFundamentals(symbol) {
  return cached('f:' + symbol, async () => {
    const out = {};
    let s;
    try {
      s = await yf.quoteSummary(symbol, {
        modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'earnings',
          'earningsHistory', 'earningsTrend', 'insiderTransactions', 'calendarEvents'],
      });
    } catch (e) {
      return { error: e.message };
    }
    const sd = s.summaryDetail || {}, ks = s.defaultKeyStatistics || {}, fd = s.financialData || {};
    out.name = s.price?.shortName || s.price?.longName;
    out.quoteType = s.price?.quoteType;
    out.forwardPE = r2(sd.forwardPE ?? ks.forwardPE);
    out.trailingPE = r2(sd.trailingPE);
    out.peg = r2(ks.pegRatio ?? ks.trailingPegRatio);
    out.evEbitda = r2(ks.enterpriseToEbitda);
    // Yahoo da D/E en porcentaje (78 = 0.78x). Lo normalizamos a veces.
    out.debtEquity = fd.debtToEquity != null ? r2(fd.debtToEquity / 100) : null;
    out.forwardEps = r2(ks.forwardEps);
    out.trailingEps = r2(ks.trailingEps);
    out.high52 = r2(sd.fiftyTwoWeekHigh);
    // ── métricas sectoriales (todas en % salvo múltiplos) ──
    const pct = (x) => (x == null || !isFinite(x) ? null : r2(x * 100));
    const mcap = s.price?.marketCap;
    out.divYield = sd.dividendYield != null ? pct(sd.dividendYield) : 0;
    out.divYield5y = r2(sd.fiveYearAvgDividendYield); // Yahoo ya lo da en %
    out.payout = pct(sd.payoutRatio);
    out.pb = r2(ks.priceToBook);
    out.evSales = r2(ks.enterpriseToRevenue);
    out.roe = pct(fd.returnOnEquity);
    out.grossMargin = fd.grossMargins ? pct(fd.grossMargins) : null; // 0 = no aplica (bancos)
    out.opMargin = pct(fd.operatingMargins);
    out.revGrowth = pct(fd.revenueGrowth);
    out.fcfYield = fd.freeCashflow != null && mcap ? r2((fd.freeCashflow / mcap) * 100) : null;
    const fcfMargin = fd.freeCashflow != null && fd.totalRevenue ? (fd.freeCashflow / fd.totalRevenue) * 100 : null;
    out.rule40 = out.revGrowth != null && fcfMargin != null ? r2(out.revGrowth + fcfMargin) : null;
    out.debtEbitda = fd.totalDebt != null && fd.ebitda > 0 ? r2(fd.totalDebt / fd.ebitda) : null;
    // Balance para empresas apalancadas en expansión (neoclouds, infra IA)
    out.cashDebt = fd.totalCash != null && fd.totalDebt > 0 ? r2((fd.totalCash / fd.totalDebt) * 100) : null;
    out.debtMcap = fd.totalDebt != null && mcap ? r2((fd.totalDebt / mcap) * 100) : null;
    out.currentRatio = r2(fd.currentRatio);
    out.ev = ks.enterpriseValue ? r2(ks.enterpriseValue / 1e9) : null; // en USD miles de millones
    // Crecimiento anual de ventas (últimos años fiscales) para medir aceleración/desaceleración
    const yr = (s.earnings?.financialsChart?.yearly || []).filter((y) => y.revenue > 0);
    if (yr.length >= 2) {
      out.revGrowthFY = r2((yr.at(-1).revenue / yr.at(-2).revenue - 1) * 100);
      out.revGrowthHist = yr.slice(1).map((y, i) => ({ y: y.date, g: r2((y.revenue / yr[i].revenue - 1) * 100) }));
    }
    out.targetMean = r2(fd.targetMeanPrice);

    // Earnings vs estimados (últimos 4 trimestres)
    const hist = (s.earningsHistory?.history || []).filter((h) => h.epsActual != null && h.epsEstimate != null);
    out.earnings = hist.map((h) => ({
      q: h.quarter ? new Date(h.quarter).toISOString().slice(0, 10) : null,
      actual: r2(h.epsActual), est: r2(h.epsEstimate),
      surprise: h.epsEstimate ? r2((h.epsActual - h.epsEstimate) / Math.abs(h.epsEstimate) * 100) : null,
    }));

    // Revisiones de EPS del año en curso (sube/baja vs 30 y 90 días)
    const t0 = (s.earningsTrend?.trend || []).find((t) => t.period === '0y');
    if (t0?.epsTrend?.current && t0.epsTrend['90daysAgo']) {
      out.epsRev30 = r2((t0.epsTrend.current / t0.epsTrend['30daysAgo'] - 1) * 100);
      out.epsRev90 = r2((t0.epsTrend.current / t0.epsTrend['90daysAgo'] - 1) * 100);
    }

    // Insiders: solo COMPRAS (Purchase / Buy) de los últimos 180 días
    const since = Date.now() - 180 * 864e5;
    const buys = (s.insiderTransactions?.transactions || []).filter((t) => {
      const txt = (t.transactionText || '').toLowerCase();
      return /purchase|buy/.test(txt) && !/sale|sell/.test(txt) && t.startDate && +new Date(t.startDate) >= since;
    });
    out.insiderBuys = buys.map((t) => ({
      date: new Date(t.startDate).toISOString().slice(0, 10), who: t.filerName,
      role: t.filerRelation, shares: t.shares, value: t.value,
    }));

    const ed = s.calendarEvents?.earnings?.earningsDate?.[0];
    out.nextEarnings = ed ? new Date(ed).toISOString().slice(0, 10) : null;

    // FCF real (flujo operativo − capex, últimos 12 meses). El "freeCashflow" de financialData es
    // levered FCF y suele dar muy distinto a Koyfin/Fiscal.ai, así que lo reemplazamos.
    try {
      const cf = await yf.fundamentalsTimeSeries(symbol, { period1: new Date(Date.now() - 400 * 864e5), type: 'trailing', module: 'cash-flow' }, { validateResult: false });
      const l = [...cf].reverse().find((x) => x.freeCashFlow != null);
      if (l) {
        if (mcap) out.fcfYield = r2((l.freeCashFlow / mcap) * 100);
        if (fd.totalRevenue && out.revGrowth != null) out.rule40 = r2(out.revGrowth + (l.freeCashFlow / fd.totalRevenue) * 100);
      }
    } catch { /* sin estado de flujo */ }

    // Efficiency ratio (bancos y fintech): gastos no financieros / ingresos netos, últimos 12 meses
    if (!fd.grossMargins) {
      try {
        const tt = await yf.fundamentalsTimeSeries(symbol, { period1: new Date(Date.now() - 400 * 864e5), type: 'trailing', module: 'financials' }, { validateResult: false });
        const last = [...tt].reverse().find((x) => x.nonInterestExpense && x.totalRevenue);
        if (last) out.efficiency = r2((last.nonInterestExpense / last.totalRevenue) * 100);
      } catch { /* no disponible */ }
    }

    // EPS trimestral: último trimestre vs mismo trimestre del año anterior
    try {
      const ts = await yf.fundamentalsTimeSeries(symbol, {
        period1: new Date(Date.now() - 2 * 365 * 864e5), type: 'quarterly', module: 'financials',
      }, { validateResult: false });
      const eps = ts.filter((x) => x.dilutedEPS != null).map((x) => x.dilutedEPS);
      if (eps.length >= 5) {
        const a = eps.at(-1), b = eps.at(-5);
        if (b > 0) out.epsYoY = r2((a / b - 1) * 100);
      }
      // Dilución: acciones promedio del último trimestre vs un año antes
      const sh = ts.map((x) => x.dilutedAverageShares || x.basicAverageShares).filter((x) => x > 0);
      if (sh.length >= 5) out.sharesYoY = r2((sh.at(-1) / sh.at(-5) - 1) * 100);
    } catch { /* algunos tickers (ETFs) no tienen */ }

    return out;
  });
}

// Limita concurrencia para no comerse un 429 de Yahoo
async function pool(items, n, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]); }
  }));
  return res;
}

export async function getData(symbols, { fundamentals = [] } = {}) {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 80);
  const fset = new Set(fundamentals.map((s) => s.trim().toUpperCase()));
  const out = { asOf: new Date().toISOString(), symbols: {} };
  await pool(uniq, 8, async (sym) => {
    const row = {};
    try { row.prices = await getPrices(sym); } catch (e) { row.error = e.message; }
    if (fset.has(sym)) row.fund = await getFundamentals(sym).catch((e) => ({ error: e.message }));
    out.symbols[sym] = row;
  });
  return out;
}
