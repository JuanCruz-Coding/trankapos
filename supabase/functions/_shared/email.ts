// =====================================================================
// Helper para enviar emails via Resend.
// =====================================================================
// Usado desde cualquier Edge Function:
//   import { sendEmail } from '../_shared/email.ts';
//   await sendEmail({ to: 'user@x.com', subject: '...', html: '...' });
//
// Variables de entorno:
//   RESEND_API_KEY (la seteás con `supabase secrets set RESEND_API_KEY=...`)
//
// Si la key no está configurada, log + no-op (no bloquea el flow).
// =====================================================================

const FROM = 'TrankaPOS <noreply@trankasoft.com>';
const REPLY_TO = 'soporte@trankasoft.com';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.warn('RESEND_API_KEY no configurada, omitiendo envío de email');
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('Resend respondió con error:', res.status, detail);
    }
  } catch (err) {
    // Nunca dejamos que un fallo de email rompa el flow principal
    console.error('Error enviando email:', err);
  }
}
