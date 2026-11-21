import type { APIRoute } from 'astro';
import {
  obtenerDatosFiscalesSentinel,
  verificarTokenFichaAlta
} from '../../../../lib/sentinel_fiscales';

/**
 * F.18 / CJ6: Endpoint estrictamente de SÓLO LECTURA.
 * Consulta el registro de alta (plan, precio del catálogo y estado) y, si ya existe,
 * la proforma pendiente. NUNCA crea facturas ni devengos.
 */
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');
  const payload = verificarTokenFichaAlta(token);
  if (!payload) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Enlace de consulta expirado o inválido.' }),
      { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  const res = await obtenerDatosFiscalesSentinel({
    servidor: payload.servidor,
    cliente_username: payload.cliente
  });

  if (!res.ok) {
    const esperando = res.status === 404;
    return new Response(
      JSON.stringify({
        ok: true,
        lista: false,
        esperando,
        plan_slug: payload.plan_slug || null,
        registro_alta: null,
        factura_pendiente: null,
        error: esperando ? null : (res.error || 'No se pudo consultar tu cuenta en facturación')
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  const tieneDatosPago = Boolean(
    res.factura_pendiente?.ficha_pago_url ||
      (res.registro_alta &&
        res.registro_alta.paquete_precio !== null &&
        Number(res.registro_alta.paquete_precio) > 0)
  );

  return new Response(
    JSON.stringify({
      ok: true,
      lista: tieneDatosPago,
      esperando: false,
      plan_slug: payload.plan_slug || res.registro_alta?.plan_slug || null,
      registro_alta: res.registro_alta ?? null,
      factura_pendiente: res.factura_pendiente ?? null,
      error: null
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
};
