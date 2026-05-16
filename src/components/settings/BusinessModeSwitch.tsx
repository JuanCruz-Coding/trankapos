import { useEffect, useState } from 'react';
import { Store, ShoppingBag, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { data } from '@/data';
import { toast } from '@/stores/toast';
import {
  BUSINESS_SUBTYPES,
  type BusinessMode,
  type BusinessSubtype,
} from '@/types';
import { cn } from '@/lib/utils';

interface Props {
  currentMode: BusinessMode;
  currentSubtype: BusinessSubtype | null;
  onChanged: () => void;
}

/**
 * Sprint CRM-RETAIL — switch del modo del negocio. Permite cambiar entre
 * kiosk/retail (+ subtipo) y opcionalmente aplicar el preset de configuración
 * recomendada (refund policy, validez del vale, campos del cliente).
 */
export function BusinessModeSwitch({ currentMode, currentSubtype, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BusinessMode>(currentMode);
  const [subtype, setSubtype] = useState<BusinessSubtype | null>(currentSubtype);
  const [applyPreset, setApplyPreset] = useState(true);
  const [saving, setSaving] = useState(false);

  // Resetear el form al abrir el modal con los valores actuales.
  useEffect(() => {
    if (open) {
      setMode(currentMode);
      setSubtype(currentSubtype);
      setApplyPreset(true);
    }
  }, [open, currentMode, currentSubtype]);

  const disabled = mode === 'retail' && !subtype;

  async function handleConfirm() {
    if (disabled) return;
    setSaving(true);
    try {
      if (applyPreset) {
        await data.applyBusinessModePreset(mode);
        // El preset setea defaults pero no toca el subtype — lo guardamos aparte.
        if (mode === 'retail' && subtype) {
          await data.updateTenantSettings({ businessSubtype: subtype });
        } else if (mode === 'kiosk') {
          await data.updateTenantSettings({ businessSubtype: null });
        }
      } else {
        await data.updateTenantSettings({
          businessMode: mode,
          businessSubtype: mode === 'retail' ? subtype : null,
        });
      }
      toast.success('Modo del negocio actualizado');
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const currentSubtypeLabel =
    currentSubtype
      ? BUSINESS_SUBTYPES.find((s) => s.value === currentSubtype)?.label
      : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-5 w-5 text-brand-600" />
        <h3 className="font-semibold text-navy">Modo del negocio</h3>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2">
          {currentMode === 'kiosk' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
              <Store className="h-3.5 w-3.5" />
              Kiosco / Comercio simple
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700">
              <ShoppingBag className="h-3.5 w-3.5" />
              Retail{currentSubtypeLabel ? ` · ${currentSubtypeLabel}` : ''}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="ml-auto"
        >
          Cambiar modo
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => (saving ? undefined : setOpen(false))}
        title="Cambiar modo del negocio"
      >
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <ModeOption
              icon={Store}
              title="Kiosco / Comercio simple"
              description="Alimentos, bebidas, almacén."
              selected={mode === 'kiosk'}
              onSelect={() => {
                setMode('kiosk');
                setSubtype(null);
              }}
            />
            <ModeOption
              icon={ShoppingBag}
              title="Retail"
              description="Ropa, electro, librería, etc."
              selected={mode === 'retail'}
              onSelect={() => setMode('retail')}
            />
          </div>

          {mode === 'retail' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Rubro principal
              </label>
              <select
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={subtype ?? ''}
                onChange={(e) => setSubtype(e.target.value as BusinessSubtype)}
              >
                <option value="" disabled>
                  Seleccioná un rubro…
                </option>
                {BUSINESS_SUBTYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={applyPreset}
              onChange={(e) => setApplyPreset(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">
                Aplicar configuración recomendada
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                Esto va a setear refund policy + meses de vigencia del vale + campos
                obligatorios del cliente según el nuevo modo. Tus datos no se borran.
              </div>
            </div>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={saving || disabled}>
              {saving ? 'Aplicando…' : 'Aplicar cambios'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

interface ModeOptionProps {
  icon: typeof Store;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}

function ModeOption({ icon: Icon, title, description, selected, onSelect }: ModeOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-lg border-2 p-3 text-left transition',
        selected
          ? 'border-brand-400 bg-brand-50'
          : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          selected ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-sm font-semibold text-navy">{title}</div>
        <div className="mt-0.5 text-xs text-slate-500">{description}</div>
      </div>
    </button>
  );
}
