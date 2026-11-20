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

async function limpiarUsuarioAuthHuerfanoSiNoTieneCuenta(
  supabase: SupabaseClient,
  email: string
): Promise<{ tieneCuentaActiva: boolean; huerfanoEliminado: boolean }> {
  const emailNorm = email.trim().toLowerCase();

  // 1. Verificar si existe una cuenta REAL activa en portal_cuenta_usuario para este correo
  const { data: cuentaActiva, error: ctaErr } = await supabase
    .from('portal_cuenta_usuario')
    .select('id, auth_user_id, cliente, estado')
    .ilike('email', emailNorm)
    .eq('estado', 'activa')
    .limit(1);

  if (ctaErr) {
    // Si no podemos verificar la tabla, conservamos el bloqueo seguro (no borrar usuarios a ciegas)
    return { tieneCuentaActiva: true, huerfanoEliminado: false };
  }

  if (cuentaActiva && cuentaActiva.length > 0) {
    return { tieneCuentaActiva: true, huerfanoEliminado: false };
  }

  // 2. No hay cuenta activa en portal_cuenta_usuario: buscar usuario huérfano en Auth y eliminarlo (AQ1-AQ3)
  let huerfanoEliminado = false;
  let page = 1;
  while (page <= 10) {
    const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200
    });
    if (listErr || !listData?.users || listData.users.length === 0) break;

    const match = listData.users.find(
      (u) => String(u.email || '').trim().toLowerCase() === emailNorm
    );
    if (match) {
      await supabase.from('portal_cuenta_usuario').delete().eq('auth_user_id', match.id);
      const { error: delErr } = await supabase.auth.admin.deleteUser(match.id);
      if (!delErr) {
        huerfanoEliminado = true;
      }
      break;
    }
    if (listData.users.length < 200) break;
    page++;
  }

  return { tieneCuentaActiva: false, huerfanoEliminado };
}

export async function createSupabaseUserWithConfirmation(params: {
  email: string;
  password: string;
  nombre: string;
  telefono: string;
  emailRedirectTo?: string;
  supabaseClient?: SupabaseClient;
}): Promise<{ ok: boolean; status: number; userId?: string; error?: string }> {
  try {
    const supabase = params.supabaseClient ?? getServiceClient();
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
        const check = await limpiarUsuarioAuthHuerfanoSiNoTieneCuenta(supabase, params.email);
        if (check.tieneCuentaActiva) {
          return {
            ok: false,
            status: 409,
            error: 'Este correo ya tiene cuenta, inicia sesión'
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
        return {
          ok: false,
          status: isDuplicate ? 409 : 502,
          error: isDuplicate ? 'Este correo ya tiene cuenta, inicia sesión' : retryMsg
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
      userId: created.user.id
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
