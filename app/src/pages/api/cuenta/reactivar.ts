import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { checkActionRateLimit } from '../../../lib/rate_limiter';

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const cliente = locals.portalCuenta?.cliente;

  if (!user || !cliente) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Rate limit por sesión (cooldown de 10 segundos)
  const rl = checkActionRateLimit(`reactivar:${user.id}`, 10);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Límite de tasa excedido. Por favor espere ${rl.remainingSeconds} segundos antes de enviar otra solicitud.`
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const TELVY_GATE_URL = process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';
  const CLIENT_API_INTERNAL_KEY = process.env.CLIENT_API_INTERNAL_KEY || '';
  const idempotencyKey = crypto.randomUUID();

  try {
    const res = await fetch(`${TELVY_GATE_URL}/v1/cliente/cuenta/reactivar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': CLIENT_API_INTERNAL_KEY,
        'X-Authenticated-Client': cliente,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({})
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
      JSON.stringify({ ok: false, error: err.message || 'Error de conexión con el conmutador' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

