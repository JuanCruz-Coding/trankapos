import { Link } from 'react-router-dom';
import { ShoppingCart, ArrowLeft } from 'lucide-react';

export default function Terms() {
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

      <h1 className="mb-2 text-3xl font-bold text-slate-900">Términos y Condiciones</h1>
      <p className="mb-8 text-sm text-slate-500">Última actualización: mayo 2026</p>

      <div className="space-y-6 text-sm leading-6 text-slate-700">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">1. Sobre el servicio</h2>
          <p>
            TrankaPos es un servicio SaaS de punto de venta provisto por Trankasoft, con
            domicilio en Argentina. Al registrarte, aceptás estos términos.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">2. Cuenta y uso</h2>
          <p>
            Sos responsable de mantener la confidencialidad de tu contraseña y de toda la
            actividad que ocurra en tu cuenta. Te comprometés a usar el servicio de buena fe
            y a no realizar acciones que afecten su funcionamiento o el de otros usuarios.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">3. Planes y cobros</h2>
          <p>
            Ofrecemos distintos planes con un período de prueba gratuito. Una vez vencido,
            los cobros mensuales se procesan automáticamente a través de Mercado Pago con
            la tarjeta que autorizaste. Los precios pueden ajustarse con un aviso previo de
            30 días.
          </p>
          <p className="mt-2">
            Si un cobro falla, tu plan pasa a estado "Pago vencido". Tenés un plazo
            razonable para regularizar antes de que se suspenda el acceso. No reembolsamos
            cobros ya procesados.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">4. Cancelación</h2>
          <p>
            Podés cancelar tu suscripción en cualquier momento desde la pantalla "Mi plan".
            La cancelación tiene efecto al final del período pagado: mantenés acceso hasta
            esa fecha. Después, tu cuenta vuelve al plan Free.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">5. Tus datos</h2>
          <p>
            Vos sos dueño de los datos que cargás en TrankaPos (productos, ventas,
            usuarios, etc.). Los almacenamos cifrados en infraestructura de Supabase y no
            los compartimos con terceros salvo cuando sea necesario para prestar el
            servicio (procesador de pagos, etc.) o lo requiera la ley.
          </p>
          <p className="mt-2">
            Podés exportar tus datos o pedir su eliminación escribiéndonos a{' '}
            <a className="text-brand-600 underline" href="mailto:soporte@trankasoft.com">
              soporte@trankasoft.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">6. Disponibilidad y limitación de responsabilidad</h2>
          <p>
            Hacemos lo posible por mantener el servicio disponible 24/7, pero no
            garantizamos disponibilidad ininterrumpida. No somos responsables por daños
            indirectos derivados del uso o imposibilidad de uso del servicio.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">7. Cambios</h2>
          <p>
            Podemos actualizar estos términos. Si los cambios son sustanciales te avisamos
            por email con al menos 15 días de anticipación.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">8. Contacto</h2>
          <p>
            Cualquier duda, escribinos a{' '}
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
