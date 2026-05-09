import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortState } from '@/lib/table';

/**
 * `<th>` clickeable que renderiza el label + flecha indicando estado de orden.
 *
 * Uso:
 *   <SortHeader column="price" label="Precio" sort={sort} onToggle={toggle} align="right" />
 */
export function SortHeader<K extends string>({
  column,
  label,
  sort,
  onToggle,
  align,
  className,
}: {
  column: K;
  label: string;
  sort: SortState<K>;
  onToggle: (key: K) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th
      onClick={() => onToggle(column)}
      className={cn(
        'cursor-pointer select-none px-4 py-3 transition hover:bg-slate-100',
        align === 'right' && 'text-right',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-slate-900' : 'text-slate-500',
        )}
      >
        {label}
        <Icon className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-40')} />
      </span>
    </th>
  );
}
