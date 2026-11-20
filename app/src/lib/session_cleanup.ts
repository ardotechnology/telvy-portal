import { parseCookieHeader } from '@supabase/ssr';

/**
 * Cierra la sesión del portal en este navegador y elimina las cookies de
 * autenticación de Supabase (`sb-*`, `sb-access-token`, `sb-refresh-token`),
 * sin tocar nunca la cookie de sesión pública `telvy_pub_sid`.
 *
 * Cuando `soloSiIdentificado` es `true` (inicio de alta pública):
 *  - Si no hay sesión o la sesión es anónima (`user.is_anonymous === true`),
 *    NO la cierra ni toca sus cookies (AO2, AO3).
 *  - Solo cierra si existe una sesión de cliente identificado (AO1).
 */
export async function cerrarSesionPortal(
  ctx: {
    request: Request;
    cookies: { delete: (name: string, opts?: Record<string, any>) => void };
    locals?: { supabase?: any; user?: any; portalCuenta?: any };
  },
  opts: { soloSiIdentificado?: boolean } = {}
): Promise<{
  cerrada: boolean;
  motivo: 'identificado' | 'forzado' | 'sin_sesion' | 'anonima_conservada';
}> {
  const cookieHeader = ctx.request.headers.get('Cookie') ?? '';
  const sbCookieNames = new Set<string>();
  for (const c of parseCookieHeader(cookieHeader)) {
    if (c.name && c.name.startsWith('sb-')) {
      sbCookieNames.add(c.name);
    }
  }

  if (opts.soloSiIdentificado) {
    if (sbCookieNames.size === 0 && !ctx.locals?.user) {
      return { cerrada: false, motivo: 'sin_sesion' };
    }

    let user = ctx.locals?.user ?? null;
    if (!user && ctx.locals?.supabase?.auth?.getUser) {
      try {
        const res = await ctx.locals.supabase.auth.getUser();
        user = res?.data?.user ?? null;
      } catch {
        user = null;
      }
    }

    if (!user) {
      return { cerrada: false, motivo: 'sin_sesion' };
    }
    if (user.is_anonymous === true) {
      return { cerrada: false, motivo: 'anonima_conservada' };
    }
  }

  if (ctx.locals?.supabase) {
    try {
      await ctx.locals.supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Fallback silencioso para proceder con el borrado explícito de cookies
    }
  }

  if (ctx.locals) {
    ctx.locals.user = null;
    ctx.locals.portalCuenta = null;
  }

  const namesToDelete = new Set<string>(['sb-access-token', 'sb-refresh-token', ...sbCookieNames]);
  for (const name of namesToDelete) {
    ctx.cookies.delete(name, { path: '/' });
  }

  return {
    cerrada: true,
    motivo: opts.soloSiIdentificado ? 'identificado' : 'forzado'
  };
}
