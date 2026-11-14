import type { APIRoute } from 'astro';
import {
  buildCorsHeaders,
  checkPublicRateLimit,
  createSignedPublicSession,
  extractPublicSessionId,
  forwardToMotor,
  getClientIp
} from '../../../../lib/public_did_proxy';

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
};

export const GET: APIRoute = async (ctx) => {
  const headers = new Headers(buildCorsHeaders(ctx.request));
  const clientIp = getClientIp(ctx);

  if (!checkPublicRateLimit(clientIp, 'locations', 60, 60_000)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Demasiadas consultas. Intenta de nuevo en unos segundos.' }),
      { status: 429, headers }
    );
  }

  if (!extractPublicSessionId(ctx.request)) {
    const { setCookieHeader } = createSignedPublicSession();
    headers.append('Set-Cookie', setCookieHeader);
  }

  try {
    const q = ctx.url.searchParams.get('q');
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    const res = await forwardToMotor(`/v1/publico/dids/locations${qs}`, {
      method: 'GET',
      clientIp
    });
    const data = await res.json().catch(() => ({ ok: false, locations: [] }));
    return new Response(JSON.stringify(data), { status: res.status, headers });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || 'Error consultando ubicaciones' }),
      { status: 502, headers }
    );
  }
};
