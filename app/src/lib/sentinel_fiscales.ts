export const SENTINEL_URL_DEFAULT = 'https://sentinel.ardo.group';
export const TELVY_DEFAULT_SERVIDOR = 'MB-Edge-MTY';

export interface DatosFiscalesFicha {
  id: string;
  rfc: string;
  razon_social: string;
  nombre_comercial: string | null;
  regimen_fiscal: string | null;
  regimen_fiscal_descripcion?: string | null;
  codigo_postal: string | null;
  uso_cfdi_sat: string | null;
  correo_facturacion: string | null;
  correo_cuenta?: string | null;
  kyc_status: 'pendiente' | 'verificado' | 'rechazado' | string;
}

export interface DatosFiscalesFormInput {
  rfc: string;
  razon_social: string;
  nombre_comercial?: string;
  regimen_fiscal: string;
  codigo_postal: string;
  uso_cfdi_sat: string;
  correo_facturacion?: string;
}

export interface SentinelClientOptions {
  sentinelUrl?: string;
  integracionKey?: string;
  fetcher?: typeof fetch;
}

export interface AvisoRevisionFiscal {
  pendiente: boolean;
  factura_id: string | null;
  vence_at: string | null;
}

export function esFichaFiscalPendiente(ficha: DatosFiscalesFicha | null): boolean {
  if (!ficha) return true;
  return ficha.kyc_status === 'pendiente';
}

export function usaRfcGenerico(ficha: DatosFiscalesFicha | null): boolean {
  if (!ficha) return false;
  const rfc = String(ficha.rfc || '').trim().toUpperCase();
  return rfc === 'XAXX010101000' || rfc === 'XEXX010101000';
}

function getSentinelConfig(opts?: SentinelClientOptions) {
  const baseUrl = (
    opts?.sentinelUrl ||
    process.env.SENTINEL_URL ||
    SENTINEL_URL_DEFAULT
  ).replace(/\/$/, '');
  const key = (opts?.integracionKey ?? process.env.SENTINEL_INTEGRACION_KEY ?? '').trim();
  const doFetch = opts?.fetcher || fetch;
  return { baseUrl, key, doFetch };
}

export async function obtenerDatosFiscalesSentinel(
  params: { servidor?: string; cliente_username: string },
  opts?: SentinelClientOptions
): Promise<{
  ok: boolean;
  status: number;
  cliente?: DatosFiscalesFicha;
  revision_fiscal?: AvisoRevisionFiscal | null;
  error?: string;
}> {
  const { baseUrl, key, doFetch } = getSentinelConfig(opts);
  if (!key) {
    return { ok: false, status: 500, error: 'Configuración de integración no disponible' };
  }

  const servidor = (params.servidor || process.env.TELVY_DEFAULT_SERVIDOR || TELVY_DEFAULT_SERVIDOR).trim();
  const qs = new URLSearchParams({
    servidor,
    cliente_username: params.cliente_username
  });

  try {
    const res = await doFetch(`${baseUrl}/api/integracion/datos-fiscales?${qs.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`
      }
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok && data?.cliente) {
      return {
        ok: true,
        status: res.status,
        cliente: data.cliente,
        revision_fiscal: data.revision_fiscal ?? null
      };
    }
    return {
      ok: false,
      status: res.status,
      error: data?.error || `No se pudieron consultar los datos fiscales (HTTP ${res.status})`
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      error: err?.message || 'No se pudo conectar con el servicio de facturación'
    };
  }
}

export async function guardarDatosFiscalesSentinel(
  params: { servidor?: string; cliente_username: string } & DatosFiscalesFormInput,
  opts?: SentinelClientOptions
): Promise<{ ok: boolean; status: number; cliente?: DatosFiscalesFicha; error?: string }> {
  const { baseUrl, key, doFetch } = getSentinelConfig(opts);
  if (!key) {
    return { ok: false, status: 500, error: 'Configuración de integración no disponible' };
  }

  const servidor = (params.servidor || process.env.TELVY_DEFAULT_SERVIDOR || TELVY_DEFAULT_SERVIDOR).trim();

  try {
    const res = await doFetch(`${baseUrl}/api/integracion/datos-fiscales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        servidor,
        cliente_username: params.cliente_username,
        rfc: params.rfc,
        razon_social: params.razon_social,
        nombre_comercial: params.nombre_comercial ?? '',
        regimen_fiscal: params.regimen_fiscal,
        codigo_postal: params.codigo_postal,
        uso_cfdi_sat: params.uso_cfdi_sat,
        correo_facturacion: params.correo_facturacion ?? ''
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok && data?.cliente) {
      return { ok: true, status: res.status, cliente: data.cliente };
    }
    return {
      ok: false,
      status: res.status,
      error: data?.error || `No se pudieron guardar los datos fiscales (HTTP ${res.status})`
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      error: err?.message || 'No se pudo conectar con el servicio de facturación'
    };
  }
}
