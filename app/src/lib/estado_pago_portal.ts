import type { FacturaPendienteAlta, RegistroAltaInfo } from './sentinel_fiscales.ts';

export interface EstadoPagoPortalInput {
  registroAlta: Pick<
    RegistroAltaInfo,
    'estado_pago_alta' | 'paquete_nombre' | 'plan_slug' | 'paquete_precio' | 'paquete_moneda'
  > | null;
  facturaPendiente: Pick<
    FacturaPendienteAlta,
    'folio' | 'descripcion' | 'total' | 'moneda' | 'estado_pago' | 'ficha_pago_url'
  > | null;
  tieneLineaActiva: boolean;
}

export interface EstadoPagoPortalResult {
  pagoAltaAcreditado: boolean;
  pendienteDePago: boolean;
  mostrarLineaActiva: boolean;
  folioVisible: string | null;
  fichaPagoUrl: string | null;
  planPendienteNombre: string;
  montoPendiente: number | null;
  monedaPendiente: string;
}

/**
 * Deriva el aviso de pago del portal desde el estado real del alta (`estado_pago_alta`)
 * y el estado real de la línea, NUNCA desde el saldo (con tarjeta el saldo no cambia).
 *
 * - Si `estado_pago_alta === 'pagado'`: no es pendiente de pago, nunca muestra el folio ni
 *   enlace de una proforma vieja, y muestra "Línea activa" cuando la línea está activa.
 * - Si `estado_pago_alta === 'pendiente'`: muestra pendiente de pago con su proforma vigente.
 */
export function resolverEstadoPagoPortal(input: EstadoPagoPortalInput): EstadoPagoPortalResult {
  const { registroAlta, facturaPendiente, tieneLineaActiva } = input;
  const estadoAlta = String(registroAlta?.estado_pago_alta || '').trim().toLowerCase();
  const pagoAltaAcreditado = estadoAlta === 'pagado';

  const planPendienteNombre =
    facturaPendiente?.descripcion ||
    registroAlta?.paquete_nombre ||
    registroAlta?.plan_slug ||
    'Paquete Telvy';
  const montoPendiente = facturaPendiente
    ? facturaPendiente.total
    : (registroAlta?.paquete_precio ?? null);
  const monedaPendiente = facturaPendiente?.moneda || registroAlta?.paquete_moneda || 'MXN';

  if (pagoAltaAcreditado) {
    return {
      pagoAltaAcreditado: true,
      pendienteDePago: false,
      mostrarLineaActiva: Boolean(tieneLineaActiva),
      folioVisible: null,
      fichaPagoUrl: null,
      planPendienteNombre,
      montoPendiente,
      monedaPendiente
    };
  }

  const facturaAunPendiente = Boolean(
    facturaPendiente?.ficha_pago_url &&
      String(facturaPendiente.estado_pago || '').trim().toLowerCase() !== 'pagado'
  );
  const pendienteDePago = estadoAlta === 'pendiente' || facturaAunPendiente;

  return {
    pagoAltaAcreditado: false,
    pendienteDePago,
    mostrarLineaActiva: false,
    folioVisible: pendienteDePago && facturaPendiente?.folio ? String(facturaPendiente.folio) : null,
    fichaPagoUrl: pendienteDePago && facturaPendiente?.ficha_pago_url ? String(facturaPendiente.ficha_pago_url) : null,
    planPendienteNombre,
    montoPendiente,
    monedaPendiente
  };
}
