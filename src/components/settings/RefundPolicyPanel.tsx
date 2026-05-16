import { Wallet } from 'lucide-react';
import { Input } from '@/components/ui/Input';

type RefundPolicy = 'cash_or_credit' | 'credit_only' | 'cash_only';

interface Props {
  refundPolicy: RefundPolicy;
  storeCreditValidityMonths: number | null;
  onPolicyChange: (p: RefundPolicy) => void;
  onValidityChange: (months: number | null) => void;
}

/**
 * Panel de política de devolución del comercio. Sprint DEV.fix.
 * Setea cómo se devuelve dinero en una devolución (cash o vale) + la
 * vigencia en meses del vale generado.
 */
export function RefundPolicyPanel({
  refundPolicy,
  storeCreditValidityMonths,
  onPolicyChange,
  onValidityChange,
}: Props) {
  const showValidity = refundPolicy !== 'cash_only';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-brand-600" />
        <h3 className="font-semibold text-navy">Política de devoluciones</h3>
      </div>

      <p className="text-sm text-slate-600">
        Configurá cómo se devuelve el dinero a un cliente cuando trae una venta para devolver
        o cambiar. La política aplica al wizard de devolución/cambio.
      </p>

      <div className="space-y-2">
        <PolicyOption
          checked={refundPolicy === 'cash_or_credit'}
          onSelect={() => onPolicyChange('cash_or_credit')}
          title="Cajero elige caso a caso"
          description="Por defecto. El cajero decide en cada devolución si devolver efectivo o entregar saldo a favor."
        />
        <PolicyOption
          checked={refundPolicy === 'credit_only'}
          onSelect={() => onPolicyChange('credit_only')}
          title="Siempre saldo a favor (recomendado para retail)"
          description="Cuando hay diferencia a favor del cliente, siempre se genera un vale. Excepción: motivos con la opción 'permite cash' (ej: Defectuoso)."
          accent="brand"
        />
        <PolicyOption
          checked={refundPolicy === 'cash_only'}
          onSelect={() => onPolicyChange('cash_only')}
          title="Siempre efectivo"
          description="Nunca se genera saldo a favor. El comercio no usa vales."
        />
      </div>

      {showValidity && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Vigencia del vale (meses)
          </label>
          <Input
            type="number"
            min="1"
            step="1"
            placeholder="Sin vencimiento"
            value={storeCreditValidityMonths ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (v === '') onValidityChange(null);
              else {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) onValidityChange(Math.floor(n));
              }
            }}
          />
          <p className="mt-1 text-xs text-slate-500">
            Vacío = el vale no vence. Sugerido: 6 a 12 meses.
          </p>
        </div>
      )}
    </div>
  );
}

interface PolicyOptionProps {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  accent?: 'brand' | 'default';
}

function PolicyOption({ checked, onSelect, title, description, accent = 'default' }: PolicyOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        checked
          ? accent === 'brand'
            ? 'flex w-full items-start gap-3 rounded-lg border-2 border-brand-400 bg-brand-50 p-3 text-left transition'
            : 'flex w-full items-start gap-3 rounded-lg border-2 border-navy bg-ice p-3 text-left transition'
          : 'flex w-full items-start gap-3 rounded-lg border-2 border-slate-200 bg-white p-3 text-left transition hover:border-slate-300'
      }
    >
      <span
        className={
          checked
            ? 'mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full border-4 border-navy bg-white'
            : 'mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full border-2 border-slate-300 bg-white'
        }
      />
      <span className="flex-1">
        <span className="block text-sm font-medium text-navy">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
    </button>
  );
}
