// GET /api/data?symbols=NVDA,AVGO,SPY,^VIX&fund=NVDA,AVGO
import { getData } from '../lib/fetch.js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const symbols = (url.searchParams.get('symbols') || '').split(',');
    const fund = (url.searchParams.get('fund') || '').split(',');
    const data = await getData(symbols, { fundamentals: fund });
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
}
