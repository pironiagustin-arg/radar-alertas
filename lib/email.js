// Avisos por mail vía Resend (gratis hasta 3.000/mes). Sin dominio propio, el remitente
// onboarding@resend.dev solo puede mandar al mail con el que creaste la cuenta de Resend.
export async function sendEmail(subject, html) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.ALERT_FROM || 'Radar de Alertas <onboarding@resend.dev>', to: [process.env.ALERT_EMAIL], subject, html }),
  });
  if (!r.ok) throw new Error('Resend: ' + (await r.text()).slice(0, 200));
  return true;
}
