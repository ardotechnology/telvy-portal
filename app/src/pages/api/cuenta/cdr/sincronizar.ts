import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  const cliente = locals.portalCuenta?.cliente;

  if (!user || !cliente) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const TELVY_GATE_URL = process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';
  const CLIENT_API_INTERNAL_KEY = process.env.CLIENT_API_INTERNAL_KEY || '';

  try {
    const res = await fetch(`${TELVY_GATE_URL}/v1/cliente/cdr/sincronizar`, {
      method: 'POST',
      headers: {
        'X-Internal-Key': CLIENT_API_INTERNAL_KEY,
        'X-Authenticated-Client': cliente
      }
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || 'Error de conexión con el motor' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

