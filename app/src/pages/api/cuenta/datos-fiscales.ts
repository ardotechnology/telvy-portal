import type { APIRoute } from 'astro';
import {
  guardarDatosFiscalesSentinel,
  obtenerDatosFiscalesSentinel
} from '../../../lib/sentinel_fiscales.ts';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  const cliente = locals.portalCuenta?.cliente;

  if (!user || !cliente) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const res = await obtenerDatosFiscalesSentinel({
    cliente_username: cliente
  });

  return new Response(JSON.stringify(res.ok ? { ok: true, cliente: res.cliente } : { ok: false, error: res.error }), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const cliente = locals.portalCuenta?.cliente;

  if (!user || !cliente) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: Record<string, any> = {};
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'JSON inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Identidad tomada EXCLUSIVAMENTE de la sesión autenticada (nunca del navegador)
  const res = await guardarDatosFiscalesSentinel({
    cliente_username: cliente,
    rfc: String(body.rfc ?? ''),
    razon_social: String(body.razon_social ?? ''),
    nombre_comercial: String(body.nombre_comercial ?? ''),
    regimen_fiscal: String(body.regimen_fiscal ?? ''),
    codigo_postal: String(body.codigo_postal ?? ''),
    uso_cfdi_sat: String(body.uso_cfdi_sat ?? ''),
    correo_facturacion: String(body.correo_facturacion ?? '')
  });

  return new Response(
    JSON.stringify(res.ok ? { ok: true, cliente: res.cliente } : { ok: false, error: res.error }),
    {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    }
  );
};
