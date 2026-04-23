# TrankaPOS

Punto de venta (POS) para kioskos — SaaS multi-tenant y multi-depósito.

## Stack

- React 18 + TypeScript + Vite
- TailwindCSS
- Zustand (estado)
- Dexie (IndexedDB, modo local)
- Supabase (stub preparado para producción)
- Recharts
- React Router v6

## Arquitectura

Toda la lógica de datos pasa por una interfaz única (`src/data/driver.ts`).
Hay dos implementaciones intercambiables:

- **`local`** — IndexedDB vía Dexie. No necesita internet ni servidor.
- **`supabase`** — stub en `src/data/supabase/driver.ts`, pendiente de completar al deployar.

El driver se elige por env var `VITE_DATA_DRIVER` (default: `local`).

Multi-tenant: cada cuenta crea un `tenant`. Todos los datos están scopeados por `tenantId`.
Multi-depósito: stock, caja y ventas se llevan por depósito. El usuario selecciona depósito activo en la sidebar.

## Desarrollo local

```bash
npm install
npm run dev
```

Abrí http://localhost:5173.

La primera vez siembra un tenant demo con:

- **Email:** `demo@trankapos.local`
- **Password:** `demo1234`

Dos depósitos (Sucursal Centro, Depósito) y 10 productos de ejemplo.

También podés crear una cuenta nueva desde `/signup`.

### Reset de datos

Los datos viven en IndexedDB. Para limpiar:

- DevTools → Application → IndexedDB → `trankapos` → Delete database
- Recargá la página y se reseedea.

## Funcionalidad incluida

- Login / signup (crea tenant + depósito + owner)
- POS: scanner de código de barras (F2), búsqueda, carrito, múltiples medios de pago (efectivo/débito/crédito/QR/transferencia), descuentos de línea y global, atajo F4 para cobrar, ticket no fiscal imprimible
- Productos: CRUD + categorías + stock inicial por depósito
- Stock: ajuste manual (sumar/restar o fijar), alertas de mínimo, filtro por depósito
- Transferencias entre depósitos
- Caja: apertura con monto inicial, movimientos (ingreso/egreso), cierre con arqueo y diferencia
- Ventas: historial, detalle, anulación (devuelve stock)
- Dashboard: ventas del día, ticket promedio, top productos 7d, stock crítico, gráfico 14d
- Reportes: por día, medio de pago, cajero, producto. Export CSV.
- Usuarios: roles owner / manager / cashier, permisos por ruta

## Deploy a producción (Supabase)

1. Crear proyecto Supabase.
2. Esquema SQL sugerido: replicar los tipos de `src/types/index.ts` como tablas con columna `tenant_id uuid not null`.
3. Activar RLS y crear políticas: `auth.jwt() ->> 'tenant_id' = tenant_id`.
4. Implementar `src/data/supabase/driver.ts` siguiendo la misma interfaz que `LocalDriver`.
5. En el cliente:
   ```bash
   VITE_DATA_DRIVER=supabase
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
6. Deploy del front a Vercel / Netlify / Cloudflare Pages.

La UI no cambia en absoluto — solo se enchufa el driver nuevo.

## Roadmap sugerido post-MVP

- Integración AFIP (factura electrónica A/B/C)
- Integración Mercado Pago / Modo (QR + confirmación automática)
- Cola offline de ventas con sync cuando vuelve internet (en modo Supabase)
- Impresora térmica vía WebUSB (ESC/POS)
- Productos con variantes / por peso (balanza)
- Cuentas corrientes de clientes
- Compras a proveedores
- Promociones (2x1, descuentos por categoría, combos)
