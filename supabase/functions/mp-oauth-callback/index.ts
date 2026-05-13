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
      .select('name, legal_name, legal_address, phone, city, state_province')
      .eq('id', tenantId)
      .single();

    // external_ids para MP deben ser SOLO alfanuméricos (sin guiones, sin
    // underscores). Usamos uuid del tenant sin guiones para que sea único.
    const tenantHex = tenantId.replace(/-/g, '').slice(0, 16);
    const posExternalId = `trankaposcaja${tenantHex}`; // max 40 chars
    const storeExternalId = `trankaposstore${tenantHex}`; // max 60 chars
    let mpStoreId: string | null = null;
    let mpPosId: string | null = null;
    // posError: motivo legible si la caja MP no quedó lista. Se devuelve al
    // frontend para que el usuario sepa qué pasó y pueda reintentar — los
    // tokens igual se guardan, pero sin POS el QR dinámico no funciona.
    let posError: string | null = null;
    let posErrorStage: 'lookup' | 'store' | 'pos' | 'exception' | 'missing_address' | null = null;

    // Validar que el tenant tenga ciudad y provincia cargadas. MP las exige
    // contra catálogo oficial AR (api.mercadolibre.com/states/{id}) para
    // crear la sucursal. Sin estos campos no podemos avanzar con el store.
    const tenantCity = tenantRow?.city?.trim();
    const tenantState = tenantRow?.state_province?.trim();
    if (!tenantCity || !tenantState) {
      posError =
        'Antes de conectar Mercado Pago completá Ciudad y Provincia en Configuración → Empresa. MP los valida contra su catálogo oficial.';
      posErrorStage = 'missing_address';
    }

    // Patrón "find-or-create" para store y POS:
    //   1. Buscar store por external_id → si existe usar id, si no crear.
    //   2. Buscar POS por external_id → si existe usar id, si no crear.
    // Esto resuelve reconexiones donde algún recurso quedó huérfano de un
    // intento previo fallido.
    const authHeaderMp = { Authorization: `Bearer ${mpTokens.access_token}` };
    let storeExternalIdConfirmed = storeExternalId;

    // Helper: GET listado completo de stores del seller, paginando si hace
    // falta. MP devuelve {results, paging:{total, limit, offset}}.
    async function listAllStores(): Promise<(MPStore & { external_id?: string })[]> {
      const acc: (MPStore & { external_id?: string })[] = [];
      let offset = 0;
      const limit = 50;
      for (let i = 0; i < 20; i++) {
        const res = await fetch(
          `https://api.mercadopago.com/users/${mpUserId}/stores?limit=${limit}&offset=${offset}`,
          { headers: authHeaderMp },
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          console.warn('listAllStores page failed:', res.status, txt.slice(0, 200));
          break;
        }
        const data = (await res.json()) as {
          results?: (MPStore & { external_id?: string })[];
          paging?: { total?: number; limit?: number; offset?: number };
        };
        const page = data.results ?? [];
        acc.push(...page);
        const total = data.paging?.total ?? acc.length;
        if (acc.length >= total || page.length === 0) break;
        offset += limit;
      }
      return acc;
    }

    try {
      // Si faltan ciudad/provincia, no podemos crear store en MP.
      // Salteamos el bloque y caemos al upsert con posError ya seteado.
      if (posErrorStage === 'missing_address') {
        throw new Error('skip_store_creation');
      }

      // -------- STORE --------
      // GET listado de stores y buscar el nuestro por external_id.
      const allStores = await listAllStores();
      console.log(
        `Stores del seller ${mpUserId}: ${allStores.length}. external_ids: ${
          allStores.map((s) => s.external_id ?? '(sin)').join(', ')
        }`,
      );
      const existingStore = allStores.find((s) => s.external_id === storeExternalId);
      if (existingStore) {
        mpStoreId = String(existingStore.id);
        storeExternalIdConfirmed = existingStore.external_id ?? storeExternalId;
        console.log(`Store ya existía: id=${mpStoreId} external_id=${storeExternalIdConfirmed}`);
      }

      if (!mpStoreId) {
        // Coordenadas aproximadas por provincia (centro de la capital de cada
        // provincia). MP las valida pero no exige precisión exacta. Si no hay
        // match, default a CABA.
        const stateCoords: Record<string, [number, number]> = {
          'capital federal': [-34.6037, -58.3816],
          'buenos aires': [-34.9215, -57.9545], // La Plata
          'catamarca': [-28.4696, -65.7795],
          'chaco': [-27.4514, -58.9867],
          'chubut': [-43.2489, -65.3051],
          'corrientes': [-27.4806, -58.8341],
          'cordoba': [-31.4201, -64.1888],
          'córdoba': [-31.4201, -64.1888],
          'entre rios': [-31.7413, -60.5152],
          'entre ríos': [-31.7413, -60.5152],
          'formosa': [-26.1849, -58.1731],
          'jujuy': [-24.1858, -65.2995],
          'la pampa': [-36.6167, -64.2833],
          'la rioja': [-29.4135, -66.8554],
          'mendoza': [-32.8908, -68.8272],
          'misiones': [-27.3621, -55.9007],
          'neuquen': [-38.9516, -68.0591],
          'neuquén': [-38.9516, -68.0591],
          'rio negro': [-40.8135, -62.9967],
          'río negro': [-40.8135, -62.9967],
          'salta': [-24.7821, -65.4232],
          'san juan': [-31.5375, -68.5364],
          'san luis': [-33.2950, -66.3356],
          'santa cruz': [-51.6230, -69.2168],
          'santa fe': [-31.6333, -60.7000],
          'santiago del estero': [-27.7951, -64.2615],
          'tierra del fuego': [-54.8019, -68.3030],
          'tucuman': [-26.8083, -65.2176],
          'tucumán': [-26.8083, -65.2176],
        };
        const [lat, lng] =
          stateCoords[tenantState.toLowerCase()] ?? [-34.6037, -58.3816];

        // Crear store. city_name y state_name vienen del tenant (validados
        // por MP contra su catálogo oficial AR).
        const buildStoreBody = (extId: string) => ({
          name: `TrankaPos - ${tenantRow?.legal_name || tenantRow?.name || 'Comercio'}`,
          business_hours: {},
          external_id: extId,
          location: {
            street_number: '0',
            street_name: tenantRow?.legal_address || 'Sin dirección',
            city_name: tenantCity,
            state_name: tenantState,
            latitude: lat,
            longitude: lng,
            reference: 'Configurado automáticamente por TrankaPos',
          },
        });

        // Loop: si MP dice "already assigned" y no lo encontramos al listar,
        // significa que hay un store huérfano que MP retiene en su catálogo
        // pero no devuelve al lister. En ese caso, agregamos sufijo numérico
        // al external_id y reintentamos. Hasta 10 variantes.
        let attemptedExternalId = storeExternalId;
        let attempt = 0;
        const MAX_ATTEMPTS = 10;

        while (attempt < MAX_ATTEMPTS && !mpStoreId) {
          const storeRes = await fetch(
            `https://api.mercadopago.com/users/${mpUserId}/stores`,
            {
              method: 'POST',
              headers: { ...authHeaderMp, 'Content-Type': 'application/json' },
              body: JSON.stringify(buildStoreBody(attemptedExternalId)),
            },
          );
          if (storeRes.ok) {
            const storeJson = (await storeRes.json()) as MPStore & {
              external_id?: string;
            };
            mpStoreId = String(storeJson.id);
            storeExternalIdConfirmed = storeJson.external_id ?? attemptedExternalId;
            console.log(
              `Store creado: id=${mpStoreId} external_id=${storeExternalIdConfirmed}`,
            );
            break;
          }
          const errBody = await storeRes.text().catch(() => '');
          console.warn(
            `Intento ${attempt + 1} crear store con external_id ${attemptedExternalId} falló:`,
            storeRes.status,
            errBody.slice(0, 300),
          );

          if (storeRes.status === 400 && errBody.includes('already assigned')) {
            // Probar con sufijo numérico
            attempt++;
            attemptedExternalId = `${storeExternalId}v${attempt + 1}`;
            continue;
          }

          // Otro error → no insistir
          posError = `MP rechazó la creación de la sucursal (HTTP ${storeRes.status}): ${errBody.slice(0, 200)}`;
          posErrorStage = 'store';
          break;
        }

        if (!mpStoreId && !posError) {
          posError = `No se pudo crear la sucursal tras ${MAX_ATTEMPTS} intentos por conflicto de external_id en MP.`;
          posErrorStage = 'store';
        }
      }

      // -------- POS --------
      if (mpStoreId) {
        // Buscar POS por external_id antes de crear.
        const existingPosRes = await fetch(
          `https://api.mercadopago.com/pos?external_id=${encodeURIComponent(posExternalId)}`,
          { headers: authHeaderMp },
        );
        if (existingPosRes.ok) {
          const existingData = (await existingPosRes.json()) as { results?: MPPos[] };
          const existing = existingData.results?.[0];
          if (existing) {
            mpPosId = String(existing.id);
          }
        }

        if (!mpPosId) {
          // Antes de crear el POS, releemos el store desde MP por su id para
          // confirmar el external_id que MP guardó (puede haberlo normalizado).
          let externalStoreIdToUse = storeExternalIdConfirmed;
          try {
            const storeFetchRes = await fetch(
              `https://api.mercadopago.com/users/${mpUserId}/stores/${mpStoreId}`,
              { headers: authHeaderMp },
            );
            if (storeFetchRes.ok) {
              const storeFetch = (await storeFetchRes.json()) as {
                id?: number | string;
                external_id?: string;
              };
              if (storeFetch.external_id) {
                externalStoreIdToUse = storeFetch.external_id;
              }
              console.log(
                `Re-fetch store id=${mpStoreId} → external_id confirmado por MP: ${storeFetch.external_id}`,
              );
            } else {
              const txt = await storeFetchRes.text().catch(() => '');
              console.warn('Re-fetch store falló:', storeFetchRes.status, txt.slice(0, 200));
            }
          } catch (err) {
            console.warn('Excepción re-fetch store:', (err as Error).message);
          }

          // store_id va como NUMBER (la doc lo muestra sin comillas).
          const storeIdNumeric = Number(mpStoreId);
          const posBody = {
            name: 'Caja principal',
            external_id: posExternalId,
            external_store_id: externalStoreIdToUse,
            store_id: storeIdNumeric,
            fixed_amount: true,
            category: 621102,
          };
          console.log('POS body a enviar:', JSON.stringify(posBody));

          // Intento 1 inmediato.
          let posRes = await fetch('https://api.mercadopago.com/pos', {
            method: 'POST',
            headers: { ...authHeaderMp, 'Content-Type': 'application/json' },
            body: JSON.stringify(posBody),
          });

          // Si falla por latencia, esperar 2s y reintentar hasta 3 veces.
          let lastErrBody = '';
          for (let retry = 0; retry < 3 && !posRes.ok; retry++) {
            lastErrBody = await posRes.text().catch(() => '');
            if (
              posRes.status === 400 &&
              lastErrBody.includes('non_existent_external_store_id')
            ) {
              console.warn(
                `POS reintento ${retry + 1} (latencia store): esperando 2s…`,
              );
              await new Promise((r) => setTimeout(r, 2000));
              posRes = await fetch('https://api.mercadopago.com/pos', {
                method: 'POST',
                headers: { ...authHeaderMp, 'Content-Type': 'application/json' },
                body: JSON.stringify(posBody),
              });
            } else {
              // No es latencia: salimos con el error real
              break;
            }
          }

          if (posRes.ok) {
            const posJson = (await posRes.json()) as MPPos;
            mpPosId = String(posJson.id);
          } else {
            const errBody = lastErrBody || (await posRes.text().catch(() => ''));
            console.warn('No se pudo crear POS:', posRes.status, errBody.slice(0, 300));
            posError = `MP rechazó la creación de la caja (HTTP ${posRes.status}): ${errBody.slice(0, 200)}`;
            posErrorStage = 'pos';
          }
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      // skip_store_creation: salida controlada porque faltan city/state.
      // No es un error real, ya tenemos posError seteado con motivo claro.
      if (msg !== 'skip_store_creation') {
        console.warn('Error find-or-create store/pos:', msg);
        posError = `Error de red al configurar la caja MP: ${msg}`;
        posErrorStage = 'exception';
      }
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
