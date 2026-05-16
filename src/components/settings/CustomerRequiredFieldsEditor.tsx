import { UserCheck } from 'lucide-react';
import type { CustomerRequiredFields } from '@/types';

interface Props {
  value: CustomerRequiredFields;
  onChange: (v: CustomerRequiredFields) => void;
}

const FIELDS: { key: keyof CustomerRequiredFields; label: string; hint?: string }[] = [
  { key: 'docNumber', label: 'Documento (DNI/CUIT/CUIL + número)' },
  { key: 'ivaCondition', label: 'Condición IVA' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Domicilio (calle, ciudad, provincia)' },
  { key: 'birthdate', label: 'Fecha de nacimiento' },
];

/**
 * Sprint CRM-RETAIL — editor de qué campos del cliente son obligatorios al
 * cargarlo desde el cobro. Cambia por modo del negocio (retail suele exigir
 * más, kiosco casi nada).
 */
export function CustomerRequiredFieldsEditor({ value, onChange }: Props) {
  function toggle(key: keyof CustomerRequiredFields) {
    onChange({ ...value, [key]: !value[key] });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <UserCheck className="h-5 w-5 text-brand-600" />
        <h3 className="font-semibold text-navy">Datos del cliente requeridos</h3>
      </div>
      <p className="text-sm text-slate-600">
        Cuando se carga un cliente al cobrar, exigir:
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label
            key={f.key}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={value[f.key]}
              onChange={() => toggle(f.key)}
              className="mt-0.5 h-4 w-4"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">{f.label}</div>
              {f.hint && <div className="mt-0.5 text-xs text-slate-500">{f.hint}</div>}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
