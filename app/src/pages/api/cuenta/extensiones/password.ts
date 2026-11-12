import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { checkActionRateLimit } from '../../../../lib/rate_limiter';

/**
 * Validador estricto de contraseña de extensión:
 * Mínimo 12 caracteres, máximo 80 caracteres.
 * Al menos una letra mayúscula [A-Z].
 * Al menos una letra minúscula [a-z].
 * Al menos un dígito [0-9].
 * Al menos un símbolo o carácter especial.
 */
export function validarPasswordExtension(password: string): { valida: boolean; motivo?: string } {
  if (!password || typeof password !== 'string') {
    return { valida: false, motivo: 'La contraseña es requerida' };
  }
  const str = password.trim();
  if (str.length < 12) {
    return { valida: false, motivo: 'La contraseña debe tener al menos 12 caracteres' };
  }
  if (str.length > 80) {
    return { valida: false, motivo: 'La contraseña no puede exceder los 80 caracteres permitidos por el conmutador' };
  }
  if (!/[A-Z]/.test(str)) {
    return { valida: false, motivo: 'La contraseña debe contener al menos una letra mayúscula' };
  }
  if (!/[a-z]/.test(str)) {
    return { valida: false, motivo: 'La contraseña debe contener al menos una letra minúscula' };
  }
  if (!/[0-9]/.test(str)) {
    return { valida: false, motivo: 'La contraseña debe contener al menos un número' };
  }
  if (!/[^A-Za-z0-9]/.test(str)) {
    return { valida: false, motivo: 'La contraseña debe contener al menos un símbolo o carácter especial' };
  }
  return { valida: true };
}

export function generarPasswordSegura(): string {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*_-+=';
  const all = uppers + lowers + digits + symbols;
  const bytes = crypto.randomBytes(16);
  const chars = [
    uppers[bytes[0] % uppers.length],
    lowers[bytes[1] % lowers.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length],
    ...Array.from({ length: 12 }, (_, i) => all[bytes[4 + i] % all.length])
  ];
  return chars.sort(() => (crypto.randomBytes(1)[0] / 256) - 0.5).join('');
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const cliente = locals.portalCuenta?.cliente;

  // 1. Verificación estricta de sesión: cliente proviene SOLO del servidor/sesión
  if (!user || !cliente) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 2. Parsear cuerpo de la petición y validar campos
  let body: any = {};
  try {
    const raw = await request.text();
    if (raw.trim()) {
      body = JSON.parse(raw);
    }
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Cuerpo de petición inválido (JSON esperado)' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const extension = String(body.extension || body.extensionName || body.name || '').trim();
  if (!extension) {
    return new Response(
      JSON.stringify({ ok: false, error: 'El nombre de la extensión es obligatorio' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const quiereGenerar = Boolean(body.generar === true || !body.password);
  let passwordFinal = '';

  if (quiereGenerar) {
    passwordFinal = generarPasswordSegura();
  } else {
    passwordFinal = String(body.password).trim();
    // 3. Validación estricta de la regla ANTES de llamar al motor o consumir rate limit
    const val = validarPasswordExtension(passwordFinal);
    if (!val.valida) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Contraseña inválida: ${val.motivo}. La regla exige mínimo 12 caracteres, mayúscula, minúscula, número y símbolo.`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // 4. Rate limit por sesión de usuario (cooldown de 10 segundos)
  const rl = checkActionRateLimit(`ext:password:${user.id}`, 10);
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
    // 5. Llamada al motor pasando el cliente de la SESIÓN y la extensión en la ruta
    const res = await fetch(`${TELVY_GATE_URL}/v1/cliente/extensiones/${encodeURIComponent(extension)}/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': CLIENT_API_INTERNAL_KEY,
        'X-Authenticated-Client': cliente,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        password: passwordFinal
      })
    });

    const data = await res.json().catch(() => ({}));

    // SEGURIDAD: Nunca loguear la contraseña en consola del servidor
    if (res.ok) {
      console.log(`[portal:ext-password] Orden de cambio de password encolada (Orden: '${data.orden_id}') para extensión '${extension}' del cliente '${cliente}'`);
    } else {
      console.error(`[portal:ext-password] Fallo al encolar cambio de password para extensión '${extension}' (Status ${res.status}):`, data.error || 'Desconocido');
    }

    return new Response(
      JSON.stringify({
        ...data,
        password: data.password || passwordFinal
      }),
      {
        status: res.status,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    console.error(`[portal:ext-password] Error de comunicación con motor para extensión '${extension}':`, err.message);
    return new Response(
      JSON.stringify({ ok: false, error: 'Error de conexión con el conmutador' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
