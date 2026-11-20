import type { APIRoute } from 'astro';
import {
  buildCorsHeaders,
  checkPublicRateLimit,
  forwardToMotor,
  getClientIp
} from '../../../../lib/public_did_proxy';
import { verifySupabaseEmailToken } from '../../../../lib/supabase_admin';
import { cerrarSesionPortal } from '../../../../lib/session_cleanup';

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
};

function wantsHtmlRedirect(request: Request): boolean {
  if (request.method !== 'GET') return false;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

function redirectConfirmacion(estado: 'ok' | 'error', motivo?: string, correo?: string | null): Response {
  const qs = new URLSearchParams({ estado });
  if (motivo) qs.set('motivo', motivo);
  if (correo && correo.trim()) qs.set('correo', correo.trim().toLowerCase());
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/alta-confirmada?${qs.toString()}`,
      'Cache-Control': 'no-store'
    }
  });
}

async function handleConfirmacion(
  ctx: Parameters<APIRoute>[0],
  params: { token_hash?: string; type?: string; code?: string; access_token?: string }
): Promise<Response> {
  // AM1: nunca dejar activa una sesión previa al confirmar un alta pública
  await cerrarSesionPortal(ctx);
  const headers = new Headers(buildCorsHeaders(ctx.request));
  const clientIp = getClientIp(ctx);
  const isBrowser = wantsHtmlRedirect(ctx.request);

  if (!checkPublicRateLimit(clientIp, 'publico_alta_confirmar', 20, 60_000)) {
    const msg = 'Demasiados intentos de confirmación.';
    return isBrowser
      ? redirectConfirmacion('error', msg)
      : new Response(JSON.stringify({ ok: false, error: msg }), { status: 429, headers });
  }

  if (!params.token_hash && !params.code && !params.access_token) {
    const msg = 'Token de confirmación requerido o ausente.';
    return isBrowser
      ? redirectConfirmacion('error', msg)
      : new Response(JSON.stringify({ ok: false, error: msg }), { status: 400, headers });
  }

  const verified = await verifySupabaseEmailToken(params);
  if (!verified.ok || !verified.userId) {
    const msg = verified.error || 'El enlace de confirmación es inválido o ya expiró.';
    return isBrowser
      ? redirectConfirmacion('error', msg)
      : new Response(JSON.stringify({ ok: false, error: msg }), { status: verified.status || 400, headers });
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

  const data = (await motorRes.json().catch(() => ({ ok: false, error: 'Respuesta inválida del motor' }))) as any;
  if (isBrowser) {
    return motorRes.ok && data.ok
      ? redirectConfirmacion('ok', undefined, verified.email)
      : redirectConfirmacion('error', data.error || 'No se pudo confirmar tu alta.');
  }

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
