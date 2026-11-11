import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const cookieHeader = context.request.headers.get('Cookie') ?? '';

  const supabaseUrl = process.env.SUPABASE_URL || 'https://mottolvjcmvvcohrvroe.supabase.co';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';

  // Instanciar cliente Supabase SSR con almacenamiento en cookies del servidor
  context.locals.supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(cookieHeader);
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          context.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
          });
        });
      }
    }
  });

  const pathname = context.url.pathname;

  // Rutas públicas que no requieren autenticación
  const isPublicRoute =
    pathname === '/login' ||
    pathname === '/recuperar' ||
    pathname === '/cuenta-no-vinculada' ||
    pathname.startsWith('/_astro') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/favicon.ico';

  // Validar sesión con Supabase Auth
  const {
    data: { user }
  } = await context.locals.supabase.auth.getUser();

  context.locals.user = user ?? null;
  context.locals.portalCuenta = null;

  // 1. Sin sesión en ruta protegida -> redirigir a /login
  if (!user) {
    if (!isPublicRoute) {
      return context.redirect('/login');
    }
    return next();
  }

  // 2. Con sesión en /login -> redirigir a /
  if (pathname === '/login') {
    return context.redirect('/');
  }

  // 3. Buscar vinculación en portal_cuenta_usuario para este auth_user_id
  const { data: cuenta } = await context.locals.supabase
    .from('portal_cuenta_usuario')
    .select('cliente, email, estado')
    .eq('auth_user_id', user.id)
    .single();

  context.locals.portalCuenta = cuenta ?? null;

  // 4. Si tiene sesión pero no está vinculado o estado != 'activa' -> /cuenta-no-vinculada
  if (!isPublicRoute && pathname !== '/cuenta-no-vinculada') {
    if (!cuenta || cuenta.estado !== 'activa') {
      return context.redirect('/cuenta-no-vinculada');
    }
  }

  return next();
});
