import type { APIRoute } from 'astro';
import { cerrarSesionPortal } from '../../../lib/session_cleanup';

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  await cerrarSesionPortal({ request, cookies, locals });
  return redirect('/login', 302);
};

export const GET: APIRoute = async ctx => {
  return POST(ctx);
};

