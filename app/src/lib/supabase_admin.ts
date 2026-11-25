import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function getPortalConfirmRedirectUrl(): string {
  const base = (process.env.PUBLIC_PORTAL_URL || 'https://portal.telvy.net').trim().replace(/\/+$/, '');
  return `${base}/api/publico/alta/confirmar`;
}

export function getPortalRecoveryRedirectUrl(originFallback?: string): string {
  const base = (process.env.PUBLIC_PORTAL_URL || originFallback || 'https://portal.telvy.net')
    .trim()
    .replace(/\/+$/, '');
  return `${base}/restablecer`;
}

function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configuradas en el servidor');
  }
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export interface MotorExtensionesCheckOptions {
  gateUrl?: string;
  internalKey?: string;
  fetcher?: typeof fetch;
}

/**
 * Consulta al motor (GET /v1/cliente/extensiones, el mismo endpoint que usa el portal)
 * si el cliente aún tiene alguna extensión viva.
 * - No usa active=0 como discriminador: una suspensión deja active=0 pero conserva la extensión.
 * - Ante cualquier error o falta de respuesta del motor, falla cerrado (ok: false) con el motivo.
 */
async function consultarExtensionesClienteEnMotor(
  cliente: string,
  opts?: MotorExtensionesCheckOptions
): Promise<{ ok: true; tieneExtension: boolean } | { ok: false; error: string }> {
  const clienteTrim = String(cliente || '').trim();
  if (!clienteTrim) {
    return { ok: false, error: 'Cliente vacío al consultar extensiones en el motor' };
  }

  const gateUrl = (opts?.gateUrl || process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100')
    .trim()
    .replace(/\/+$/, '');
  const internalKey = (opts?.internalKey ?? process.env.CLIENT_API_INTERNAL_KEY ?? '').trim();
  const doFetch = opts?.fetcher || fetch;

  if (!internalKey) {
    return { ok: false, error: 'CLIENT_API_INTERNAL_KEY no configurada para consultar el motor' };
  }

  try {
    const res = await doFetch(`${gateUrl}/v1/cliente/extensiones`, {
      method: 'GET',
      headers: {
        'X-Internal-Key': internalKey,
        'X-Authenticated-Client': clienteTrim
      }
    });

    if (res.status === 404) {
      return { ok: true, tieneExtension: false };
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const errMsg = data?.error || `HTTP ${res.status} del motor al consultar extensiones`;
      return { ok: false, error: String(errMsg) };
    }

    if (!data?.ok || !Array.isArray(data.extensiones)) {
      return {
        ok: false,
        error: String(data?.error || 'Respuesta inválida del motor al consultar extensiones')
      };
    }

    return { ok: true, tieneExtension: data.extensiones.length > 0 };
  } catch (err: any) {
    return {
      ok: false,
      error: `El motor no respondió al consultar extensiones: ${err?.message || String(err)}`
    };
  }
}

export async function limpiarUsuarioAuthHuerfanoSiNoTieneCuenta(
  supabase: SupabaseClient,
  email: string,
  opts?: MotorExtensionesCheckOptions
): Promise<{
  tieneCuentaActiva: boolean;
  estadoCuenta?: string;
  huerfanoEliminado: boolean;
  errorLimpieza?: string;
}> {
  const emailNorm = email.trim().toLowerCase();

  try {
    // 1. Verificar si existe CUALQUIER fila en portal_cuenta_usuario para este correo
    //    (auth_user_id es la PRIMARY KEY; la tabla no tiene columna id).
    //    Solo es huérfano real si NO existe ninguna fila en portal_cuenta_usuario,
    //    o si la fila 'activa' corresponde a un cliente dado de baja (sin extensión en el motor).
    const { data: cuentasExistentes, error: ctaErr } = await supabase
      .from('portal_cuenta_usuario')
      .select('auth_user_id, cliente, estado')
      .ilike('email', emailNorm)
      .limit(1);

    if (ctaErr) {
      const detalle = ctaErr.message || String(ctaErr);
      console.error(
        `[portal/supabase_admin] fallo al consultar portal_cuenta_usuario en autolimpieza correo=${emailNorm}: ${detalle}`
      );
      // No borrar usuarios a ciegas, pero reportar el fallo sin ocultar ni romper el flujo
      return { tieneCuentaActiva: false, huerfanoEliminado: false, errorLimpieza: detalle };
    }

    if (cuentasExistentes && cuentasExistentes.length > 0) {
      const fila = cuentasExistentes[0];
      const estado = String(fila.estado || '').trim();
      if (estado === 'activa') {
        const cliente = String(fila.cliente || '').trim();
        const authUserId = String(fila.auth_user_id || '').trim();
        const motorCheck = await consultarExtensionesClienteEnMotor(cliente, opts);

        if (!motorCheck.ok) {
          console.error(
            `[portal/supabase_admin] no se pudo verificar cliente='${cliente}' en el motor correo=${emailNorm}: ${motorCheck.error}`
          );
          return {
            tieneCuentaActiva: false,
            huerfanoEliminado: false,
            errorLimpieza: motorCheck.error
          };
        }

        if (motorCheck.tieneExtension) {
          return { tieneCuentaActiva: true, estadoCuenta: 'activa', huerfanoEliminado: false };
        }

        // Cliente dado de baja (sin extensión en el motor): limpiar fila del portal y usuario de Auth
        const { error: delCtaErr } = await supabase
          .from('portal_cuenta_usuario')
          .delete()
          .eq('auth_user_id', authUserId);
        if (delCtaErr) {
          const detalle = delCtaErr.message || String(delCtaErr);
          console.error(
            `[portal/supabase_admin] fallo al borrar fila de baja en portal_cuenta_usuario auth_user_id=${authUserId}: ${detalle}`
          );
          return { tieneCuentaActiva: false, huerfanoEliminado: false, errorLimpieza: detalle };
        }

        const { error: delAuthErr } = await supabase.auth.admin.deleteUser(authUserId);
        if (delAuthErr) {
          const detalle = delAuthErr.message || String(delAuthErr);
          console.error(
            `[portal/supabase_admin] fallo deleteUser para cliente dado de baja auth_user_id=${authUserId}: ${detalle}`
          );
          return { tieneCuentaActiva: false, huerfanoEliminado: false, errorLimpieza: detalle };
        }

        return { tieneCuentaActiva: false, huerfanoEliminado: true };
      }
      // Existe fila con otro estado (ej. suspendida / pendiente): NO borrar nada
      return {
        tieneCuentaActiva: false,
        estadoCuenta: estado || 'inactiva',
        huerfanoEliminado: false
      };
    }

    // 2. No existe ninguna fila en portal_cuenta_usuario: huérfano real en Auth -> eliminarlo (AQ1-AQ3)
    let huerfanoEliminado = false;
    let errorLimpieza: string | undefined;
    let page = 1;
    while (page <= 10) {
      const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({
        page,
        perPage: 200
      });
      if (listErr) {
        errorLimpieza = listErr.message || String(listErr);
        console.error(
          `[portal/supabase_admin] fallo listUsers en autolimpieza correo=${emailNorm}: ${errorLimpieza}`
        );
        break;
      }
      if (!listData?.users || listData.users.length === 0) break;

      const match = listData.users.find(
        (u) => String(u.email || '').trim().toLowerCase() === emailNorm
      );
      if (match) {
        const { error: delErr } = await supabase.auth.admin.deleteUser(match.id);
        if (delErr) {
          const detalle = delErr.message || String(delErr);
          console.error(
            `[portal/supabase_admin] fallo deleteUser en autolimpieza auth_user_id=${match.id}: ${detalle}`
          );
          errorLimpieza = detalle;
        } else {
          huerfanoEliminado = true;
        }
        break;
      }
      if (listData.users.length < 200) break;
      page++;
    }

    return {
      tieneCuentaActiva: false,
      huerfanoEliminado,
      ...(errorLimpieza ? { errorLimpieza } : {})
    };
  } catch (err: any) {
    const detalle = err?.message || String(err);
    console.error(
      `[portal/supabase_admin] error inesperado en autolimpieza de huérfano correo=${emailNorm}: ${detalle}`
    );
    return { tieneCuentaActiva: false, huerfanoEliminado: false, errorLimpieza: detalle };
  }
}

export async function createSupabaseUserWithConfirmation(params: {
  email: string;
  password: string;
  nombre: string;
  telefono: string;
  emailRedirectTo?: string;
  supabaseClient?: SupabaseClient;
  gateUrl?: string;
  internalKey?: string;
  fetcher?: typeof fetch;
}): Promise<{ ok: boolean; status: number; userId?: string; error?: string; errorLimpieza?: string }> {
  try {
    const supabase = params.supabaseClient ?? getServiceClient();
    let errorLimpieza: string | undefined;
    let { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: false,
      user_metadata: {
        nombre: params.nombre,
        telefono: params.telefono
      }
    });

    if (createErr || !created?.user) {
      const msg = String(createErr?.message || 'Error creando usuario en Supabase');
      const isDuplicate =
        msg.toLowerCase().includes('already') ||
        msg.toLowerCase().includes('registered') ||
        (createErr as any)?.status === 422;

      if (isDuplicate) {
        const check = await limpiarUsuarioAuthHuerfanoSiNoTieneCuenta(supabase, params.email, {
          gateUrl: params.gateUrl,
          internalKey: params.internalKey,
          fetcher: params.fetcher
        });
        if (check.errorLimpieza) {
          errorLimpieza = check.errorLimpieza;
        }
        if (check.tieneCuentaActiva) {
          return {
            ok: false,
            status: 409,
            error: 'Este correo ya tiene cuenta, inicia sesión'
          };
        }
        if (check.estadoCuenta) {
          return {
            ok: false,
            status: 409,
            error: `Tu cuenta está ${check.estadoCuenta}: inicia sesión o contacta a soporte.`
          };
        }
        if (check.huerfanoEliminado) {
          // Reintentar creación limpia tras eliminar el usuario huérfano de un alta fallida (AQ1, AQ2)
          const retry = await supabase.auth.admin.createUser({
            email: params.email,
            password: params.password,
            email_confirm: false,
            user_metadata: {
              nombre: params.nombre,
              telefono: params.telefono
            }
          });
          created = retry.data;
          createErr = retry.error;
        }
      }

      if (createErr || !created?.user) {
        const retryMsg = String(createErr?.message || msg);
        if (isDuplicate) {
          const motivo = errorLimpieza || 'no se pudo eliminar el usuario huérfano previo en Auth';
          return {
            ok: false,
            status: 502,
            error: `Fallo en limpieza de cuenta previa: ${motivo}`,
            errorLimpieza: motivo
          };
        }
        return {
          ok: false,
          status: 502,
          error: retryMsg,
          ...(errorLimpieza ? { errorLimpieza } : {})
        };
      }
    }

    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email: params.email,
      options: params.emailRedirectTo ? { emailRedirectTo: params.emailRedirectTo } : undefined
    });

    if (resendErr) {
      // No dejar usuario huérfano en Auth si falló el envío del correo de confirmación (AQ1)
      await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
      return {
        ok: false,
        status: 502,
        error: `Falló envío de correo de confirmación: ${resendErr.message}`
      };
    }

    return {
      ok: true,
      status: 201,
      userId: created.user.id,
      ...(errorLimpieza ? { errorLimpieza } : {})
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      error: err?.message || 'No se pudo conectar con Supabase Auth'
    };
  }
}

export async function verifySupabaseEmailToken(params: {
  token_hash?: string;
  type?: string;
  code?: string;
  access_token?: string;
  refresh_token?: string;
  supabaseClient?: SupabaseClient;
}): Promise<{ ok: boolean; status: number; userId?: string; email?: string; error?: string }> {
  const supabase = params.supabaseClient ?? getServiceClient();

  if (params.token_hash) {
    const otpType = (
      params.type === 'recovery' ? 'recovery' : params.type === 'email' ? 'email' : 'signup'
    ) as 'signup' | 'email' | 'recovery';
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: params.token_hash,
      type: otpType
    });
    if (error || !data?.user) {
      return { ok: false, status: 400, error: error?.message || 'Token de confirmación inválido o expirado' };
    }
    return { ok: true, status: 200, userId: data.user.id, email: data.user.email };
  }

  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error || !data?.user) {
      return { ok: false, status: 400, error: error?.message || 'Código de confirmación inválido o expirado' };
    }
    return { ok: true, status: 200, userId: data.user.id, email: data.user.email };
  }

  if (params.access_token && params.refresh_token) {
    const { data, error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token
    });
    if (error || !data?.user) {
      return { ok: false, status: 400, error: error?.message || 'Token de acceso inválido o expirado' };
    }
    return { ok: true, status: 200, userId: data.user.id, email: data.user.email };
  }

  if (params.access_token) {
    const { data, error } = await supabase.auth.getUser(params.access_token);
    if (error || !data?.user) {
      return { ok: false, status: 400, error: error?.message || 'Token de acceso inválido o expirado' };
    }
    return { ok: true, status: 200, userId: data.user.id, email: data.user.email };
  }

  return { ok: false, status: 400, error: 'Token de confirmación requerido' };
}

export async function resendSupabaseConfirmationEmail(
  email: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: getPortalConfirmRedirectUrl() }
    });
    if (error) {
      return { ok: false, status: 400, error: error.message };
    }
    return { ok: true, status: 200 };
  } catch (err: any) {
    return { ok: false, status: 502, error: err?.message || 'Error conectando con Supabase Auth' };
  }
}
