import type { APIRoute } from 'astro';
import {
  buildCorsHeaders,
  checkPublicRateLimit,
  forwardToMotor,
  getClientIp
} from '../../../../lib/public_did_proxy';
import { verifySupabaseEmailToken } from '../../../../lib/supabase_admin';

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
};

async function handleConfirmacion(
  ctx: Parameters<APIRoute>[0],
  params: { token_hash?: string; type?: string; code?: string; access_token?: string }
): Promise<Response> {
  const headers = new Headers(buildCorsHeaders(ctx.request));
  const clientIp = getClientIp(ctx);

  if (!checkPublicRateLimit(clientIp, 'publico_alta_confirmar', 20, 60_000)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Demasiados intentos de confirmación.' }),
      { status: 429, headers }
    );
  }

  if (!params.token_hash && !params.code && !params.access_token) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Token de confirmación requerido' }),
      { status: 400, headers }
    );
  }

  const verified = await verifySupabaseEmailToken(params);
  if (!verified.ok || !verified.userId) {
    return new Response(
      JSON.stringify({ ok: false, error: verified.error || 'Token inválido' }),
      { status: verified.status || 400, headers }
    );
  }

  const motorRes = await forwardToMotor('/v1/publico/alta/confirmar', {
    method: 'POST',
    clientIp,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_user_id: verified.userId,
      correo: verified.email
    })
  });

  const data = await motorRes.json().catch(() => ({ ok: false, error: 'Respuesta inválida del motor' }));
  return new Response(JSON.stringify(data), { status: motorRes.status, headers });
}

export const GET: APIRoute = async (ctx) => {
  const token_hash = ctx.url.searchParams.get('token_hash') || undefined;
  const type = ctx.url.searchParams.get('type') || undefined;
  const code = ctx.url.searchParams.get('code') || undefined;
  const access_token = ctx.url.searchParams.get('access_token') || undefined;
  return handleConfirmacion(ctx, { token_hash, type, code, access_token });
};

export const POST: APIRoute = async (ctx) => {
  let body: Record<string, any> = {};
  try {
    body = await ctx.request.json();
  } catch {
    body = {};
  }
  return handleConfirmacion(ctx, {
    token_hash: body.token_hash ? String(body.token_hash) : undefined,
    type: body.type ? String(body.type) : undefined,
    code: body.code ? String(body.code) : undefined,
    access_token: body.access_token ? String(body.access_token) : undefined
  });
};
