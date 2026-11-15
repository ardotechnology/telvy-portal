import type { APIRoute } from 'astro';
import { buildCorsHeaders, checkPublicRateLimit, getClientIp } from '../../../../lib/public_did_proxy';
import { resendSupabaseConfirmationEmail } from '../../../../lib/supabase_admin';

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
};

export const POST: APIRoute = async (ctx) => {
  const headers = new Headers(buildCorsHeaders(ctx.request));
  const clientIp = getClientIp(ctx);

  if (!checkPublicRateLimit(clientIp, 'publico_alta_reenviar_ip', 10, 60_000)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Demasiados intentos de reenvío desde esta IP.' }),
      { status: 429, headers }
    );
  }

  let body: Record<string, any> = {};
  try {
    body = await ctx.request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'JSON inválido' }), { status: 400, headers });
  }

  const correo = String(body?.correo || body?.email || '').trim().toLowerCase();
  if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return new Response(JSON.stringify({ ok: false, error: 'Correo inválido' }), { status: 400, headers });
  }

  if (!checkPublicRateLimit(correo, 'publico_alta_reenviar_email', 3, 60_000)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Espera un minuto antes de solicitar otro correo.' }),
      { status: 429, headers }
    );
  }

  const res = await resendSupabaseConfirmationEmail(correo);
  if (!res.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: res.error || 'No se pudo reenviar el correo de confirmación.' }),
      { status: res.status, headers }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      mensaje: 'Enviamos un nuevo enlace de confirmación. Revisa tu bandeja de entrada.'
    }),
    { status: 200, headers }
  );
};
