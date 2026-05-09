import { useCallback, useState } from 'react';

/**
 * Helpers reusables para tablas: estado de orden + función de ordenamiento.
 *
 * Filosofía: cada página declara los filtros que necesita con useState propio
 * (porque el shape es específico) y reutiliza acá lo común — orden y search.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K | null;
  direction: SortDirection;
}

export interface UseSortStateResult<K extends string> {
  sort: SortState<K>;
  toggle: (key: K) => void;
  set: (key: K | null, direction?: SortDirection) => void;
  clear: () => void;
}

/**
 * Hook de estado de orden con ciclo de 3 estados al togglear:
 *   sin orden → asc → desc → sin orden ...
 */
export function useSortState<K extends string>(
  initialKey: K | null = null,
  initialDirection: SortDirection = 'asc',
): UseSortStateResult<K> {
  const [sort, setSort] = useState<SortState<K>>({
    key: initialKey,
    direction: initialDirection,
  });

  const toggle = useCallback((key: K) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      return { key: null, direction: 'asc' };
    });
  }, []);

  const set = useCallback((key: K | null, direction: SortDirection = 'asc') => {
    setSort({ key, direction });
  }, []);

  const clear = useCallback(() => setSort({ key: null, direction: 'asc' }), []);

  return { sort, toggle, set, clear };
}

/**
 * Ordena un array por un getter. Maneja null/undefined al final, números
 * vs strings (localeCompare español para acentos), y direction.
 */
export function sortBy<T>(
  rows: T[],
  getter: (row: T) => string | number | boolean | null | undefined,
  direction: SortDirection,
): T[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    // null/undefined al final independientemente del sentido
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    if (typeof va === 'boolean' && typeof vb === 'boolean') {
      return (Number(va) - Number(vb)) * dir;
    }
    return String(va).localeCompare(String(vb), 'es', { numeric: true }) * dir;
  });
}
