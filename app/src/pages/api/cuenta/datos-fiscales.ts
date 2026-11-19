import type { APIRoute } from 'astro';
import {
  guardarDatosFiscalesSentinel,
  obtenerDatosFiscalesSentinel,
  resolverServidorClienteMotor
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

  const servidor = await resolverServidorClienteMotor(cliente);
  const res = await obtenerDatosFiscalesSentinel({
    servidor,
    cliente_username: cliente
  });

  return new Response(JSON.stringify(res.ok ? { ok: true, cliente: res.cliente, revision_fiscal: res.revision_fiscal ?? null } : { ok: false, error: res.error }), {
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

  // Identidad y servidor tomados EXCLUSIVAMENTE de la sesión autenticada y del motor (P2, P3)
  const servidor = await resolverServidorClienteMotor(cliente);
  const res = await guardarDatosFiscalesSentinel({
    servidor,
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
