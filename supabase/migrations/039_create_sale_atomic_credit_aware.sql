-- =====================================================================
-- Migration 039: create_sale_atomic con soporte de pago "on_account"
-- =====================================================================
-- Sprint FIA. Cuando un pago de la venta usa method='on_account', al
-- final de la transacción:
--   1) Valida que credit_sales_enabled=true en el tenant.
--   2) Valida que customer_id esté presente (no se puede fiar anónimo).
--   3) Valida el límite del cliente (validate_customer_credit_limit).
--   4) Registra el movement negativo en customer_credits con
--      reason='fiado', amount=-X, related_sale_id=v_sale_id.
--
-- Si cualquier paso falla, la transacción se aborta y la venta no se crea.
-- =====================================================================

drop function if exists public.create_sale_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, boolean, uuid, smallint, text, text, text);

create function public.create_sale_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_register_id uuid,
  p_discount numeric,
  p_items jsonb,
  p_payments jsonb,
  p_partial boolean,
  p_customer_id uuid,
  p_customer_doc_type smallint,
  p_customer_doc_number text,
  p_customer_legal_name text,
  p_customer_iva_condition text
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sale_id            uuid;
  v_warehouse_id       uuid;
  v_subtotal           numeric := 0;
  v_total              numeric;
  v_paid               numeric := 0;
  v_on_account         numeric := 0;
  v_user_id            uuid := auth.uid();
  v_item               jsonb;
  v_payment            jsonb;
  v_product_id         uuid;
  v_variant_id         uuid;
  v_qty                numeric;
  v_price              numeric;
  v_item_discount      numeric;
  v_subtotal_item      numeric;
  v_product_name       text;
  v_variant_attrs      jsonb;
  v_track_stock        boolean;
  v_allow_zero         boolean;
  v_stock_qty          numeric;
  v_stock_reserved     numeric;
  v_available          numeric;
  v_max_discount_pct   numeric;
  v_allow_negative     boolean;
  v_partial_reserves   boolean;
  v_credit_enabled     boolean;
  v_line_pct           numeric;
  v_global_pct         numeric;
  v_status             sale_status;
  v_stock_mode         boolean;
  v_cust_doc_type      smallint;
  v_cust_doc_number    text;
  v_cust_legal_name    text;
  v_cust_iva_cond      text;
  v_credit_check       record;
begin
  if p_tenant_id <> public.tenant_id() then
    raise exception 'El tenant_id no coincide con la sesión actual' using errcode = '42501';
  end if;
  if v_user_id is null then
    raise exception 'Sesión inválida' using errcode = '42501';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;
  if coalesce(p_discount, 0) < 0 then
    raise exception 'El descuento global no puede ser negativo';
  end if;

  if p_customer_id is not null then
    select doc_type, doc_number, legal_name, iva_condition
      into v_cust_doc_type, v_cust_doc_number, v_cust_legal_name, v_cust_iva_cond
      from customers
     where id = p_customer_id and tenant_id = p_tenant_id and active;
    if v_cust_doc_type is null then
      raise exception 'Cliente no encontrado o inactivo';
    end if;
    v_cust_doc_type   := coalesce(p_customer_doc_type, v_cust_doc_type);
    v_cust_doc_number := coalesce(p_customer_doc_number, v_cust_doc_number);
    v_cust_legal_name := coalesce(p_customer_legal_name, v_cust_legal_name);
    v_cust_iva_cond   := coalesce(p_customer_iva_condition, v_cust_iva_cond);
  elsif p_customer_doc_number is not null or p_customer_legal_name is not null then
    v_cust_doc_type   := p_customer_doc_type;
    v_cust_doc_number := p_customer_doc_number;
    v_cust_legal_name := p_customer_legal_name;
    v_cust_iva_cond   := p_customer_iva_condition;
    if v_cust_doc_type is not null and v_cust_doc_type not in (80, 86, 96) then
      raise exception 'Tipo de documento inválido para el receptor';
    end if;
    if v_cust_doc_number is not null and v_cust_doc_number !~ '^[0-9]+$' then
      raise exception 'Número de documento inválido (solo dígitos)';
    end if;
  end if;

  select pos_max_discount_percent, pos_allow_negative_stock, pos_partial_reserves_stock,
         credit_sales_enabled
    into v_max_discount_pct, v_allow_negative, v_partial_reserves, v_credit_enabled
    from tenants
   where id = p_tenant_id;

  v_stock_mode := coalesce(p_partial, false) and coalesce(v_partial_reserves, false);

  select id into v_warehouse_id
    from warehouses
   where tenant_id = p_tenant_id
     and branch_id = p_branch_id
     and is_default = true
     and active = true;
  if v_warehouse_id is null then
    raise exception 'La sucursal no tiene un depósito principal configurado';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id    := (v_item->>'product_id')::uuid;
    v_variant_id    := nullif(v_item->>'variant_id', '')::uuid;
    v_qty           := (v_item->>'qty')::numeric;
    v_price         := (v_item->>'price')::numeric;
    v_item_discount := coalesce((v_item->>'discount')::numeric, 0);

    if v_qty <= 0 then raise exception 'Cantidad inválida (debe ser > 0)'; end if;
    if v_price < 0 then raise exception 'Precio inválido (debe ser >= 0)'; end if;
    if v_item_discount < 0 then raise exception 'Descuento de línea inválido'; end if;

    if v_price * v_qty > 0 then
      v_line_pct := (v_item_discount / (v_price * v_qty)) * 100;
      if v_line_pct > v_max_discount_pct then
        raise exception 'El descuento de línea (%.2f%%) supera el tope del comercio (%.2f%%)',
          v_line_pct, v_max_discount_pct;
      end if;
    end if;

    v_subtotal_item := round(v_price * v_qty - v_item_discount, 2);
    if v_subtotal_item < 0 then
      raise exception 'El descuento de una línea supera el subtotal';
    end if;
    v_subtotal := v_subtotal + v_subtotal_item;

    select track_stock, allow_sale_when_zero, name
      into v_track_stock, v_allow_zero, v_product_name
      from products
     where id = v_product_id and tenant_id = p_tenant_id;
    if v_product_name is null then
      raise exception 'Producto no encontrado';
    end if;

    if v_variant_id is null then
      select id, attributes into v_variant_id, v_variant_attrs
        from product_variants
       where product_id = v_product_id and is_default = true;
      if v_variant_id is null then
        raise exception 'Producto sin variante default (estado inconsistente post-030)';
      end if;
    else
      select attributes into v_variant_attrs
        from product_variants
       where id = v_variant_id and product_id = v_product_id and tenant_id = p_tenant_id;
      if v_variant_attrs is null then
        raise exception 'Variante % no encontrada o no pertenece al producto', v_variant_id;
      end if;
    end if;

    if v_track_stock then
      select coalesce(qty, 0), coalesce(qty_reserved, 0)
        into v_stock_qty, v_stock_reserved
        from stock_items
       where tenant_id = p_tenant_id and warehouse_id = v_warehouse_id and variant_id = v_variant_id;

      v_available := coalesce(v_stock_qty, 0) - coalesce(v_stock_reserved, 0);

      if not v_allow_zero and not v_allow_negative and v_available < v_qty then
        raise exception 'Stock insuficiente para %', v_product_name;
      end if;

      if v_stock_mode then
        if exists (select 1 from stock_items where tenant_id = p_tenant_id and warehouse_id = v_warehouse_id and variant_id = v_variant_id) then
          update stock_items set qty_reserved = coalesce(qty_reserved, 0) + v_qty, updated_at = now()
           where tenant_id = p_tenant_id and warehouse_id = v_warehouse_id and variant_id = v_variant_id;
        else
          insert into stock_items (tenant_id, warehouse_id, product_id, variant_id, qty, min_qty, qty_reserved)
          values (p_tenant_id, v_warehouse_id, v_product_id, v_variant_id, 0, 0, v_qty);
        end if;
      else
        if exists (select 1 from stock_items where tenant_id = p_tenant_id and warehouse_id = v_warehouse_id and variant_id = v_variant_id) then
          update stock_items set qty = qty - v_qty, updated_at = now()
           where tenant_id = p_tenant_id and warehouse_id = v_warehouse_id and variant_id = v_variant_id;
        else
          insert into stock_items (tenant_id, warehouse_id, product_id, variant_id, qty, min_qty)
          values (p_tenant_id, v_warehouse_id, v_product_id, v_variant_id, -v_qty, 0);
        end if;
      end if;
    end if;
  end loop;

  v_total := round(v_subtotal - coalesce(p_discount, 0), 2);
  if v_total < 0 then raise exception 'El descuento global supera el subtotal'; end if;

  if v_subtotal > 0 then
    v_global_pct := (coalesce(p_discount, 0) / v_subtotal) * 100;
    if v_global_pct > v_max_discount_pct then
      raise exception 'El descuento global (%.2f%%) supera el tope del comercio (%.2f%%)',
        v_global_pct, v_max_discount_pct;
    end if;
  end if;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_paid := v_paid + (v_payment->>'amount')::numeric;
    if (v_payment->>'method') = 'on_account' then
      v_on_account := v_on_account + (v_payment->>'amount')::numeric;
    end if;
  end loop;

  if v_on_account > 0 then
    if not coalesce(v_credit_enabled, false) then
      raise exception 'La venta a cuenta corriente no está habilitada para este comercio';
    end if;
    if p_customer_id is null then
      raise exception 'Para fiar (cuenta corriente) se requiere identificar al cliente';
    end if;
    select * into v_credit_check from public.validate_customer_credit_limit(
      p_tenant_id, p_customer_id, v_on_account
    );
    if not v_credit_check.ok then
      raise exception '%', v_credit_check.reason;
    end if;
  end if;

  if coalesce(p_partial, false) then
    if v_paid <= 0 then raise exception 'Una seña debe tener al menos un pago'; end if;
    if v_paid > v_total then
      raise exception 'El pago de la seña (%) no puede superar el total (%)', v_paid, v_total;
    end if;
    if abs(v_paid - v_total) <= 0.005 then
      v_status := 'paid'; v_stock_mode := false;
    else
      v_status := 'partial';
    end if;
  else
    if abs(v_paid - v_total) > 0.005 then
      raise exception 'Pagos (%) no coinciden con total (%)', v_paid, v_total;
    end if;
    v_status := 'paid';
  end if;

  insert into sales (
    tenant_id, branch_id, register_id, cashier_id,
    subtotal, discount, total, voided, status, stock_reserved_mode,
    customer_id, customer_doc_type, customer_doc_number,
    customer_legal_name, customer_iva_condition
  ) values (
    p_tenant_id, p_branch_id, p_register_id, v_user_id,
    v_subtotal, coalesce(p_discount, 0), v_total, false, v_status, v_stock_mode,
    p_customer_id, v_cust_doc_type, v_cust_doc_number,
    v_cust_legal_name, v_cust_iva_cond
  ) returning id into v_sale_id;

  insert into sale_items (
    sale_id, tenant_id, product_id, variant_id, name, barcode,
    price, qty, discount, subtotal
  )
  select
    v_sale_id, p_tenant_id, p.id,
    coalesce(
      nullif(it->>'variant_id', '')::uuid,
      (select id from product_variants where product_id = p.id and is_default = true)
    ),
    p.name, p.barcode,
    (it->>'price')::numeric,
    (it->>'qty')::numeric,
    coalesce((it->>'discount')::numeric, 0),
    round(
      (it->>'price')::numeric * (it->>'qty')::numeric
      - coalesce((it->>'discount')::numeric, 0),
      2
    )
  from jsonb_array_elements(p_items) it
  join products p on p.id = (it->>'product_id')::uuid;

  insert into sale_payments (sale_id, tenant_id, method, amount)
  select v_sale_id, p_tenant_id,
         (pay->>'method')::payment_method,
         (pay->>'amount')::numeric
    from jsonb_array_elements(p_payments) pay;

  -- Sprint FIA: si hubo pago on_account, registrar el movement de fiado
  if v_on_account > 0 then
    perform public.apply_customer_credit_movement(
      p_tenant_id        := p_tenant_id,
      p_customer_id      := p_customer_id,
      p_amount           := -v_on_account,
      p_reason           := 'fiado',
      p_related_sale_id  := v_sale_id,
      p_related_doc_id   := null,
      p_notes            := null,
      p_created_by       := v_user_id,
      p_expires_at       := null
    );
  end if;

  return v_sale_id;
end;
$fn$;
