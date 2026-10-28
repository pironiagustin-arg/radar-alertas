// Cliente mínimo de Supabase (PostgREST). Las tablas radar_* tienen RLS que exige el header
// x-radar-key = APP_SECRET; sin ese secreto (que solo vive en Vercel) no se puede leer ni escribir.
const BASE = 'https://sdzhnexusnymyshjlhem.supabase.co/rest/v1/';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkemhuZXh1c255bXlzaGpsaGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMTc5OTAsImV4cCI6MjEwNzU5Mzk5MH0.Wiso-N1_TEcNrgRkmM7VytK-TFG7sGNjnpW_tR0rYX4';

export async function q(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json',
      'x-radar-key': process.env.APP_SECRET || '',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`DB ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

export async function kvGet(key) {
  const rows = await q(`radar_kv?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows?.[0]?.value ?? null;
}
export function kvSet(key, value) {
  return q('radar_kv?on_conflict=key', { method: 'POST', body: { key, value, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates' });
}
export const insert = (table, rows) => q(table, { method: 'POST', body: rows, prefer: 'return=representation' });
