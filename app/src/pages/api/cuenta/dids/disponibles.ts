import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals, url }) => {
  const user = locals.user;
  const cliente = locals.portalCuenta?.cliente;

  if (!user || !cliente) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const prefijo = url.searchParams.get('prefijo') || '';
  const region = url.searchParams.get('region') || '';
  const pagina = url.searchParams.get('pagina') || '1';
  const limite = url.searchParams.get('limite') || '20';

  const TELVY_GATE_URL = process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';
  const CLIENT_API_INTERNAL_KEY = process.env.CLIENT_API_INTERNAL_KEY || '';

  const targetUrl = new URL(`${TELVY_GATE_URL}/v1/cliente/dids/disponibles`);
  if (prefijo) targetUrl.searchParams.set('prefijo', prefijo);
  if (region) targetUrl.searchParams.set('region', region);
  targetUrl.searchParams.set('pagina', pagina);
  targetUrl.searchParams.set('limite', limite);

  try {
    const res = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'X-Internal-Key': CLIENT_API_INTERNAL_KEY,
        'X-Authenticated-Client': cliente
      }
    });

    const data = await res.json().catch(() => ({}));
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Error de conexión con el conmutador' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
