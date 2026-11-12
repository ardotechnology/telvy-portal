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

    if (!res.ok) {
      const rawError = data?.error || data?.resultado || `Error HTTP ${res.status}`;
      console.error(`[portal-confirmar-did] Error del motor al confirmar DID '${did}' para cliente '${cliente}':`, rawError, data);

      let publicError = 'No se pudo completar la compra del número.';
      const rawLower = String(rawError).toLowerCase();

      if (rawLower.includes('conmutador') || rawLower.includes('descuento') || rawLower.includes('cobro')) {
        publicError = 'No se pudo cobrar el saldo. No se te ha hecho ningún cargo y tu saldo sigue intacto.';
      } else if (rawLower.includes('expirad') || res.status === 410) {
        publicError = 'La reserva expiró. Vuelve a intentarlo.';
      } else if (rawLower.includes('insuficiente') || res.status === 402) {
        publicError = 'Tu saldo no alcanza para esta compra.';
      } else if (rawLower.includes('no disponible') || rawLower.includes('carrera') || res.status === 409) {
        publicError = 'El número ya no está disponible.';
      } else if (rawLower.includes('ajena') || rawLower.includes('prohibido') || res.status === 403) {
        publicError = 'El número no está reservado para tu cuenta.';
      } else if (data?.error && typeof data.error === 'string' && !data.error.includes(':') && data.error.length < 80) {
        publicError = data.error;
      }

      return new Response(JSON.stringify({ ok: false, error: publicError }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error(`[portal-confirmar-did] Excepción de conexión al confirmar DID '${did}':`, err.message);
    return new Response(
      JSON.stringify({ ok: false, error: 'No se pudo comunicar con el servicio de telefonía. Por favor intenta más tarde.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
