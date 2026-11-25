import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

function validarClaveIntegracionInterna(authorizationHeader: string | null): boolean {
  const expected = (process.env.SENTINEL_INTEGRACION_KEY || '').trim();
  if (!expected || !authorizationHeader) return false;

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const provided = match[1].trim();
  if (!provided) return false;

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

function getPortalServiceClient(): SupabaseClient {
  const url = (process.env.SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configuradas en el servidor');
  }
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * Ruta interna server-to-server (autenticada por SENTINEL_INTEGRACION_KEY):
 * Elimina la cuenta del portal (portal_cuenta_usuario + usuarios de Auth) de un cliente dado.
 * - Idempotente: si no hay filas ni usuarios, devuelve 200 con 0 borrados.
 * - Nunca toca ningún conmutador: solo el Supabase del portal.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!validarClaveIntegracionInterna(request.headers.get('authorization'))) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Llave de integración interna requerida o inválida.' }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  let body: Record<string, any> = {};
  try {
    body = (await request.json()) as Record<string, any>;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Cuerpo JSON inválido.' }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const clienteUsername = String(body?.cliente_username ?? body?.cliente ?? '').trim();
  if (!clienteUsername) {
    return new Response(
      JSON.stringify({ ok: false, error: 'cliente_username es obligatorio.' }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  try {
    const supabase: SupabaseClient = (locals as any)?.supabaseAdminOverride ?? getPortalServiceClient();

    const { data: filas, error: selectErr } = await supabase
      .from('portal_cuenta_usuario')
      .select('auth_user_id, cliente, email, estado')
      .eq('cliente', clienteUsername);

    if (selectErr) {
      return new Response(
        JSON.stringify({ ok: false, error: `Error consultando portal_cuenta_usuario: ${selectErr.message}` }),
        { status: 500, headers: JSON_HEADERS }
      );
    }

    const lista = filas || [];
    if (lista.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          cliente: clienteUsername,
          filas_borradas: 0,
          auth_user_ids_borrados: []
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }

    const authUserIds = Array.from(
      new Set(lista.map((r: any) => String(r.auth_user_id || '').trim()).filter(Boolean))
    );

    const { error: delFilasErr } = await supabase
      .from('portal_cuenta_usuario')
      .delete()
      .eq('cliente', clienteUsername);

    if (delFilasErr) {
      return new Response(
        JSON.stringify({ ok: false, error: `Error borrando portal_cuenta_usuario: ${delFilasErr.message}` }),
        { status: 500, headers: JSON_HEADERS }
      );
    }

    const authBorrados: string[] = [];
    for (const authId of authUserIds) {
      const { error: delAuthErr } = await supabase.auth.admin.deleteUser(authId);
      if (delAuthErr) {
        const msg = String(delAuthErr.message || '').toLowerCase();
        const notFound = (delAuthErr as any)?.status === 404 || msg.includes('not found');
        if (!notFound) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: `Se borraron ${lista.length} fila(s) del portal, pero falló deleteUser(${authId}): ${delAuthErr.message}`,
              cliente: clienteUsername,
              filas_borradas: lista.length,
              auth_user_ids_borrados: authBorrados
            }),
            { status: 502, headers: JSON_HEADERS }
          );
        }
      } else {
        authBorrados.push(authId);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        cliente: clienteUsername,
        filas_borradas: lista.length,
        auth_user_ids_borrados: authBorrados
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || 'Error limpiando cuenta del portal' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
