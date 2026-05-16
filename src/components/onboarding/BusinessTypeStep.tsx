import { Store, ShoppingBag, ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BUSINESS_SUBTYPES, type BusinessMode, type BusinessSubtype } from '@/types';
import { cn } from '@/lib/utils';

interface Value {
  businessMode: BusinessMode;
  businessSubtype: BusinessSubtype | null;
}

interface Props {
  value: Value;
  onChange: (v: Value) => void;
  onNext: () => void;
  onBack?: () => void;
}

/**
 * Sprint CRM-RETAIL — paso del onboarding (Signup wizard) donde el comerciante
 * elige el tipo de negocio. Esto solo determina los DEFAULTS iniciales
 * (refund_policy, vigencia de vale, campos del cliente requeridos, etc).
 * Se puede cambiar más tarde en Settings.
 */
export function BusinessTypeStep({ value, onChange, onNext, onBack }: Props) {
  const isKiosk = value.businessMode === 'kiosk';
  const isRetail = value.businessMode === 'retail';
  const retailMissingSubtype = isRetail && !value.businessSubtype;

  function selectKiosk() {
    onChange({ businessMode: 'kiosk', businessSubtype: null });
  }

  function selectRetail() {
    // Al pasar a retail, dejamos el subtype como estaba si ya había uno seleccionado
    // (caso usuario va y vuelve); si no, queda null y el botón Siguiente queda
    // deshabilitado hasta que elija.
    onChange({ businessMode: 'retail', businessSubtype: value.businessSubtype });
  }

  function selectSubtype(subtype: BusinessSubtype) {
    onChange({ businessMode: 'retail', businessSubtype: subtype });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-bold text-navy">
          ¿Qué tipo de negocio tenés?
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Esto sólo configura los defaults iniciales. Podés cambiarlo después en
          Settings.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <BusinessCard
          icon={Store}
          title="Kiosco / Comercio simple"
          description="Alimentos, bebidas, almacén, quiosco. Ventas rápidas, sin cliente fijo."
          selected={isKiosk}
          onSelect={selectKiosk}
        />
        <BusinessCard
          icon={ShoppingBag}
          title="Retail"
          description="Ropa, electrodomésticos, librería, ferretería, etc. Tickets más grandes, clientes que vuelven."
          selected={isRetail}
          onSelect={selectRetail}
        />
      </div>

      {isRetail && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="mb-1 block text-xs font-medium text-slate-700">
            Rubro principal
          </label>
          <select
            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            value={value.businessSubtype ?? ''}
            onChange={(e) =>
              selectSubtype(e.target.value as BusinessSubtype)
            }
          >
            <option value="" disabled>
              Seleccioná tu rubro…
            </option>
            {BUSINESS_SUBTYPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Usamos esto para ajustar defaults (ej. campos obligatorios del cliente).
          </p>
        </div>
      )}

      <div className="flex justify-between gap-2 pt-2">
        {onBack ? (
          <Button type="button" variant="outline" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Atrás
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" onClick={onNext} disabled={retailMissingSubtype}>
          Siguiente
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

interface CardProps {
  icon: typeof Store;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}

function BusinessCard({ icon: Icon, title, description, selected, onSelect }: CardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition',
        selected
          ? 'border-brand-400 bg-brand-50 shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      <div
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg',
          selected ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="font-display text-base font-bold text-navy">{title}</div>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
    </button>
  );
}
