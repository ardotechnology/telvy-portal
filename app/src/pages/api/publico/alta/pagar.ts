import type { APIRoute } from 'astro';
import {
  crearProformaAltaSentinel,
  resolverServidorClienteMotor,
  verificarTokenFichaAlta
} from '../../../../lib/sentinel_fiscales.ts';

/**
 * Resuelve el cliente vinculado a la sesión propia de Supabase cuando la ruta pública
 * es invocada desde el portal autenticado (el middleware no carga sesión en /api/publico/*).
 * Nunca lee el cliente desde el body ni desde parámetros de la petición.
 */
async function resolverClienteDesdeSesionPropia(locals: any): Promise<string> {
  const cuentaLocal = locals?.portalCuenta;
  if (cuentaLocal?.cliente && (!cuentaLocal.estado || cuentaLocal.estado === 'activa')) {
    return String(cuentaLocal.cliente).trim();
  }

  const supabase = locals?.supabase;
  if (!supabase?.auth?.getUser || typeof supabase.from !== 'function') {
    return '';
  }

  try {
    const {
      data: { user },
      error: userErr
    } = await supabase.auth.getUser();
    if (userErr || !user?.id) return '';

    const { data: cuenta, error: cuentaErr } = await supabase
      .from('portal_cuenta_usuario')
      .select('cliente, estado')
      .eq('auth_user_id', user.id)
      .single();

    if (cuentaErr || !cuenta?.cliente || cuenta.estado !== 'activa') {
      return '';
    }
    return String(cuenta.cliente).trim();
  } catch {
    return '';
  }
}

/**
 * B.4-B.6 / CJ2: Único endpoint que crea (de forma idempotente) la proforma en borrador
 * cuando el cliente pulsa el botón "Pagar", ya sea desde /alta-confirmada (con ficha_token)
 * o desde el portal autenticado (con sesión activa).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  let body: Record<string, any> = {};
  try {
    body = (await request.json()) as Record<string, any>;
  } catch {
    body = {};
  }

  let clienteUsername = '';
  let servidor = '';

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (token) {
    const payload = verificarTokenFichaAlta(token);
    if (!payload) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Tu enlace de pago expiró. Inicia sesión en tu portal para continuar.' }),
        { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }
    clienteUsername = payload.cliente;
    servidor = payload.servidor;
  } else {
    const clienteSesion = await resolverClienteDesdeSesionPropia(locals);
    if (!clienteSesion) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Sesión o token de alta requerido para generar la proforma.' }),
        { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
      );
    }
    clienteUsername = clienteSesion;
    servidor = await resolverServidorClienteMotor(clienteUsername);
  }

  const res = await crearProformaAltaSentinel({
    servidor,
    cliente_username: clienteUsername
  });

  if (!res.ok || !res.ficha_pago_url) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: res.error || 'No se pudo generar tu proforma de pago en este momento.'
      }),
      { status: res.status || 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      existente: Boolean(res.existente),
      factura_id: res.factura_id,
      folio: res.folio,
      descripcion: res.descripcion || null,
      total: res.total,
      moneda: res.moneda,
      ficha_pago_url: res.ficha_pago_url
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
};
