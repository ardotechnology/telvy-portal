import type { APIRoute } from 'astro';

const TELVY_GATE_URL = process.env.VOIP_GATE_URL || process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';
const CLIENT_API_INTERNAL_KEY = process.env.VOIP_GATE_INTERNAL_KEY || process.env.CLIENT_API_INTERNAL_KEY || '';

export const POST: APIRoute = async ({ request, locals }) => {
  const cliente = locals.portalCuenta?.cliente;
  if (!cliente) {
    return new Response(JSON.stringify({ ok: false, error: 'Sesión no vinculada a un cliente' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'JSON inválido' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const res = await fetch(`${TELVY_GATE_URL}/v1/cliente/alta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': CLIENT_API_INTERNAL_KEY,
        'X-Authenticated-Client': cliente,
        'Idempotency-Key': body.idempotency_key || crypto.randomUUID()
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message || 'Error conectando con el motor' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
