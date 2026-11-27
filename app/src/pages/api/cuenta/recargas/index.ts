import type { APIRoute } from 'astro';
import {
  obtenerDatosFiscalesSentinel,
  resolverServidorClienteMotor
} from '../../../../lib/sentinel_fiscales.ts';
import {
  obtenerCatalogoRecargasSentinel,
  obtenerMisRecargasSentinel,
  venderRecargaSentinel
} from '../../../../lib/sentinel_recargas.ts';

async function resolverClienteIdSesion(clienteUsername: string): Promise<string | null> {
  const servidor = await resolverServidorClienteMotor(clienteUsername);
  const ficha = await obtenerDatosFiscalesSentinel({
    servidor,
    cliente_username: clienteUsername
  });
  return ficha.ok && ficha.cliente?.id ? String(ficha.cliente.id) : null;
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  const clienteUsername = locals.portalCuenta?.cliente;
  if (!user || !clienteUsername) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const clienteId = await resolverClienteIdSesion(clienteUsername);
  if (!clienteId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'No se encontró tu ficha de cliente en facturación.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const [catalogo, mis] = await Promise.all([
    obtenerCatalogoRecargasSentinel(),
    obtenerMisRecargasSentinel({ clienteId })
  ]);

  return new Response(
    JSON.stringify({
      ok: catalogo.ok,
      denominaciones: catalogo.denominaciones,
      vigencia_dias: catalogo.vigencia_dias ?? mis.vigencia_dias ?? null,
      recargas: mis.recargas,
      ...(catalogo.error ? { error: catalogo.error } : {})
    }),
    {
      status: catalogo.ok ? 200 : catalogo.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    }
  );
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const clienteUsername = locals.portalCuenta?.cliente;
  if (!user || !clienteUsername) {
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
      JSON.stringify({ ok: false, error: 'Cuerpo JSON inválido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const denominacionId = String(body.denominacion_id || body.denominacionId || '').trim();
  if (!denominacionId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Selecciona una denominación de recarga.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const clienteId = await resolverClienteIdSesion(clienteUsername);
  if (!clienteId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'No se encontró tu ficha de cliente en facturación.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const res = await venderRecargaSentinel({
    clienteId,
    denominacionId,
    precioPlanCatalogo:
      body.precio_plan_catalogo !== undefined && body.precio_plan_catalogo !== null
        ? Number(body.precio_plan_catalogo)
        : null
  });

  return new Response(JSON.stringify(res), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
};
