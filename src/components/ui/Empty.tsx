import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function Empty({ title, description, action }: Props) {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="halo-cyan pointer-events-none absolute left-1/2 top-0 h-32 w-32 -translate-x-1/2 -translate-y-1/2 opacity-50" />
      <div className="relative mb-3 rounded-full bg-ice p-3">
        <Inbox className="h-6 w-6 text-cyan" />
      </div>
      <h3 className="font-display text-base font-semibold text-navy">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
