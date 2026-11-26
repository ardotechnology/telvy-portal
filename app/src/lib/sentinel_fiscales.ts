import crypto from 'node:crypto';

export const SENTINEL_URL_DEFAULT = 'https://sentinel.ardo.group';
export const TELVY_DEFAULT_SERVIDOR = 'MB-Edge-MTY';

export type TipoPersonaFiscal = 'moral' | 'fisica' | 'no_especificado';

export interface DatosFiscalesFicha {
  id: string;
  rfc: string;
  tipo_persona?: TipoPersonaFiscal | string | null;
  nombres?: string | null;
  apellidos?: string | null;
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
  tipo_persona?: 'moral' | 'fisica' | 'no_especificado' | '';
  nombres?: string;
  apellidos?: string;
  razon_social?: string;
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

export interface FacturaPendienteAlta {
  id: string;
  folio: string;
  descripcion: string | null;
  total: number;
  moneda: string;
  estado_pago: string;
  ficha_pago_url: string;
  fecha_emision: string | null;
}

export interface RegistroAltaInfo {
  plan_slug: string | null;
  paquete_nombre: string | null;
  paquete_precio: number | null;
  paquete_moneda: string;
  estado_pago_alta: 'pendiente' | 'pagado' | 'cancelado' | string;
  created_at: string | null;
}

export interface TokenFichaAltaPayload {
  cliente: string;
  servidor: string;
  plan_slug?: string;
  exp: number;
}

function getFichaTokenSecret(secretOverride?: string): string {
  return (
    secretOverride ||
    process.env.SENTINEL_INTEGRACION_KEY ||
    process.env.CLIENT_API_INTERNAL_KEY ||
    ''
  ).trim();
}

export function firmarTokenFichaAlta(
  input: { cliente: string; servidor?: string; plan_slug?: string },
  opts?: { ttlMs?: number; nowMs?: number; secret?: string }
): string | null {
  const secret = getFichaTokenSecret(opts?.secret);
  const cliente = String(input.cliente || '').trim();
  if (!secret || !cliente) return null;
  const payload: TokenFichaAltaPayload = {
    cliente,
    servidor: String(input.servidor || process.env.TELVY_DEFAULT_SERVIDOR || TELVY_DEFAULT_SERVIDOR).trim(),
    ...(input.plan_slug ? { plan_slug: String(input.plan_slug).trim() } : {}),
    exp: (opts?.nowMs ?? Date.now()) + (opts?.ttlMs ?? 30 * 60_000)
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verificarTokenFichaAlta(
  token: string | null | undefined,
  opts?: { nowMs?: number; secret?: string }
): TokenFichaAltaPayload | null {
  const secret = getFichaTokenSecret(opts?.secret);
  const raw = String(token || '').trim();
  if (!secret || !raw || !raw.includes('.')) return null;
  const [encoded, sig] = raw.split('.');
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenFichaAltaPayload;
    if (!parsed?.cliente || !parsed?.exp || parsed.exp < (opts?.nowMs ?? Date.now())) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
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

/**
 * Resuelve el servidor real del cliente consultando GET /v1/cliente/saldo en la puerta del motor (P1-P3).
 * Solo cae a TELVY_DEFAULT_SERVIDOR como último recurso si el motor no responde o no trae el campo.
 */
export async function resolverServidorClienteMotor(
  cliente: string,
  opts?: {
    gateUrl?: string;
    internalKey?: string;
    fetcher?: typeof fetch;
  }
): Promise<string> {
  const fallback = (process.env.TELVY_DEFAULT_SERVIDOR || TELVY_DEFAULT_SERVIDOR).trim();
  const gateUrl = (opts?.gateUrl || process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100').replace(/\/$/, '');
  const internalKey = (opts?.internalKey ?? process.env.CLIENT_API_INTERNAL_KEY ?? '').trim();
  const doFetch = opts?.fetcher || fetch;

  if (!cliente || !internalKey) return fallback;

  try {
    const res = await doFetch(`${gateUrl}/v1/cliente/saldo`, {
      method: 'GET',
      headers: {
        'X-Internal-Key': internalKey,
        'X-Authenticated-Client': cliente
      }
    });
    if (!res.ok) return fallback;
    const data = await res.json().catch(() => ({}));
    const servidor = typeof data?.servidor === 'string' ? data.servidor.trim() : '';
    return servidor || fallback;
  } catch {
    return fallback;
  }
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
  registro_alta?: RegistroAltaInfo | null;
  factura_pendiente?: FacturaPendienteAlta | null;
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
        revision_fiscal: data.revision_fiscal ?? null,
        registro_alta: data.registro_alta ?? null,
        factura_pendiente: data.factura_pendiente ?? null
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
  const tipoPersona = String(params.tipo_persona || '').trim().toLowerCase();

  const bodyPayload: Record<string, unknown> = {
    servidor,
    cliente_username: params.cliente_username,
    rfc: params.rfc,
    nombre_comercial: params.nombre_comercial ?? '',
    regimen_fiscal: params.regimen_fiscal,
    codigo_postal: params.codigo_postal,
    uso_cfdi_sat: params.uso_cfdi_sat,
    correo_facturacion: params.correo_facturacion ?? ''
  };

  if (tipoPersona === 'fisica') {
    bodyPayload.tipo_persona = 'fisica';
    bodyPayload.nombres = String(params.nombres ?? '').trim();
    bodyPayload.apellidos = String(params.apellidos ?? '').trim();
  } else if (tipoPersona === 'moral') {
    bodyPayload.tipo_persona = 'moral';
    bodyPayload.razon_social = String(params.razon_social ?? '').trim();
  } else {
    bodyPayload.razon_social = String(params.razon_social ?? '').trim();
  }

  try {
    const res = await doFetch(`${baseUrl}/api/integracion/datos-fiscales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(bodyPayload)
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

/**
 * B.4-B.6 / CJ2: Crea (o reutiliza idempotentemente) la proforma en borrador en Sentinel
 * ÚNICAMENTE cuando el cliente pulsa el botón "Pagar".
 */
export async function crearProformaAltaSentinel(
  params: { servidor?: string; cliente_username: string; periodo?: string },
  opts?: SentinelClientOptions
): Promise<{
  ok: boolean;
  status: number;
  existente?: boolean;
  factura_id?: string;
  folio?: string;
  descripcion?: string;
  total?: number;
  moneda?: string;
  ficha_pago_url?: string;
  error?: string;
}> {
  const { baseUrl, key, doFetch } = getSentinelConfig(opts);
  if (!key) {
    return { ok: false, status: 500, error: 'Configuración de integración no disponible' };
  }

  const servidor = (params.servidor || process.env.TELVY_DEFAULT_SERVIDOR || TELVY_DEFAULT_SERVIDOR).trim();
  try {
    const res = await doFetch(`${baseUrl}/api/integracion/proforma-alta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        servidor,
        cliente_username: params.cliente_username,
        ...(params.periodo ? { periodo: params.periodo } : {})
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok && data?.ficha_pago_url) {
      return {
        ok: true,
        status: res.status,
        existente: Boolean(data.existente),
        factura_id: String(data.factura_id || ''),
        folio: String(data.folio || ''),
        descripcion: data.descripcion ? String(data.descripcion) : undefined,
        total: Number(data.total || 0),
        moneda: String(data.moneda || 'MXN'),
        ficha_pago_url: String(data.ficha_pago_url)
      };
    }
    return {
      ok: false,
      status: res.status,
      error: data?.error || `No se pudo generar la proforma de pago (HTTP ${res.status})`
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      error: err?.message || 'No se pudo conectar con el servicio de facturación'
    };
  }
}
