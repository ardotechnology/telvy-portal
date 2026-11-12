import type { APIRoute } from 'astro';
import { traducirEstadoOrden } from '../../../lib/orden_traductor';

export const GET: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  const cliente = locals.portalCuenta?.cliente;

  if (!user || !cliente) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sesión no válida o no autenticada' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const ordenId = url.searchParams.get('orden_id') || url.searchParams.get('id');

  if (!ordenId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Parámetro orden_id requerido' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const TELVY_GATE_URL = process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';
  const CLIENT_API_INTERNAL_KEY = process.env.CLIENT_API_INTERNAL_KEY || '';

  try {
    const res = await fetch(`${TELVY_GATE_URL}/v1/cliente/ordenes/${ordenId}`, {
      headers: {
        'X-Internal-Key': CLIENT_API_INTERNAL_KEY,
        'X-Authenticated-Client': cliente
      }
    });

    const data = await res.json().catch(() => ({}));

    // Registro estricto en el servidor del portal del error crudo junto con el orden_id
    if (data.ultimo_error || data.motivo) {
      console.error(
        `[portal:orden-status] Orden '${ordenId}' (estado: ${data.estado}): ${data.ultimo_error || data.motivo}`
      );
    }

    if (!res.ok) {
      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Traducción canónica: el texto crudo del motor NUNCA se devuelve al cliente browser
    const traduccion = traducirEstadoOrden(data.estado, ordenId, data.completado_at || data.fecha);

    return new Response(
      JSON.stringify({
        ok: true,
        orden_id: ordenId,
        estado: data.estado,
        terminal: data.terminal !== undefined ? Boolean(data.terminal) : traduccion.terminal,
        mensaje: traduccion.mensaje,
        error_publico: data.error_publico || traduccion.error_publico,
        puede_reintentar: traduccion.puede_reintentar,
        explicacion: traduccion.explicacion ?? null
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (err: any) {
    console.error(`[portal:orden-status] Fallo al conectar con conmutador para orden '${ordenId}':`, err.message);
    return new Response(
      JSON.stringify({ ok: false, error: 'Error de conexión con el conmutador', terminal: false, mensaje: 'Estado no disponible.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
