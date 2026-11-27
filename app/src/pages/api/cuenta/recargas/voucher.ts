import type { APIRoute } from 'astro';
import {
  obtenerDatosFiscalesSentinel,
  resolverServidorClienteMotor
} from '../../../../lib/sentinel_fiscales.ts';
import { consultarCodigoVoucherSentinel } from '../../../../lib/sentinel_recargas.ts';

export const GET: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const clienteUsername = locals.portalCuenta?.cliente;
  if (!user || !clienteUsername) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const facturaId = String(url.searchParams.get('facturaId') || '').trim();
  if (!facturaId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'facturaId es obligatorio' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const servidor = await resolverServidorClienteMotor(clienteUsername);
  const ficha = await obtenerDatosFiscalesSentinel({
    servidor,
    cliente_username: clienteUsername
  });
  const clienteId = ficha.ok && ficha.cliente?.id ? String(ficha.cliente.id) : '';
  if (!clienteId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'No se encontró tu ficha de cliente.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const res = await consultarCodigoVoucherSentinel({ facturaId, clienteId });
  return new Response(JSON.stringify(res), {
    status: res.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
};
