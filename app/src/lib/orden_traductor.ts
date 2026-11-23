/**
 * Traductor de estados de orden para el Portal de Clientes (Bloque Q3.4).
 * Asegura que el cliente nunca reciba errores crudos internos del motor
 * y traduce cada estado a una descripción comprensible para el usuario.
 */

export interface TraduccionOrden {
  estado: string;
  terminal: boolean;
  mensaje: string;
  puede_reintentar: boolean;
  explicacion?: string;
  error_publico: string | null;
}

export function traducirEstadoOrden(
  estado: string | undefined | null,
  ordenId: string,
  fecha?: string | Date | null,
  tipo?: string | null,
  errorPublicoMotor?: string | null
): TraduccionOrden {
  const normEstado = String(estado ?? '').trim().toLowerCase();
  const normTipo = String(tipo ?? '').trim().toLowerCase();
  const esBaja = !normTipo || normTipo.startsWith('baja_');
  const motivoMotor = String(errorPublicoMotor ?? '').trim() || null;

  let fechaStr = '';
  if (fecha) {
    try {
      fechaStr = new Date(fecha).toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      fechaStr = new Date().toLocaleDateString('es-MX');
    }
  } else {
    fechaStr = new Date().toLocaleDateString('es-MX');
  }

  switch (normEstado) {
    case 'completado':
      return {
        estado: 'completado',
        terminal: true,
        mensaje: esBaja
          ? `Tu baja se completó el ${fechaStr}.`
          : normTipo === 'canje_voucher'
            ? 'El canje de tu tarjeta se completó correctamente.'
            : 'La operación se completó correctamente.',
        puede_reintentar: false,
        error_publico: null
      };

    case 'compensado': {
      const msgCompensado =
        motivoMotor ||
        (esBaja
          ? 'No se pudo completar: no había servicios que retirar. Tu cuenta quedó como estaba.'
          : normTipo === 'canje_voucher'
            ? 'No se pudo completar el canje de la tarjeta prepago. Tu saldo no cambió.'
            : 'No se pudo completar la operación. Nada cambió en tu cuenta.');
      return {
        estado: 'compensado',
        terminal: true,
        mensaje: msgCompensado,
        puede_reintentar: true,
        explicacion: 'La operación no cambió nada en tu cuenta.',
        error_publico: msgCompensado
      };
    }

    case 'fallido':
    case 'compensacion_incompleta': {
      const msgFallido =
        motivoMotor ||
        (normTipo === 'canje_voucher'
          ? 'No se pudo completar el canje de la tarjeta prepago. Tu saldo no cambió.'
          : 'No se pudo completar la operación. Nada cambió en tu cuenta.');
      return {
        estado: normEstado,
        terminal: true,
        mensaje: msgFallido,
        puede_reintentar: true,
        error_publico: msgFallido
      };
    }

    case 'pendiente':
    case 'en_proceso':
      return {
        estado: normEstado,
        terminal: false,
        mensaje: `Sigue en proceso. (Orden: ${ordenId})`,
        puede_reintentar: false,
        error_publico: null
      };

    default:
      return {
        estado: normEstado || 'desconocido',
        terminal: false,
        mensaje: 'Estado no disponible.',
        puede_reintentar: false,
        error_publico: null
      };
  }
}
