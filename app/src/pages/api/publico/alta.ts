import crypto from 'node:crypto';
import type { APIRoute } from 'astro';
import {
  buildCorsHeaders,
  checkPublicRateLimit,
  extractPublicSessionId,
  forwardToMotor,
  getClientIp
} from '../../../lib/public_did_proxy';
import { createSupabaseUserWithConfirmation } from '../../../lib/supabase_admin';

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(request) });
};

export const POST: APIRoute = async (ctx) => {
  const headers = new Headers(buildCorsHeaders(ctx.request));
  const clientIp = getClientIp(ctx);

  if (!checkPublicRateLimit(clientIp, 'publico_alta_ip', 10, 60_000)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Demasiados intentos de registro desde esta IP.' }),
      { status: 429, headers }
    );
  }

  let body: Record<string, any> = {};
  try {
    body = await ctx.request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Cuerpo JSON inválido' }), {
      status: 400,
      headers
    });
  }

  const correo = String(body?.correo || body?.email || '').trim().toLowerCase();
  if (correo && !checkPublicRateLimit(correo, 'publico_alta_email', 5, 60_000)) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Demasiados intentos para este correo.' }),
      { status: 429, headers }
    );
  }

  const password = String(body?.password || body?.contrasena || '');
  if (!password || password.length < 8) {
    return new Response(
      JSON.stringify({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres' }),
      { status: 400, headers }
    );
  }

  const sessionId = extractPublicSessionId(ctx.request);
  if (!sessionId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión anónima requerida para completar el alta.' }),
      { status: 410, headers }
    );
  }

  const idempotencyKey =
    ctx.request.headers.get('idempotency-key')?.trim() ||
    String(body?.idempotency_key || '').trim() ||
    crypto.randomUUID();

  // No reenviamos la contraseña al motor VoIP
  const { password: _pw, contrasena: _pw2, ...motorBody } = body;

  try {
    const motorRes = await forwardToMotor('/v1/publico/alta', {
      method: 'POST',
      clientIp,
      headers: {
        'Content-Type': 'application/json',
        'x-public-session-id': sessionId,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(motorBody)
    });

    const motorData = (await motorRes.json().catch(() => ({ ok: false, error: 'Respuesta inválida del motor' }))) as any;
    if (!motorRes.ok || !motorData.ok) {
      const statusOut = motorRes.status >= 500 ? 502 : motorRes.status;
      const errorOut =
        statusOut === 409
          ? 'Este correo ya tiene cuenta, inicia sesión'
          : (motorData.error || 'El motor no pudo procesar el registro');
      return new Response(JSON.stringify({ ok: false, error: errorOut }), { status: statusOut, headers });
    }

    if (motorData.alta?.estado !== 'pendiente') {
      return new Response(
        JSON.stringify({ ok: false, error: 'El alta no quedó en estado pendiente' }),
        { status: 502, headers }
      );
    }

    if (motorData.idempotente) {
      if (!motorData.alta?.auth_vinculado) {
        return new Response(
          JSON.stringify({ ok: false, error: 'El registro previo no completó el envío de correo' }),
          { status: 502, headers }
        );
      }
    } else if (motorData.alta?.id) {
      // Alta nueva: crear usuario en Supabase y enviar correo de confirmación
      const origin = ctx.url.origin;
      const supaRes = await createSupabaseUserWithConfirmation({
        email: correo,
        password,
        nombre: String(body?.nombre || body?.full_name || '').trim(),
        telefono: String(body?.telefono || body?.phone || '').trim(),
        emailRedirectTo: `${origin}/api/publico/alta/confirmar`
      });

      await forwardToMotor('/v1/publico/alta/vincular-auth', {
        method: 'POST',
        clientIp,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alta_id: motorData.alta.id,
          ...(supaRes.userId ? { auth_user_id: supaRes.userId } : {}),
          ...(supaRes.ok ? {} : { error: supaRes.error || 'Error en Supabase Auth' })
        })
      }).catch(() => {});

      if (!supaRes.ok) {
        const errStatus = supaRes.status === 409 ? 409 : 502;
        const errMsg =
          errStatus === 409
            ? 'Este correo ya tiene cuenta, inicia sesión'
            : (supaRes.error || 'No se pudo enviar el correo de confirmación');
        return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: errStatus, headers });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        ...(motorData.idempotente ? { idempotente: true } : {}),
        estado: 'pendiente',
        mensaje: 'Revisa tu correo para confirmar tu cuenta.',
        alta: motorData.alta
      }),
      { status: 202, headers }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || 'Error procesando alta pública' }),
      { status: 502, headers }
    );
  }
};
