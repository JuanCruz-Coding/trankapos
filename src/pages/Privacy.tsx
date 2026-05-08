import { Link } from 'react-router-dom';
import { ShoppingCart, ArrowLeft } from 'lucide-react';

export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-brand-600 p-2 text-white">
          <ShoppingCart className="h-5 w-5" />
        </div>
        <Link to="/" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
      </div>

      <h1 className="mb-2 text-3xl font-bold text-slate-900">Política de Privacidad</h1>
      <p className="mb-8 text-sm text-slate-500">Última actualización: mayo 2026</p>

      <div className="space-y-6 text-sm leading-6 text-slate-700">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">1. Qué datos guardamos</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>Datos de tu cuenta: nombre, email, contraseña (hasheada).</li>
            <li>Datos de tu negocio: nombre del kiosco, sucursales, productos, ventas, stock.</li>
            <li>Datos de tu suscripción: plan, estado, ID en Mercado Pago.</li>
            <li>Logs técnicos para debugging y métricas (sin datos sensibles).</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">2. Para qué los usamos</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>Prestarte el servicio de TrankaPos.</li>
            <li>Procesar tus cobros mensuales vía Mercado Pago.</li>
            <li>Notificarte por email sobre tu cuenta y novedades del servicio.</li>
            <li>Mejorar el producto a partir de uso agregado y anónimo.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">3. Con quién los compartimos</h2>
          <p>Solo con los proveedores que necesitamos para que el servicio funcione:</p>
          <ul className="ml-5 mt-2 list-disc space-y-1">
            <li><strong>Supabase</strong> (Postgres + Auth) para almacenar tus datos.</li>
            <li><strong>Vercel</strong> para alojar el frontend.</li>
            <li><strong>Mercado Pago</strong> para procesar los cobros.</li>
            <li>Autoridades cuando lo requiera la ley.</li>
          </ul>
          <p className="mt-2">No vendemos ni cedemos tus datos a terceros con fines comerciales.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">4. Tus derechos</h2>
          <p>
            Podés acceder, rectificar o pedir la eliminación de tus datos personales en
            cualquier momento escribiéndonos a{' '}
            <a className="text-brand-600 underline" href="mailto:soporte@trankasoft.com">
              soporte@trankasoft.com
            </a>
            . Aplica la Ley 25.326 de Protección de Datos Personales de Argentina.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">5. Cookies</h2>
          <p>
            Usamos cookies estrictamente necesarias para mantener tu sesión iniciada. No
            usamos cookies de marketing ni rastreo de terceros.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">6. Seguridad</h2>
          <p>
            Tus datos viajan cifrados (TLS) y se almacenan en infraestructura con
            estándares de la industria. Las contraseñas se guardan hasheadas (nunca en
            texto plano). Aún así, ningún sistema es 100% seguro: si detectás algo raro,
            avisanos cuanto antes.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">7. Contacto</h2>
          <p>
            Cualquier consulta sobre esta política, escribinos a{' '}
            <a className="text-brand-600 underline" href="mailto:soporte@trankasoft.com">
              soporte@trankasoft.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
