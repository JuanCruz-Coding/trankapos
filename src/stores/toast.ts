// Wrapper sobre react-hot-toast manteniendo la API previa para no tocar
// todos los imports (toast.success/error/info siguen funcionando igual).
// El componente <Toaster /> de react-hot-toast se monta en App.tsx.

import rtoast from 'react-hot-toast';

export const toast = {
  success: (m: string) => rtoast.success(m),
  error: (m: string) => rtoast.error(m),
  info: (m: string) =>
    rtoast(m, {
      icon: 'ℹ️',
      style: { background: '#0ea5e9', color: '#fff' },
    }),
};
