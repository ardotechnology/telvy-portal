import { SENTINEL_URL_DEFAULT, type SentinelClientOptions } from './sentinel_fiscales.ts';

export interface DenominacionRecargaPortal {
  id: string;
  monto: number;
  moneda: string;
  nombre: string;
}

export interface RecargaClienteItem {
  voucher_id: string;
  factura_id: string;
  monto: number;
  moneda: string;
  estado_visible: 'pendiente_pago' | 'disponible' | 'canjeada' | 'vencida' | 'error_emision';
  expira_at: string | null;
  canjeado_at: string | null;
  canjeado_servidor: string | null;
  canjeado_cliente_username: string | null;
  error_emision: string | null;
  ficha_pago_url: string;
  created_at: string;
}

function getSentinelBase(opts?: SentinelClientOptions): { url: string; key: string; doFetch: typeof fetch } {
  const url = String(opts?.sentinelUrl || process.env.SENTINEL_URL || SENTINEL_URL_DEFAULT)
    .trim()
    .replace(/\/+$/, '');
  const key = String(opts?.integracionKey || process.env.SENTINEL_INTEGRACION_KEY || '').trim();
  const doFetch = opts?.fetcher || fetch;
  return { url, key, doFetch };
}

/**
 * Formatea el aviso de vigencia exclusivamente con el valor devuelto por el API (nunca cableado).
 */
export function formatearAvisoVigencia(vigenciaDias: number | null | undefined): string {
  const n = Number(vigenciaDias);
  if (Number.isFinite(n) && n > 0) {
    return `El voucher tiene ${n} días de vigencia desde la compra.`;
  }
  return 'La vigencia del voucher se confirma al momento de su emisión.';
}

/**
 * Construye el texto de importes del canje dinámicamente desde el catálogo del API
 * (nunca escribe montos a mano en la portada).
 */
export function formatearTextoImportesCanje(
  denominaciones: Array<{ monto: number; moneda?: string }> | null | undefined
): string {
  const validas = Array.isArray(denominaciones)
    ? denominaciones
        .filter((d) => Number.isFinite(Number(d?.monto)) && Number(d.monto) > 0)
        .map((d) => ({
          monto: Number(d.monto),
          moneda: String(d.moneda || 'MXN').trim().toUpperCase() || 'MXN'
        }))
    : [];

  if (validas.length === 0) {
    return 'Ingresa el código de tu tarjeta para abonar el saldo directo a tu monedero.';
  }

  const moneda = validas[0].moneda;
  const montos = validas.map((d) => (Number.isInteger(d.monto) ? String(d.monto) : d.monto.toFixed(2)));
  const listaTexto =
    montos.length === 1
      ? `${montos[0]} ${moneda}`
      : `${montos.slice(0, -1).join(', ')} o ${montos[montos.length - 1]} ${moneda}`;

  return `Ingresa el código de tu tarjeta (${listaTexto}) para abonar el saldo directo a tu monedero.`;
}

export function formatearFechaCaducidad(expiraAt: string | null | undefined): string | null {
  if (!expiraAt) return null;
  const d = new Date(String(expiraAt));
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatearErrorCanjeVencido(
  expiraAt?: string | null,
  errorMotor?: string | null
): string {
  const fecha = formatearFechaCaducidad(expiraAt);
  if (fecha) {
    return `Este voucher caducó el ${fecha} y ya no puede canjearse.`;
  }
  if (errorMotor && /caduc|vencid/i.test(errorMotor)) {
    return errorMotor;
  }
  return 'Este voucher caducó y ya no puede canjearse.';
}

export function resolverMensajeVueltaPago(params: {
  pagoParam?: string | null;
  voucherRes?: {
    ok: boolean;
    status?: number;
    codigo?: string;
    expira_at?: string | null;
    vencido?: boolean;
    error?: string;
  } | null;
}): {
  estado: 'aprobado' | 'cancelado' | 'en_proceso' | 'vencido';
  mostrarCodigo: boolean;
  codigo?: string;
  fechaCaducidad?: string | null;
  mensaje: string;
} {
  const pago = String(params.pagoParam || '').trim().toLowerCase();
  if (pago === 'cancelado') {
    return {
      estado: 'cancelado',
      mostrarCodigo: false,
      mensaje: 'El pago fue cancelado. Tu recarga sigue pendiente de pago y puedes completarla cuando gustes.'
    };
  }

  const vr = params.voucherRes;
  if (vr?.ok && vr.codigo) {
    const fechaCaducidad = formatearFechaCaducidad(vr.expira_at);
    if (vr.vencido) {
      return {
        estado: 'vencido',
        mostrarCodigo: false,
        fechaCaducidad,
        mensaje: formatearErrorCanjeVencido(vr.expira_at)
      };
    }
    return {
      estado: 'aprobado',
      mostrarCodigo: true,
      codigo: vr.codigo,
      fechaCaducidad,
      mensaje: 'Pago aprobado. Aquí tienes tu código de recarga.'
    };
  }

  return {
    estado: 'en_proceso',
    mostrarCodigo: false,
    mensaje: 'Pago en proceso. Tu pago aún se está acreditando; en cuanto se confirme verás tu código aquí.'
  };
}

export function clasificarEstadoRecarga(
  recarga: { estado_visible?: string | null; estado?: string | null; expira_at?: string | null },
  now: Date = new Date()
): {
  estado: 'pendiente_pago' | 'disponible' | 'canjeada' | 'vencida' | 'error_emision';
  etiqueta: string;
  puedeConsultarCodigo: boolean;
  puedeCanjear: boolean;
} {
  const raw = String(recarga.estado_visible || recarga.estado || 'pendiente_pago')
    .trim()
    .toLowerCase();

  if (raw === 'canjeada' || raw === 'canjeado') {
    return {
      estado: 'canjeada',
      etiqueta: 'Canjeada',
      puedeConsultarCodigo: false,
      puedeCanjear: false
    };
  }
  if (raw === 'error_emision') {
    return {
      estado: 'error_emision',
      etiqueta: 'Pendiente de emisión',
      puedeConsultarCodigo: false,
      puedeCanjear: false
    };
  }
  if (raw === 'pendiente_pago') {
    return {
      estado: 'pendiente_pago',
      etiqueta: 'Pendiente de pago',
      puedeConsultarCodigo: false,
      puedeCanjear: false
    };
  }

  const expMs = recarga.expira_at ? new Date(String(recarga.expira_at)).getTime() : NaN;
  const estaVencida = raw === 'vencida' || (Number.isFinite(expMs) && expMs <= now.getTime());
  if (estaVencida) {
    return {
      estado: 'vencida',
      etiqueta: 'Vencida',
      puedeConsultarCodigo: false,
      puedeCanjear: false
    };
  }

  return {
    estado: 'disponible',
    etiqueta: 'Disponible',
    puedeConsultarCodigo: true,
    puedeCanjear: true
  };
}

export async function obtenerCatalogoRecargasSentinel(opts?: SentinelClientOptions): Promise<{
  ok: boolean;
  status: number;
  denominaciones: DenominacionRecargaPortal[];
  vigencia_dias: number | null;
  error?: string;
}> {
  const { url, doFetch } = getSentinelBase(opts);
  try {
    const res = await doFetch(`${url}/api/recargas/denominaciones`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        status: res.status,
        denominaciones: [],
        vigencia_dias: null,
        error: String(body?.error || `HTTP ${res.status}`)
      };
    }
    return {
      ok: true,
      status: 200,
      denominaciones: Array.isArray(body.denominaciones) ? body.denominaciones : [],
      vigencia_dias:
        body.vigencia_dias !== undefined && body.vigencia_dias !== null
          ? Number(body.vigencia_dias)
          : null
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      denominaciones: [],
      vigencia_dias: null,
      error: err?.message || 'Error consultando catálogo de recargas'
    };
  }
}

export async function venderRecargaSentinel(
  params: {
    clienteId: string;
    denominacionId: string;
    precioPlanCatalogo?: number | null;
    volverA?: string | null;
  },
  opts?: SentinelClientOptions
): Promise<{
  ok: boolean;
  status: number;
  factura_id?: string;
  folio?: string;
  ficha_pago_url?: string;
  vigencia_dias?: number | null;
  total?: number;
  error?: string;
}> {
  const { url, key, doFetch } = getSentinelBase(opts);
  try {
    const res = await doFetch(`${url}/api/recargas/vender`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        cliente_id: params.clienteId,
        denominacion_id: params.denominacionId,
        ...(params.precioPlanCatalogo !== undefined && params.precioPlanCatalogo !== null
          ? { precio_plan_catalogo: params.precioPlanCatalogo }
          : {}),
        ...(params.volverA ? { volver_a: params.volverA } : {})
      })
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        status: res.status,
        error: String(body?.error || `HTTP ${res.status}`)
      };
    }
    return {
      ok: true,
      status: res.status,
      factura_id: String(body.factura_id || ''),
      folio: String(body.folio || ''),
      ficha_pago_url: String(body.ficha_pago_url || ''),
      vigencia_dias:
        body.vigencia_dias !== undefined && body.vigencia_dias !== null
          ? Number(body.vigencia_dias)
          : null,
      total: Number(body.total || 0)
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      error: err?.message || 'Error generando compra de recarga'
    };
  }
}

export async function obtenerMisRecargasSentinel(
  params: { clienteId: string },
  opts?: SentinelClientOptions
): Promise<{
  ok: boolean;
  status: number;
  vigencia_dias: number | null;
  recargas: RecargaClienteItem[];
  error?: string;
}> {
  const { url, key, doFetch } = getSentinelBase(opts);
  try {
    const res = await doFetch(
      `${url}/api/recargas/mis-recargas?clienteId=${encodeURIComponent(params.clienteId)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${key}`
        },
        cache: 'no-store'
      }
    );
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        status: res.status,
        vigencia_dias: null,
        recargas: [],
        error: String(body?.error || `HTTP ${res.status}`)
      };
    }
    return {
      ok: true,
      status: 200,
      vigencia_dias:
        body.vigencia_dias !== undefined && body.vigencia_dias !== null
          ? Number(body.vigencia_dias)
          : null,
      recargas: Array.isArray(body.recargas) ? body.recargas : []
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      vigencia_dias: null,
      recargas: [],
      error: err?.message || 'Error consultando tus recargas'
    };
  }
}

export async function consultarCodigoVoucherSentinel(
  params: { facturaId: string; clienteId: string },
  opts?: SentinelClientOptions
): Promise<{
  ok: boolean;
  status: number;
  codigo?: string;
  monto?: number;
  moneda?: string;
  estado?: string;
  expira_at?: string | null;
  vencido?: boolean;
  primera_entrega?: boolean;
  error?: string;
}> {
  const { url, key, doFetch } = getSentinelBase(opts);
  try {
    const qs = new URLSearchParams({
      facturaId: params.facturaId,
      clienteId: params.clienteId
    });
    const res = await doFetch(`${url}/api/recargas/voucher?${qs.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key}`
      },
      cache: 'no-store'
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !body?.ok) {
      return {
        ok: false,
        status: res.status,
        error: String(body?.error || `HTTP ${res.status}`)
      };
    }
    return {
      ok: true,
      status: 200,
      codigo: String(body.codigo || ''),
      monto: Number(body.monto || 0),
      moneda: String(body.moneda || 'MXN'),
      estado: String(body.estado || 'emitido'),
      expira_at: body.expira_at ? String(body.expira_at) : null,
      vencido: Boolean(body.vencido),
      primera_entrega: Boolean(body.primera_entrega)
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      error: err?.message || 'Error consultando el código del voucher'
    };
  }
}
