import type { APIRoute } from 'astro';
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

  let body: Record<string, any> = {};
  try {
    const raw = await request.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Cuerpo JSON inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const codigo = String(body.codigo || body.voucher || body.code || '').trim().replace(/\s+/g, '');
  if (!codigo) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Ingresa el código de tu tarjeta prepago' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const rl = checkActionRateLimit(`voucher:canje:${user.id}`, 5);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Demasiados intentos. Espera ${rl.remainingSeconds} segundos antes de volver a intentar.`
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const TELVY_GATE_URL = process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';
  const CLIENT_API_INTERNAL_KEY = process.env.CLIENT_API_INTERNAL_KEY || '';
  // CA7: Idempotency-Key determinista por cliente + código de tarjeta
  const idempotencyKey = `voucher:${cliente}:${codigo}`;

  try {
    const res = await fetch(`${TELVY_GATE_URL}/v1/cliente/voucher/canjear`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': CLIENT_API_INTERNAL_KEY,
        'X-Authenticated-Client': cliente,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        voucher: codigo,
        ...(body.metodo_cobro ? { metodo_cobro: String(body.metodo_cobro).trim() } : {})
      })
    });

    const data = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida del motor' }));
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || 'Error de conexión con el motor VoIP' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
