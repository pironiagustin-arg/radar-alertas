// Proveedor de IA intercambiable. Misma interfaz que Anthropic messages.create:
//   create({ model, system, messages, tools, max_tokens }) → { content: [...bloques], stop_reason }
// Si hay ANTHROPIC_API_KEY usa Claude (pago); si no, GEMINI_API_KEY (Google, tiene capa gratuita).
import Anthropic from '@anthropic-ai/sdk';

export const provider = () => (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.GEMINI_API_KEY ? 'gemini' : null);

export async function create(params) {
  const p = provider();
  if (p === 'anthropic') {
    const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return ai.messages.create({ ...params, model: process.env.RADAR_MODEL || 'claude-sonnet-5-5' });
  }
  if (p === 'gemini') return gemini(params);
  throw new Error('Falta una key de IA: cargá GEMINI_API_KEY (gratis en aistudio.google.com) o ANTHROPIC_API_KEY en Vercel');
}

// ───────────── Gemini (REST) ─────────────
function toGeminiContents(messages) {
  const names = {}; // tool_use_id → nombre de función
  return messages.map((m) => {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    const parts = [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text) parts.push({ text: b.text });
      else if ((b.type === 'image' || b.type === 'document') && b.source?.type === 'base64') parts.push({ inline_data: { mime_type: b.source.media_type, data: b.source.data } });
      else if (b.type === 'tool_use') { names[b.id] = b.name; parts.push(b._g || { functionCall: { name: b.name, args: b.input || {} } }); }
      else if (b.type === 'tool_result') {
        let resp; try { resp = JSON.parse(b.content); } catch { resp = { content: b.content }; }
        parts.push({ functionResponse: { name: names[b.tool_use_id] || 'tool', response: Array.isArray(resp) ? { result: resp } : resp } });
      }
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: parts.length ? parts : [{ text: '…' }] };
  });
}

async function gemini({ system, messages, tools, max_tokens }) {
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const body = {
    contents: toGeminiContents(messages),
    generationConfig: { maxOutputTokens: Math.max(max_tokens || 2000, 4000) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools?.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema })) }];
  let r, j;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body),
    });
    j = await r.json().catch(() => ({}));
    if (r.status !== 429 && r.status !== 503) break;
    await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)));
  }
  if (!r.ok) {
    const msg = j?.error?.message || 'HTTP ' + r.status;
    throw new Error(r.status === 429 ? 'Gemini: llegaste al límite gratuito por minuto/día, probá en un rato' : 'Gemini: ' + msg.slice(0, 200));
  }
  const parts = j.candidates?.[0]?.content?.parts || [];
  const content = []; let n = 0;
  for (const part of parts) {
    if (part.thought) continue;
    if (part.text) content.push({ type: 'text', text: part.text });
    if (part.functionCall) content.push({ type: 'tool_use', id: `g${Date.now()}_${n++}`, name: part.functionCall.name, input: part.functionCall.args || {}, _g: part });
  }
  if (!content.length) content.push({ type: 'text', text: j.candidates?.[0]?.finishReason === 'SAFETY' ? 'Gemini bloqueó la respuesta.' : '' });
  return { content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
}
