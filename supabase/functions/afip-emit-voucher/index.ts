// =====================================================================
// Edge Function: afip-emit-voucher
// =====================================================================
// Emite una Factura A/B/C para una sale del POS.
//
// Body:
//   { saleId: string }
//
// Sprint A5a: la lógica de emisión se extrajo a _shared/afip-emit-core.ts
// (emitVoucherForSale). Este archivo quedó como SHELL: CORS + auth del
// caller + parseo del body + leer AFIP_VAULT_KEY + crear admin client →
// delega en emitVoucherForSale. El comportamiento externo es idéntico al
// anterior (mismo body, misma respuesta).
//
// Errores de validación (body inválido, auth) → HTTP 400/401/403.
// Resultado de emisión → HTTP 200 con { ok, ... } (EmitResult).
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { emitVoucherForSale } from '../_shared/afip-emit-core.ts';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

interface Body {
  saleId: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : 'https://pos.trankasoft.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  function jsonResponse(body: unknown, status: number) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body.saleId) return jsonResponse({ error: 'Falta saleId' }, 400);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Falta Authorization header' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return jsonResponse({ error: 'No autenticado' }, 401);
    const callerId = userRes.user.id;

    const { data: mem } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', callerId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (!mem) return jsonResponse({ error: 'No autorizado' }, 403);
    const tenantId = mem.tenant_id;

    const encryptionKey = Deno.env.get('AFIP_VAULT_KEY');
    if (!encryptionKey || encryptionKey.length < 16) {
      return jsonResponse({ error: 'Servidor sin AFIP_VAULT_KEY' }, 500);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    return jsonResponse(
      await emitVoucherForSale(admin, tenantId, body.saleId, encryptionKey),
      200,
    );
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
