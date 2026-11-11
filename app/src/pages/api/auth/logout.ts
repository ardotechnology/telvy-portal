import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
  if (locals.supabase) {
    try {
      await locals.supabase.auth.signOut();
    } catch {
      // Fallback silencioso para proceder con la limpieza
    }
  }

  // Borrar cookies de sesión del proyecto
  cookies.delete('sb-access-token', { path: '/' });
  cookies.delete('sb-refresh-token', { path: '/' });

  return redirect('/login', 302);
};

export const GET: APIRoute = async ctx => {
  return POST(ctx);
};
