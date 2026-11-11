import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const cliente = locals.portalCuenta?.cliente;

  if (!user || !cliente) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const ordenId = url.searchParams.get('orden_id') || url.searchParams.get('id');

  if (!ordenId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Parámetro orden_id requerido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const TELVY_GATE_URL = process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';
  const CLIENT_API_INTERNAL_KEY = process.env.CLIENT_API_INTERNAL_KEY || '';

  try {
    const res = await fetch(`${TELVY_GATE_URL}/v1/cliente/ordenes/${ordenId}`, {
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
      JSON.stringify({ ok: false, error: err.message || 'Error de conexión con el conmutador' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

