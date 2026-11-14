import type { APIRoute } from 'astro';
import {
  buildCorsHeaders,
  checkPublicRateLimit,
  extractPublicSessionId,
  forwardToMotor,
  getClientIp
} from '../../../../lib/public_did_proxy';

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
};

export const POST: APIRoute = async (ctx) => {
  const headers = new Headers(buildCorsHeaders(ctx.request));
  const clientIp = getClientIp(ctx);

  if (!checkPublicRateLimit(clientIp, 'dids_reservar', 20, 60_000)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Demasiados intentos de reserva desde esta IP.' }),
      { status: 429, headers }
    );
  }

  const sessionId = extractPublicSessionId(ctx.request);
  if (!sessionId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión anónima requerida para reservar.' }),
      { status: 429, headers }
    );
  }

  try {
    const rawBody = await ctx.request.text();
    const res = await forwardToMotor('/v1/publico/dids/reservar', {
      method: 'POST',
      clientIp,
      headers: {
        'Content-Type': 'application/json',
        'x-public-session-id': sessionId
      },
      body: rawBody
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida del motor' }));
    return new Response(JSON.stringify(data), { status: res.status, headers });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || 'Error procesando reserva' }),
      { status: 502, headers }
    );
  }
};
