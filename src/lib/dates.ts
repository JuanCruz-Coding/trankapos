import { format, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';

export function formatDateTime(iso: string): string {
  return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: es });
}

export function formatDate(iso: string): string {
  return format(new Date(iso), 'dd/MM/yyyy', { locale: es });
}

export function formatTime(iso: string): string {
  return format(new Date(iso), 'HH:mm', { locale: es });
}

export type RangePreset = 'today' | '7d' | '30d' | 'week' | 'month';

export function rangeFromPreset(preset: RangePreset): { from: Date; to: Date } {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case '7d':
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case '30d':
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case 'week':
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'month':
      return { from: startOfMonth(now), to: endOfMonth(now) };
  }
}

export function dayKey(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd');
}
