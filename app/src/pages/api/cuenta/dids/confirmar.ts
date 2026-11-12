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

  const rl = checkActionRateLimit(`did:confirmar:${user.id}`, 3);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `Límite de tasa excedido. Por favor espere ${rl.remainingSeconds} segundos antes de enviar otra confirmación.`
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: any = {};
  try {
    const raw = await request.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Cuerpo JSON inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const did = String(body.did || body.numero || '').trim();
  if (!did) {
    return new Response(
      JSON.stringify({ ok: false, error: 'El campo did es obligatorio' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const confirmacion = String(body.confirmacion || '').trim();
  if (confirmacion !== 'CONFIRMAR COMPRA') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Debe ingresar el texto exacto "CONFIRMAR COMPRA"' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const TELVY_GATE_URL = process.env.VOIP_GATE_URL || process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';
  const CLIENT_API_INTERNAL_KEY = process.env.VOIP_GATE_INTERNAL_KEY || process.env.CLIENT_API_INTERNAL_KEY || '';
  const idempotencyKey = crypto.randomUUID();

  try {
    const res = await fetch(`${TELVY_GATE_URL}/v1/cliente/dids/${encodeURIComponent(did)}/confirmar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': CLIENT_API_INTERNAL_KEY,
        'X-Authenticated-Client': cliente,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(body)
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
