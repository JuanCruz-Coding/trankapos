// Templates HTML para emails transaccionales. Estilos inline porque la
// mayoría de clientes de email (Gmail, Outlook, etc) no soportan <style>.

const APP_URL = 'https://pos.trankasoft.com';
const SUPPORT_EMAIL = 'soporte@trankasoft.com';

function shell(content: string, title: string): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <tr>
              <td style="background:#0d9488;padding:24px;color:#ffffff;text-align:left;">
                <div style="font-size:20px;font-weight:700;letter-spacing:-0.5px;">TrankaPOS</div>
                <div style="font-size:12px;opacity:0.85;margin-top:2px;">Punto de venta para kioscos</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px;color:#0f172a;font-size:15px;line-height:24px;">
                ${content}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center;border-top:1px solid #e2e8f0;">
                Recibís este email porque sos cliente de TrankaPOS.<br>
                ¿Dudas? Escribinos a <a href="mailto:${SUPPORT_EMAIL}" style="color:#0d9488;">${SUPPORT_EMAIL}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px;">${label}</a>`;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);
}

// ============================================================
// Templates concretos
// ============================================================

export function welcomeEmail(name: string, tenantName: string) {
  const subject = `¡Bienvenido a TrankaPOS, ${name}!`;
  const html = shell(
    `
    <h1 style="font-size:22px;margin:0 0 16px 0;">¡Hola ${name}!</h1>
    <p>Tu kiosco <strong>${tenantName}</strong> ya está creado en TrankaPOS y tenés <strong>14 días de prueba</strong> gratis con todas las funciones desbloqueadas.</p>
    <p style="margin-top:20px;">Algunos primeros pasos para arrancar:</p>
    <ul style="padding-left:20px;">
      <li>Cargá tus productos en la sección <strong>Productos</strong></li>
      <li>Sumá usuarios cajeros en <strong>Usuarios</strong></li>
      <li>Abrí caja desde <strong>Caja</strong> y empezá a vender</li>
    </ul>
    <div style="margin:28px 0;text-align:center;">
      ${button('Ir a TrankaPOS', APP_URL)}
    </div>
    <p style="color:#64748b;font-size:13px;">Cuando termine la prueba, podés elegir el plan que te queda mejor desde "Mi plan".</p>
    `,
    subject,
  );
  return { subject, html };
}

export function subscriptionActivatedEmail(
  name: string,
  planName: string,
  amount: number,
) {
  const subject = `Tu plan ${planName} ya está activo`;
  const html = shell(
    `
    <h1 style="font-size:22px;margin:0 0 16px 0;">¡Listo, ${name}!</h1>
    <p>Tu suscripción al <strong>plan ${planName}</strong> de TrankaPOS quedó activa. Vamos a cobrarte <strong>${fmtMoney(amount)}</strong> cada mes con la tarjeta que autorizaste en Mercado Pago.</p>
    <p>Ya podés acceder a todas las funciones del plan.</p>
    <div style="margin:28px 0;text-align:center;">
      ${button('Ir a TrankaPOS', APP_URL)}
    </div>
    <p style="color:#64748b;font-size:13px;">Podés cambiar de plan o cancelar cuando quieras desde la sección "Mi plan" en la app.</p>
    `,
    subject,
  );
  return { subject, html };
}

export function pastDueEmail(name: string, planName: string, amount: number) {
  const subject = 'No pudimos cobrar tu suscripción';
  const html = shell(
    `
    <h1 style="font-size:22px;margin:0 0 16px 0;color:#b91c1c;">Hola ${name}, pago pendiente</h1>
    <p>No pudimos cobrar la cuota de <strong>${fmtMoney(amount)}</strong> del plan <strong>${planName}</strong>. Esto suele pasar porque la tarjeta venció, está bloqueada o no tiene fondos.</p>
    <p>Para mantener tu plan activo, actualizá el medio de pago en tu cuenta de Mercado Pago. Si no lo hacés en los próximos días, suspendemos el acceso a las funciones del plan.</p>
    <div style="margin:28px 0;text-align:center;">
      ${button('Actualizar tarjeta en MP', 'https://www.mercadopago.com.ar/subscriptions')}
    </div>
    <p style="color:#64748b;font-size:13px;">Si ya lo solucionaste, ignorá este email — el sistema se actualiza automáticamente cuando MP te cobra de nuevo.</p>
    `,
    subject,
  );
  return { subject, html };
}
