import { parseCookieHeader } from '@supabase/ssr';

/**
 * Cierra cualquier sesión activa del portal en este navegador y elimina todas
 * las cookies de autenticación de Supabase (`sb-*`, `sb-access-token`, `sb-refresh-token`).
 * Evita fuga de sesión entre clientes en equipos compartidos (AM1-AM3).
 */
export async function cerrarSesionPortal(ctx: {
  request: Request;
  cookies: { delete: (name: string, opts?: Record<string, any>) => void };
  locals?: { supabase?: any; user?: any; portalCuenta?: any };
}): Promise<void> {
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

  const namesToDelete = new Set<string>(['sb-access-token', 'sb-refresh-token']);
  const cookieHeader = ctx.request.headers.get('Cookie') ?? '';
  for (const c of parseCookieHeader(cookieHeader)) {
    if (c.name && c.name.startsWith('sb-')) {
      namesToDelete.add(c.name);
    }
  }

  for (const name of namesToDelete) {
    ctx.cookies.delete(name, { path: '/' });
  }
}
