import { useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Boxes,
  HelpCircle,
  LayoutDashboard,
  LogIn,
  Package,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';

interface Section {
  id: string;
  title: string;
  icon: typeof BookOpen;
  summary: string;
  steps: { title: string; detail: string }[];
  tips?: string[];
  roles?: string;
}

const sections: Section[] = [
  {
    id: 'intro',
    title: 'Primeros pasos',
    icon: BookOpen,
    summary:
      'TrankaPOS es un punto de venta pensado para comercios con uno o varios depósitos. Todos los datos se guardan en tu dispositivo.',
    steps: [
      {
        title: 'Crear una cuenta',
        detail:
          'Desde la pantalla de inicio elegí "Crear cuenta" y completá los datos del comercio. El primer usuario se registra como dueño (owner) y puede administrar todo.',
      },
      {
        title: 'Iniciar sesión',
        detail:
          'Ingresá con tu email y contraseña. Si olvidás tu clave, un usuario con rol de dueño puede reiniciarla desde Usuarios.',
      },
      {
        title: 'Elegir el depósito activo',
        detail:
          'El selector "Depósito activo" del panel lateral determina sobre qué depósito se cargan ventas, stock y movimientos de caja.',
      },
    ],
    tips: [
      'Todas las operaciones quedan ligadas al depósito activo: asegurate de elegir el correcto antes de vender.',
    ],
  },
  {
    id: 'pos',
    title: 'Vender (POS)',
    icon: ShoppingCart,
    summary:
      'La pantalla principal para facturar. Buscá productos, armá el ticket y cobrá en uno o varios medios de pago.',
    steps: [
      {
        title: 'Abrir la caja',
        detail:
          'Antes de vender necesitás tener una caja abierta en el depósito activo. Si no hay caja abierta, el sistema te avisa y te pide abrir una desde "Caja".',
      },
      {
        title: 'Agregar productos',
        detail:
          'Escaneá el código de barras o buscá por nombre. También podés tocar el producto en la grilla para sumarlo al ticket. Usá F2 para volver rápido al lector.',
      },
      {
        title: 'Ajustar cantidades y descuentos',
        detail:
          'En cada línea podés modificar la cantidad, aplicar un descuento por ítem o quitar el producto. También hay un descuento global al pie del ticket.',
      },
      {
        title: 'Cobrar',
        detail:
          'Apretá "Cobrar", elegí uno o más medios de pago (efectivo, débito, crédito, transferencia, QR) y confirmá. Se imprime el comprobante y se descuenta stock automáticamente.',
      },
    ],
    tips: [
      'El botón "Imprimir" reimprime el último ticket emitido.',
      'Si un producto no tiene stock suficiente en el depósito activo, el POS lo señala en rojo.',
    ],
  },
  {
    id: 'products',
    title: 'Productos',
    icon: Package,
    summary:
      'Gestiona el catálogo: nombre, precio, código de barras, categoría y estado activo/inactivo.',
    steps: [
      {
        title: 'Alta de producto',
        detail:
          'Tocá "Nuevo" y completá nombre, precio de venta, costo opcional, código de barras y categoría. Podés marcarlo como inactivo si no querés venderlo por ahora.',
      },
      {
        title: 'Editar o dar de baja',
        detail:
          'Desde la lista, tocá el producto para editarlo. Dar de baja no borra el historial: solo lo oculta del POS.',
      },
      {
        title: 'Buscar productos',
        detail: 'Usá la barra de búsqueda por nombre o código. También podés filtrar por categoría.',
      },
    ],
  },
  {
    id: 'stock',
    title: 'Stock',
    icon: Boxes,
    summary:
      'Controlá las unidades disponibles en cada depósito y configurá stock mínimo para alertas.',
    steps: [
      {
        title: 'Ajuste manual',
        detail:
          'Cuando recibís mercadería o encontrás diferencias, hacé un ajuste indicando cantidad y motivo. Queda registrado en el historial.',
      },
      {
        title: 'Stock mínimo',
        detail:
          'Definí un mínimo por producto y depósito. Cuando el stock baje a ese valor, aparece en la alerta "Stock crítico" del Dashboard.',
      },
    ],
    tips: [
      'El stock se descuenta automáticamente al confirmar una venta y vuelve al stock si anulás la venta.',
    ],
  },
  {
    id: 'transfers',
    title: 'Transferencias',
    icon: TrendingUp,
    roles: 'Solo dueño y encargado',
    summary: 'Movimiento de mercadería entre depósitos.',
    steps: [
      {
        title: 'Nueva transferencia',
        detail:
          'Elegí depósito de origen y destino, agregá los productos con su cantidad y confirmá. Se descuenta del origen y se suma al destino.',
      },
      {
        title: 'Notas y seguimiento',
        detail: 'Podés dejar notas para identificar el envío. El listado muestra todas las transferencias con su fecha.',
      },
    ],
  },
  {
    id: 'cash',
    title: 'Caja',
    icon: Wallet,
    summary: 'Apertura, cierre y movimientos de caja por depósito.',
    steps: [
      {
        title: 'Apertura de caja',
        detail:
          'Al comenzar la jornada, abrí la caja declarando el monto inicial en efectivo. Sin caja abierta no se pueden registrar ventas.',
      },
      {
        title: 'Ingresos y egresos',
        detail:
          'Registrá movimientos que no son ventas: retiros para gastos, aportes, etc. Cada movimiento queda asociado a la caja abierta.',
      },
      {
        title: 'Cierre de caja',
        detail:
          'Al cerrar, el sistema muestra el total esperado (apertura + ventas en efectivo + ingresos − egresos). Ingresá el conteo real y el sistema calcula la diferencia.',
      },
    ],
    tips: [
      'El cierre de caja queda guardado y se puede consultar desde el historial en la misma pantalla.',
    ],
  },
  {
    id: 'sales',
    title: 'Ventas',
    icon: Receipt,
    summary: 'Listado de todas las ventas emitidas, con filtros por fecha, depósito y estado.',
    steps: [
      {
        title: 'Consultar detalle',
        detail:
          'Tocá una venta para ver los ítems, medios de pago y estado. Desde ahí podés reimprimir el ticket.',
      },
      {
        title: 'Anular una venta',
        detail:
          'Si necesitás anular, hacelo desde el detalle. La venta queda marcada como anulada y se devuelve el stock. El dinero se registra como egreso al cerrar caja si fue en efectivo.',
      },
    ],
  },
  {
    id: 'reports',
    title: 'Reportes',
    icon: BarChart3,
    roles: 'Solo dueño y encargado',
    summary: 'Métricas de ventas por día, producto y medio de pago.',
    steps: [
      {
        title: 'Elegir período',
        detail: 'Usá los accesos rápidos (hoy, 7 días, 30 días) o un rango personalizado.',
      },
      {
        title: 'Analizar resultados',
        detail:
          'Se muestran totales, cantidad de tickets, ticket promedio, evolución diaria, productos más vendidos y distribución por medio de pago.',
      },
    ],
  },
  {
    id: 'branches',
    title: 'Sucursales y depósitos',
    icon: Store,
    roles: 'Solo dueño y encargado',
    summary: 'Sucursales (puntos de venta) y depósitos (donde vive el stock).',
    steps: [
      {
        title: 'Nueva sucursal',
        detail:
          'Cada sucursal tiene cajas, ventas y al menos un depósito principal. Al crearla se genera automáticamente su depósito principal con el mismo nombre.',
      },
      {
        title: 'Múltiples depósitos por sucursal',
        detail:
          'En planes Pro y Empresa podés agregar más depósitos por sucursal (ej. mostrador + trastienda). El POS resta del depósito principal; los otros se mueven con transferencias.',
      },
      {
        title: 'Asignar usuarios',
        detail:
          'Desde Usuarios podés vincular cada operador a una sucursal específica.',
      },
    ],
  },
  {
    id: 'users',
    title: 'Usuarios',
    icon: Users,
    roles: 'Solo dueño y encargado',
    summary: 'Administración de usuarios y roles del sistema.',
    steps: [
      {
        title: 'Roles disponibles',
        detail:
          'Dueño (owner): acceso total. Encargado (manager): todo menos administrar otros dueños. Cajero (cashier): vender y operar caja únicamente.',
      },
      {
        title: 'Crear usuario',
        detail:
          'Completá nombre, email, contraseña inicial y rol. El usuario podrá cambiar su contraseña al ingresar.',
      },
      {
        title: 'Resetear contraseña',
        detail:
          'Desde la lista, un dueño puede restablecer la contraseña de cualquier usuario.',
      },
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    summary: 'Panel de control con los indicadores clave del día.',
    steps: [
      {
        title: 'Indicadores del día',
        detail:
          'Ventas totales, cantidad de tickets, ticket promedio y productos con stock crítico.',
      },
      {
        title: 'Gráficos',
        detail:
          'Ventas de los últimos 14 días, top de productos más vendidos en la última semana y listado de productos con stock bajo.',
      },
    ],
  },
];

const faq = [
  {
    q: '¿Puedo usar TrankaPOS sin internet?',
    a: 'Sí. La aplicación guarda todo en el dispositivo. Sincronización con la nube no está disponible en esta versión.',
  },
  {
    q: '¿Cómo hago un backup?',
    a: 'Los datos viven en el navegador del dispositivo. Consultá con soporte para exportar un respaldo manual.',
  },
  {
    q: 'Se me olvidó abrir caja y vendí, ¿qué hago?',
    a: 'No se pueden registrar ventas sin caja abierta. Abrí la caja con el monto real del cajón y luego registrá las ventas que faltan.',
  },
  {
    q: 'Un cajero no ve la opción de Reportes o Depósitos',
    a: 'Es correcto: esas secciones son exclusivas para los roles dueño y encargado.',
  },
  {
    q: '¿Cómo cambio el depósito activo?',
    a: 'Con el selector al pie del menú lateral. Todos los movimientos se hacen sobre ese depósito hasta que lo cambies.',
  },
];

export default function Help() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string>(sections[0].id);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      if (s.summary.toLowerCase().includes(q)) return true;
      if (s.steps.some((st) => st.title.toLowerCase().includes(q) || st.detail.toLowerCase().includes(q))) return true;
      if (s.tips?.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query]);

  return (
    <div>
      <PageHeader
        title="Ayuda"
        subtitle="Manual de uso de TrankaPOS"
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Buscar en el manual..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className="lg:sticky lg:top-0 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-brand-600" />
                Secciones
              </CardTitle>
            </CardHeader>
            <CardBody className="p-2">
              <ul className="space-y-1">
                {filtered.map((s) => {
                  const Icon = s.icon;
                  return (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        onClick={() => setActive(s.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                          active === s.id
                            ? 'bg-brand-50 text-brand-700'
                            : 'text-slate-600 hover:bg-slate-100',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {s.title}
                      </a>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="px-3 py-4 text-sm text-slate-400">Sin resultados</li>
                )}
              </ul>
            </CardBody>
          </Card>
        </aside>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardBody className="flex gap-3">
              <div className="shrink-0 rounded-lg bg-brand-50 p-2 text-brand-700">
                <LogIn className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-slate-900">Bienvenido a TrankaPOS</div>
                <p className="mt-1 text-sm text-slate-600">
                  Esta guía explica paso a paso cómo operar el sistema: vender, manejar stock,
                  caja, reportes y administración. Usá el buscador para saltar a un tema puntual.
                </p>
              </div>
            </CardBody>
          </Card>

          {filtered.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.id} id={s.id} className="scroll-mt-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-brand-600" />
                    {s.title}
                    {s.roles && (
                      <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {s.roles}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                  <p className="text-sm text-slate-600">{s.summary}</p>

                  <ol className="space-y-3">
                    {s.steps.map((st, i) => (
                      <li key={st.title} className="flex gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                          {i + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{st.title}</div>
                          <div className="text-sm text-slate-600">{st.detail}</div>
                        </div>
                      </li>
                    ))}
                  </ol>

                  {s.tips && s.tips.length > 0 && (
                    <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3">
                      <div className="mb-1 text-xs font-semibold uppercase text-brand-700">
                        Tips
                      </div>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {s.tips.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}

          <Card id="faq" className="scroll-mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-brand-600" />
                Preguntas frecuentes
              </CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="divide-y divide-slate-100">
                {faq.map((f) => (
                  <div key={f.q} className="py-3 first:pt-0 last:pb-0">
                    <dt className="text-sm font-semibold text-slate-900">{f.q}</dt>
                    <dd className="mt-1 text-sm text-slate-600">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
