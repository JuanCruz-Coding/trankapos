import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';

// MP redirige acá tras autorizar la suscripción. Los query params típicos:
//   ?preapproval_id=xxx&status=approved (o pending / rejected)
// Esta página solo muestra feedback al usuario. El status real se actualiza
// cuando llegue el webhook de MP a la Edge Function `mp-webhook`.

export default function PlanReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);

  const status = params.get('status') ?? params.get('collection_status') ?? 'unknown';
  const preapprovalId = params.get('preapproval_id');

  // Refresca cada 3s para forzar releer la suscripción cuando volvés a /plan
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 3000);
    return () => clearInterval(t);
  }, []);
  void tick;

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
          desc: 'Mercado Pago todavía está procesando tu suscripción. Te avisaremos por mail cuando esté confirmada.',
        };
      case 'rejected':
        return {
          icon: <XCircle className="h-12 w-12 text-red-500" />,
          title: 'Pago rechazado',
          desc: 'No pudimos cobrar tu suscripción. Revisá el medio de pago y probá de nuevo.',
        };
      default:
        return {
          icon: <Clock className="h-12 w-12 text-slate-400" />,
          title: 'Procesando…',
          desc: 'Estamos confirmando el resultado con Mercado Pago.',
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
          <Button onClick={() => navigate('/plan')}>Volver a Mi plan</Button>
        </CardBody>
      </Card>
    </div>
  );
}
