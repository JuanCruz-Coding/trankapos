// Helpers de diálogo basados en SweetAlert2. Usados para reemplazar el
// confirm() nativo del browser por algo más prolijo y consistente.
//
// Uso típico:
//   if (!await confirmDialog('¿Eliminar producto?')) return;

import Swal from 'sweetalert2';

export async function confirmDialog(
  title: string,
  options: {
    text?: string;
    confirmText?: string;
    cancelText?: string;
    /** 'warning' es lo que más usamos para deletes; 'question' para neutros. */
    icon?: 'warning' | 'question' | 'info';
    /** Si es true, el botón confirmar va en rojo (peligroso). */
    danger?: boolean;
  } = {},
): Promise<boolean> {
  const result = await Swal.fire({
    title,
    text: options.text,
    icon: options.icon ?? 'warning',
    showCancelButton: true,
    confirmButtonText: options.confirmText ?? 'Aceptar',
    cancelButtonText: options.cancelText ?? 'Cancelar',
    reverseButtons: true,
    confirmButtonColor: options.danger ? '#dc2626' : '#0d9488',
    cancelButtonColor: '#64748b',
  });
  return result.isConfirmed;
}

export async function alertDialog(
  title: string,
  text?: string,
  icon: 'success' | 'error' | 'info' | 'warning' = 'info',
): Promise<void> {
  await Swal.fire({ title, text, icon, confirmButtonColor: '#0d9488' });
}
