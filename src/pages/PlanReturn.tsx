import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';

// MP redirige acá tras autorizar la suscripción. Los query params típicos:
//   ?preapproval_id=xxx&status=approved (o pending / rejected)
// Cuando el user vuelve a mano con "Volver al sitio del vendedor", suele
// llegar SIN query params — por eso manejamos el caso default con un mensaje
// amigable + countdown que lo lleva a /plan solo.

const REDIRECT_SECONDS = 4;

export default function PlanReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);

  const status = params.get('status') ?? params.get('collection_status') ?? 'unknown';
  const preapprovalId = params.get('preapproval_id');

  // Countdown que redirige automáticamente a /plan cuando llega a 0.
  useEffect(() => {
    if (secondsLeft <= 0) {
      navigate('/plan');
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, navigate]);

  const view = (() => {
    switch (status) {
      case 'approved':
      case 'authorized':
        return {
          icon: <CheckCircle2 className="h-12 w-12 text-emerald-500" />,
          title: '¡Suscripción activada!',
          desc: 'Tu plan ya está activo. Vamos a cobrarte automáticamente todos los meses con la tarjeta que autorizaste.',
        };
      case 'pending':
        return {
          icon: <Clock className="h-12 w-12 text-sky-500" />,
          title: 'Pago pendiente',
          desc: 'Mercado Pago todavía está procesando tu suscripción. Te avisaremos cuando esté confirmada.',
        };
      case 'rejected':
        return {
          icon: <XCircle className="h-12 w-12 text-red-500" />,
          title: 'Pago rechazado',
          desc: 'No pudimos cobrar tu suscripción. Revisá el medio de pago y probá de nuevo.',
        };
      default:
        return {
          icon: <CheckCircle2 className="h-12 w-12 text-emerald-500" />,
          title: 'Volviste al POS',
          desc: 'Si autorizaste el pago, tu plan se va a activar en unos segundos cuando confirme Mercado Pago.',
        };
    }
  })();

  return (
    <div className="flex justify-center py-10">
      <Card className="max-w-md">
        <CardBody className="flex flex-col items-center gap-4 text-center">
          {view.icon}
          <h1 className="text-xl font-bold text-slate-900">{view.title}</h1>
          <p className="text-sm text-slate-600">{view.desc}</p>
          {preapprovalId && (
            <div className="rounded-md bg-slate-50 px-3 py-1 text-xs text-slate-500">
              ID de suscripción: <code>{preapprovalId.slice(0, 12)}…</code>
            </div>
          )}
          <p className="text-xs text-slate-400">
            Te redirigimos a Mi plan en {secondsLeft} seg…
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/')}>
              Ir al inicio
            </Button>
            <Button onClick={() => navigate('/plan')}>Ir a Mi plan</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
