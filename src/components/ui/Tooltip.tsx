import type { ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

/**
 * Tooltip rápido — CSS puro, sin JS. Aparece al instante al hacer hover
 * (a diferencia del `title` nativo que tarda ~1s). Envolvé el elemento
 * disparador. Pensado para íconos de acción donde el texto no es obvio.
 */
export function Tooltip({ label, children }: Props) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
