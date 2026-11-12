import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { checkActionRateLimit } from '../../../../lib/rate_limiter';

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const cliente = locals.portalCuenta?.cliente;

  if (!user || !cliente) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rl = checkActionRateLimit(`aviso_recibido:${user.id}`, 2);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Límite de tasa excedido. Por favor espere ${rl.remainingSeconds} segundos.`
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const avisoId = (body.aviso_id || body.id || '').trim();
  if (!avisoId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'El identificador del aviso es obligatorio' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const TELVY_GATE_URL = process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';
  const CLIENT_API_INTERNAL_KEY = process.env.CLIENT_API_INTERNAL_KEY || '';
  const idempotencyKey = crypto.randomUUID();

  try {
    const res = await fetch(`${TELVY_GATE_URL}/v1/cliente/avisos/${encodeURIComponent(avisoId)}/recibido`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': CLIENT_API_INTERNAL_KEY,
        'X-Authenticated-Client': cliente,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({ aviso_id: avisoId })
    });

    const data = await res.json().catch(() => ({}));

    return new Response(
      JSON.stringify({
        ...data,
        idempotencyKey
      }),
      {
        status: res.status,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || 'Error de conexión con la puerta' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

