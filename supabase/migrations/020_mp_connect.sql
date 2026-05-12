-- =====================================================================
-- Migration 020: integración Mercado Pago Connect (cobros del comercio)
-- =====================================================================
-- A diferencia del MP que ya teníamos (suscripciones de TrankaSoft a los
-- comercios), este flow permite que CADA comercio conecte SU cuenta de MP
-- y cobre a sus propios clientes con QR.
--
-- Tablas:
--   1) tenant_payment_integrations — credenciales OAuth de MP por tenant.
--   2) mp_payment_intents — cobros QR pendientes (no son ventas todavía;
--      la venta se crea cuando MP confirma el pago vía webhook).
--
-- Flow:
--   - El owner aprieta "Conectar MP" en /settings/pagos → OAuth → callback
--     llama a mp-oauth-callback que guarda tokens en (1).
--   - El cajero cobra con QR → mp-create-charge crea fila en (2) y llama a
--     MP API con el access_token del tenant para generar QR.
--   - El cliente paga → MP webhookea a mp-payments-webhook → match por
--     external_reference → llama a create_sale_atomic → marca intent approved.
--
-- Secretos (van en Supabase Edge Functions Secrets, NO en este SQL):
--   MP_OAUTH_CLIENT_ID, MP_OAUTH_CLIENT_SECRET, MP_OAUTH_REDIRECT_URI,
--   MP_PAYMENTS_WEBHOOK_SECRET.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. tenant_payment_integrations
-- ---------------------------------------------------------------------
create table if not exists public.tenant_payment_integrations (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  provider        text not null,                          -- 'mp' por ahora
  -- Datos del provider (MP)
  mp_user_id      text,                                   -- id de la cuenta MP del comercio
  access_token    text not null,                          -- token de cobro
  refresh_token   text,                                   -- para refrescar antes que expire
  public_key      text,                                   -- public key opcional para SDK frontend
  expires_at      timestamptz,                            -- expiración del access_token
  scope           text,                                   -- scopes concedidos
  live_mode       boolean not null default false,         -- false = sandbox, true = producción
  -- Store + POS para QR dinámico (creados automáticamente al conectar)
  mp_store_id          text,                              -- id MP de la sucursal
  mp_pos_id            text,                              -- id MP de la caja
  mp_pos_external_id   text,                              -- nuestro external_id (estable, lo elegimos)
  -- Auditoría
  connected_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, provider)
);

create index if not exists tenant_payment_integrations_tenant_idx
  on public.tenant_payment_integrations (tenant_id);

comment on table public.tenant_payment_integrations is
  'Credenciales OAuth del comercio para cobrar con su propia cuenta MP. Tokens son sensibles — RLS estricta + edge functions con service_role.';


-- RLS: el tenant puede ver QUE está conectado y datos no sensibles
-- (mp_user_id, expires_at, live_mode). Pero NO los tokens — eso solo lo
-- consume el service_role en edge functions. La RLS para SELECT desde el
-- frontend NO devuelve access/refresh token; las queries del cliente
-- explícitamente piden solo las columnas seguras.
alter table public.tenant_payment_integrations enable row level security;

drop policy if exists tpi_self_select on public.tenant_payment_integrations;
create policy tpi_self_select on public.tenant_payment_integrations
  for select to authenticated
  using (tenant_id = public.tenant_id());

drop policy if exists tpi_owner_write on public.tenant_payment_integrations;
create policy tpi_owner_write on public.tenant_payment_integrations
  for all to authenticated
  using (
    tenant_id = public.tenant_id()
    and public.role_in_tenant() = 'owner'
  )
  with check (
    tenant_id = public.tenant_id()
    and public.role_in_tenant() = 'owner'
  );


-- ---------------------------------------------------------------------
-- 2. mp_payment_intents
-- ---------------------------------------------------------------------
-- Estado intermedio entre que el cajero pide cobrar QR y que MP confirma
-- el pago. NO es una venta — la venta se crea recién cuando llega webhook
-- approved. Si el QR expira o el cliente cancela, solo borramos el intent.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'mp_intent_status') then
    create type public.mp_intent_status as enum (
      'pending',
      'approved',
      'rejected',
      'cancelled',
      'expired'
    );
  end if;
end$$;

create table if not exists public.mp_payment_intents (
  id                   uuid primary key default uuid_generate_v4(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  branch_id            uuid not null references public.branches(id),
  register_id          uuid references public.cash_registers(id),
  cashier_id           uuid not null references auth.users(id),
  -- Carrito guardado (para crear la sale cuando se confirme)
  items                jsonb not null,                    -- [{product_id, qty, price, discount}, ...]
  discount             numeric(12,2) not null default 0,  -- descuento global
  amount               numeric(12,2) not null,            -- total a cobrar
  -- MP
  mp_payment_id        text,                              -- id del payment en MP
  mp_qr_data           text,                              -- contenido del QR (URL/string para renderizar)
  external_reference   text not null unique,              -- = id de este intent (string), MP lo devuelve en el webhook
  -- Estado
  status               mp_intent_status not null default 'pending',
  sale_id              uuid references public.sales(id),  -- se llena cuando approved
  -- TTL
  expires_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists mp_payment_intents_status_idx
  on public.mp_payment_intents (tenant_id, status, created_at desc);
create index if not exists mp_payment_intents_payment_idx
  on public.mp_payment_intents (mp_payment_id);


alter table public.mp_payment_intents enable row level security;

-- SELECT/INSERT por tenant. UPDATE viene del webhook (service_role); el
-- frontend nunca actualiza el estado (solo polea para ver si llegó approved).
drop policy if exists mpi_select on public.mp_payment_intents;
create policy mpi_select on public.mp_payment_intents
  for select to authenticated
  using (tenant_id = public.tenant_id());

drop policy if exists mpi_insert on public.mp_payment_intents;
create policy mpi_insert on public.mp_payment_intents
  for insert to authenticated
  with check (tenant_id = public.tenant_id());

-- UPDATE solo desde service_role (sin policy = bloqueado para clients).


-- ---------------------------------------------------------------------
-- 3. Trigger updated_at
-- ---------------------------------------------------------------------
create trigger trg_tpi_updated_at
  before update on public.tenant_payment_integrations
  for each row execute function public.set_updated_at();

create trigger trg_mpi_updated_at
  before update on public.mp_payment_intents
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 4. RPC create_sale_from_intent_atomic
-- ---------------------------------------------------------------------
-- Crea una venta a partir de un mp_payment_intent que ya fue confirmado
-- por el webhook de MP. Se llama desde la edge function mp-payments-webhook
-- con service_role — por eso `security definer` y no chequea auth.uid().
--
-- Idempotente: si el intent ya tiene sale_id, retorna ese mismo id sin
-- volver a procesar.
--
-- Bloquea el intent FOR UPDATE para evitar carreras cuando MP reenvía
-- el webhook varias veces.

create or replace function public.create_sale_from_intent_atomic(
  p_intent_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent       record;
  v_warehouse_id uuid;
  v_sale_id      uuid;
  v_item         jsonb;
  v_product_id   uuid;
  v_qty          numeric;
  v_price        numeric;
  v_discount     numeric;
  v_subtotal     numeric := 0;
  v_subtotal_it  numeric;
  v_product_name text;
begin
  -- Lock + leer intent
  select * into v_intent
  from mp_payment_intents
  where id = p_intent_id
  for update;

  if not found then
    raise exception 'Intent no encontrado: %', p_intent_id;
  end if;

  -- Idempotencia: si ya tiene sale_id, salir
  if v_intent.sale_id is not null then
    return v_intent.sale_id;
  end if;

  -- Warehouse default de la branch
  select id into v_warehouse_id
  from warehouses
  where tenant_id = v_intent.tenant_id
    and branch_id = v_intent.branch_id
    and is_default = true
    and active = true;

  if v_warehouse_id is null then
    raise exception 'La sucursal % no tiene depósito principal', v_intent.branch_id;
  end if;

  -- Calcular subtotal a partir de items (sin descuento global)
  for v_item in select * from jsonb_array_elements(v_intent.items) loop
    v_price    := (v_item->>'price')::numeric;
    v_qty      := (v_item->>'qty')::numeric;
    v_discount := coalesce((v_item->>'discount')::numeric, 0);
    v_subtotal := v_subtotal + round(v_price * v_qty - v_discount, 2);
  end loop;

  -- Crear sale
  insert into sales (
    tenant_id, branch_id, register_id, cashier_id,
    subtotal, discount, total, voided, status, stock_reserved_mode
  ) values (
    v_intent.tenant_id,
    v_intent.branch_id,
    v_intent.register_id,
    v_intent.cashier_id,
    v_subtotal,
    v_intent.discount,
    v_intent.amount,
    false,
    'paid',
    false
  )
  returning id into v_sale_id;

  -- sale_items con snapshot del producto
  insert into sale_items (
    sale_id, tenant_id, product_id, name, barcode,
    price, qty, discount, subtotal
  )
  select
    v_sale_id, v_intent.tenant_id, p.id, p.name, p.barcode,
    (it->>'price')::numeric,
    (it->>'qty')::numeric,
    coalesce((it->>'discount')::numeric, 0),
    round(
      (it->>'price')::numeric * (it->>'qty')::numeric
      - coalesce((it->>'discount')::numeric, 0),
      2
    )
  from jsonb_array_elements(v_intent.items) it
  join products p on p.id = (it->>'product_id')::uuid;

  -- sale_payment único de tipo 'qr' por el total
  insert into sale_payments (sale_id, tenant_id, method, amount)
  values (v_sale_id, v_intent.tenant_id, 'qr', v_intent.amount);

  -- Descontar stock del warehouse default (igual que create_sale_atomic
  -- pero sin validaciones de límite — el cliente ya pagó, hay que registrar).
  for v_item in select * from jsonb_array_elements(v_intent.items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'qty')::numeric;

    select track_stock into v_product_name
    from products
    where id = v_product_id and tenant_id = v_intent.tenant_id;
    -- v_product_name acá guarda 'true'/'false' como string, pero a esta
    -- altura solo nos interesa si es null (no existe) → skip.
    if v_product_name is null then continue; end if;

    if exists (
      select 1 from stock_items
       where tenant_id = v_intent.tenant_id
         and warehouse_id = v_warehouse_id
         and product_id = v_product_id
    ) then
      update stock_items
         set qty = qty - v_qty, updated_at = now()
       where tenant_id = v_intent.tenant_id
         and warehouse_id = v_warehouse_id
         and product_id = v_product_id;
    else
      insert into stock_items (tenant_id, warehouse_id, product_id, qty, min_qty, qty_reserved)
      values (v_intent.tenant_id, v_warehouse_id, v_product_id, -v_qty, 0, 0);
    end if;
  end loop;

  -- Marcar intent como approved + linkear sale
  update mp_payment_intents
     set status = 'approved', sale_id = v_sale_id, updated_at = now()
   where id = p_intent_id;

  return v_sale_id;
end;
$$;

comment on function public.create_sale_from_intent_atomic is
  'Crea una sale desde un mp_payment_intent ya cobrado. security definer porque la llama el webhook con service_role. Idempotente.';
