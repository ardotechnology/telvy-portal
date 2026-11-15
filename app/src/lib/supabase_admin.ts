import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

export async function createSupabaseUserWithConfirmation(params: {
  email: string;
  password: string;
  nombre: string;
  telefono: string;
  emailRedirectTo?: string;
}): Promise<{ ok: boolean; status: number; userId?: string; error?: string }> {
  try {
    const supabase = getServiceClient();
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
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
      return {
        ok: false,
        status: isDuplicate ? 409 : 502,
        error: isDuplicate ? 'Este correo ya tiene cuenta, inicia sesión' : msg
      };
    }

    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email: params.email,
      options: params.emailRedirectTo ? { emailRedirectTo: params.emailRedirectTo } : undefined
    });

    if (resendErr) {
      return {
        ok: false,
        status: 502,
        userId: created.user.id,
        error: `Usuario creado pero falló envío de correo de confirmación: ${resendErr.message}`
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
}): Promise<{ ok: boolean; status: number; userId?: string; email?: string; error?: string }> {
  const supabase = getServiceClient();

  if (params.token_hash) {
    const otpType = (params.type === 'email' ? 'email' : 'signup') as 'signup' | 'email';
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

  if (params.access_token) {
    const { data, error } = await supabase.auth.getUser(params.access_token);
    if (error || !data?.user) {
      return { ok: false, status: 400, error: error?.message || 'Token de acceso inválido o expirado' };
    }
    return { ok: true, status: 200, userId: data.user.id, email: data.user.email };
  }

  return { ok: false, status: 400, error: 'Token de confirmación requerido' };
}
