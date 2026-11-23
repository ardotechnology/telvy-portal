import type { APIRoute } from 'astro';
import {
  crearProformaAltaSentinel,
  obtenerDatosFiscalesSentinel,
  verificarTokenFichaAlta
} from '../../../../lib/sentinel_fiscales';

/**
 * CN4: Consulta el registro de alta y garantiza la creación idempotente de la proforma
 * al confirmar el alta. Si falla, expone el motivo real en `error`.
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
        error: esperando
          ? 'Tu alta aún no termina de registrarse en facturación.'
          : (res.error || 'No se pudo consultar tu cuenta en facturación')
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  let facturaPendiente = res.factura_pendiente ?? null;
  let proformaError: string | null = null;

  if (
    !facturaPendiente?.ficha_pago_url &&
    res.registro_alta &&
    String(res.registro_alta.estado_pago_alta || '').toLowerCase() !== 'pagado' &&
    res.registro_alta.paquete_precio !== null &&
    Number(res.registro_alta.paquete_precio) > 0
  ) {
    const profRes = await crearProformaAltaSentinel({
      servidor: payload.servidor,
      cliente_username: payload.cliente
    });
    if (profRes.ok && profRes.ficha_pago_url) {
      facturaPendiente = {
        id: String(profRes.factura_id || ''),
        folio: String(profRes.folio || ''),
        descripcion: profRes.descripcion || null,
        total: Number(profRes.total ?? res.registro_alta.paquete_precio),
        moneda: profRes.moneda || res.registro_alta.paquete_moneda || 'MXN',
        estado_pago: 'pendiente',
        ficha_pago_url: profRes.ficha_pago_url,
        fecha_emision: null
      };
    } else {
      proformaError = profRes.error || 'No se pudo generar la proforma de pago en facturación.';
    }
  }

  const tieneDatosPago = Boolean(
    facturaPendiente?.ficha_pago_url ||
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
      factura_pendiente: facturaPendiente,
      error: proformaError
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
};
