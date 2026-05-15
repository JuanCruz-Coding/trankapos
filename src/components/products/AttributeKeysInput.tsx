import { useMemo, useState, type KeyboardEvent } from 'react';
import { X, Plus } from 'lucide-react';
import { toast } from '@/stores/toast';

interface Props {
  value: string[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
}

/**
 * Editor de las "claves de atributo" del producto (ej. "talle", "color").
 * No edita los valores — esos van en VariantEditor por cada variante.
 *
 * Reglas de validación:
 *  - clave no vacía
 *  - no duplicados (case insensitive)
 *  - shape `/^[a-z][a-z0-9_]*$/i` (letra inicial, sin espacios ni símbolos raros)
 *
 * Las claves se normalizan a minúsculas para usarlas como key del objeto
 * attributes que persistimos en jsonb.
 */

const KEY_REGEX = /^[a-z][a-z0-9_]*$/i;

const SUGGESTIONS = ['talle', 'color', 'material', 'tamaño', 'sabor'];

export function AttributeKeysInput({ value, onChange, disabled }: Props) {
  const [draft, setDraft] = useState('');

  const lowercased = useMemo(
    () => new Set(value.map((k) => k.toLowerCase())),
    [value],
  );

  function addKey(rawKey: string) {
    const k = rawKey.trim().toLowerCase();
    if (!k) return;
    if (!KEY_REGEX.test(k)) {
      toast.error('Atributo inválido: usá solo letras, números y "_" (empezando por letra)');
      return;
    }
    if (lowercased.has(k)) {
      toast.error(`Ya agregaste el atributo "${k}"`);
      return;
    }
    onChange([...value, k]);
    setDraft('');
  }

  function removeKey(key: string) {
    onChange(value.filter((k) => k !== key));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKey(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      // UX nice-to-have: borra el último chip si el input está vacío.
      removeKey(value[value.length - 1]);
    }
  }

  const availableSuggestions = SUGGESTIONS.filter(
    (s) => !lowercased.has(s.toLowerCase()),
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white p-2 min-h-[44px]">
        {value.map((k) => (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700"
          >
            {k}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeKey(k)}
                className="rounded p-0.5 text-brand-500 hover:bg-brand-100 hover:text-brand-700"
                aria-label={`Quitar atributo ${k}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <input
          className="flex-1 min-w-[140px] border-0 bg-transparent px-1 text-sm outline-none placeholder:text-slate-400 disabled:bg-transparent"
          placeholder={value.length === 0 ? 'Agregar atributo... (ej. talle)' : 'Agregar otro...'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
      </div>

      {!disabled && availableSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500">Sugerencias:</span>
          {availableSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addKey(s)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              <Plus className="h-3 w-3" /> {s}
            </button>
          ))}
        </div>
      )}

      {value.length > 0 && (
        <p className="text-[11px] text-slate-500">
          Cada variante del producto va a tener un valor para {value.length === 1 ? 'este atributo' : 'estos atributos'}.
        </p>
      )}
    </div>
  );
}

