// =====================================================================
// Edge Function: mp-oauth-callback
// =====================================================================
// 1. Recibe el ?code= que MP envía al redirect_uri tras autorizar.
// 2. Intercambia el code por access_token + refresh_token.
// 3. Crea (o reutiliza) un store + pos en la cuenta MP del comercio
//    — pre-requisito obligatorio para generar QR dinámico.
// 4. Guarda todo en tenant_payment_integrations.
//
// Body esperado: { code: string }
// El JWT del caller identifica al user → debe ser owner del tenant.
//
// Secrets requeridos en Supabase Edge Functions:
//   MP_OAUTH_CLIENT_ID, MP_OAUTH_CLIENT_SECRET, MP_OAUTH_REDIRECT_URI
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = ['https://pos.trankasoft.com', 'http://localhost:5173'];

interface Body {
  code: string;
}

interface MPTokenResponse {
  access_token: string;
  refresh_token: string;
  public_key: string;
  user_id: number;
  expires_in: number;
  scope: string;
  live_mode: boolean;
  token_type: string;
}

interface MPStore {
  id: string | number;
  name?: string;
}

interface MPPos {
  id: string | number;
  external_id?: string;
  name?: string;
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

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code } = (await req.json()) as Body;
    if (!code) return jsonResponse({ error: 'Falta el code' }, 400);

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

    const { data: callerMem, error: memErr } = await userClient
      .from('memberships')
      .select('tenant_id, role')
      .eq('user_id', callerId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (memErr || !callerMem) {
      return jsonResponse({ error: 'No se encontró membership del caller' }, 403);
    }
    if (callerMem.role !== 'owner') {
      return jsonResponse({ error: 'Solo el owner puede conectar Mercado Pago' }, 403);
    }
    const tenantId = callerMem.tenant_id;

    // 1. Intercambiar code por tokens
    const clientId = Deno.env.get('MP_OAUTH_CLIENT_ID');
    const clientSecret = Deno.env.get('MP_OAUTH_CLIENT_SECRET');
    const redirectUri = Deno.env.get('MP_OAUTH_REDIRECT_URI');
    if (!clientId || !clientSecret || !redirectUri) {
      return jsonResponse({ error: 'Servidor sin configuración de MP.' }, 500);
    }

    const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => '');
      return jsonResponse(
        { error: `MP rechazó el code: HTTP ${tokenRes.status} ${errBody.slice(0, 200)}` },
        400,
      );
    }
    const mpTokens = (await tokenRes.json()) as MPTokenResponse;
    const mpUserId = String(mpTokens.user_id);

    // 2. Best-effort: crear store + pos en MP para habilitar QR dinámico.
    // Si falla, igual guardamos los tokens — el comercio puede reintentar
    // configurar la caja después desde un endpoint dedicado.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: tenantRow } = await adminClient
      .from('tenants')
      .select('name, legal_name, legal_address, phone')
      .eq('id', tenantId)
      .single();

    const posExternalId = `trankapos-${tenantId.slice(0, 8)}`;
    let mpStoreId: string | null = null;
    let mpPosId: string | null = null;
    // posError: motivo legible si la caja MP no quedó lista. Se devuelve al
    // frontend para que el usuario sepa qué pasó y pueda reintentar — los
    // tokens igual se guardan, pero sin POS el QR dinámico no funciona.
    let posError: string | null = null;
    let posErrorStage: 'lookup' | 'store' | 'pos' | 'exception' | null = null;

    try {
      // ¿Ya existe un POS nuestro? (reconexión)
      const existingPosRes = await fetch(
        `https://api.mercadopago.com/pos?external_id=${encodeURIComponent(posExternalId)}`,
        { headers: { Authorization: `Bearer ${mpTokens.access_token}` } },
      );
      if (existingPosRes.ok) {
        const existingData = (await existingPosRes.json()) as { results?: MPPos[] };
        const existing = existingData.results?.[0];
        if (existing) {
          mpPosId = String(existing.id);
          const storeIdMaybe = (existing as { store_id?: string | number }).store_id;
          if (storeIdMaybe !== undefined) mpStoreId = String(storeIdMaybe);
        }
      } else {
        // No frenamos por esto — si el lookup falla, intentamos crear igual.
        const errBody = await existingPosRes.text().catch(() => '');
        console.warn('Lookup POS existente falló:', existingPosRes.status, errBody.slice(0, 200));
      }

      // Si no había POS previo, crear store + pos nuevos.
      if (!mpPosId) {
        // Crear store. MP exige country_name como código ISO (AR, BR, MX, etc),
        // NO el nombre completo. Misma rigurosidad para state si está validado.
        const storeBody = {
          name: `TrankaPos - ${tenantRow?.legal_name || tenantRow?.name || 'Comercio'}`,
          business_hours: {},
          location: {
            street_number: '0',
            street_name: tenantRow?.legal_address || 'Sin dirección',
            city_name: 'Buenos Aires',
            state_name: 'Buenos Aires',
            country_name: 'AR',
            latitude: -34.6037,
            longitude: -58.3816,
            reference: '',
            comment: 'Configurado automáticamente por TrankaPos',
          },
        };
        const storeRes = await fetch(
          `https://api.mercadopago.com/users/${mpUserId}/stores`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${mpTokens.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(storeBody),
          },
        );
        if (storeRes.ok) {
          const storeJson = (await storeRes.json()) as MPStore;
          mpStoreId = String(storeJson.id);

          // Crear POS bajo ese store
          const posBody = {
            name: 'Caja principal',
            external_id: posExternalId,
            store_id: mpStoreId,
            fixed_amount: false,
            category: 621102,
          };
          const posRes = await fetch('https://api.mercadopago.com/pos', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${mpTokens.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(posBody),
          });
          if (posRes.ok) {
            const posJson = (await posRes.json()) as MPPos;
            mpPosId = String(posJson.id);
          } else {
            const errBody = await posRes.text().catch(() => '');
            console.warn('No se pudo crear POS:', posRes.status, errBody.slice(0, 300));
            posError = `MP rechazó la creación de la caja (HTTP ${posRes.status}): ${errBody.slice(0, 200)}`;
            posErrorStage = 'pos';
          }
        } else {
          const errBody = await storeRes.text().catch(() => '');
          console.warn('No se pudo crear store:', storeRes.status, errBody.slice(0, 300));
          posError = `MP rechazó la creación de la sucursal (HTTP ${storeRes.status}): ${errBody.slice(0, 200)}`;
          posErrorStage = 'store';
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.warn('Error best-effort store/pos:', msg);
      posError = `Error de red al configurar la caja MP: ${msg}`;
      posErrorStage = 'exception';
    }

    // 3. Guardar todo (tokens obligatorios; store/pos pueden ser null)
    const expiresAt = new Date(Date.now() + mpTokens.expires_in * 1000).toISOString();
    const { error: upsertErr } = await adminClient
      .from('tenant_payment_integrations')
      .upsert(
        {
          tenant_id: tenantId,
          provider: 'mp',
          mp_user_id: mpUserId,
          access_token: mpTokens.access_token,
          refresh_token: mpTokens.refresh_token,
          public_key: mpTokens.public_key,
          expires_at: expiresAt,
          scope: mpTokens.scope,
          live_mode: mpTokens.live_mode,
          mp_store_id: mpStoreId,
          mp_pos_id: mpPosId,
          mp_pos_external_id: posExternalId,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,provider' },
      );
    if (upsertErr) {
      return jsonResponse({ error: `Error guardando integración: ${upsertErr.message}` }, 500);
    }

    return jsonResponse(
      {
        ok: true,
        mpUserId,
        liveMode: mpTokens.live_mode,
        posReady: Boolean(mpPosId),
        posError,
        posErrorStage,
      },
      200,
    );
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
