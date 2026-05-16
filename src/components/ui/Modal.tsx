import { useEffect, type PropsWithChildren } from 'react';
import { X } from 'lucide-react';

interface Props extends PropsWithChildren {
  open: boolean;
  onClose: () => void;
  title?: string;
  widthClass?: string;
}

export function Modal({ open, onClose, title, widthClass = 'max-w-lg', children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 sm:items-center">
      <div
        className={`flex w-full ${widthClass} max-h-[calc(100vh-2rem)] flex-col rounded-xl bg-white shadow-xl`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
