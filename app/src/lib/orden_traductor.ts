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
  fecha?: string | Date | null
): TraduccionOrden {
  const normEstado = String(estado ?? '').trim().toLowerCase();

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
        mensaje: `Tu baja se completó el ${fechaStr}.`,
        puede_reintentar: false,
        error_publico: null
      };

    case 'compensado':
      return {
        estado: 'compensado',
        terminal: true,
        mensaje: 'No se pudo completar: no había servicios que retirar. Tu cuenta quedó como estaba.',
        puede_reintentar: true,
        explicacion: 'La operación no cambió nada en tu cuenta.',
        error_publico: 'No se pudo completar: no había servicios que retirar. Tu cuenta quedó como estaba.'
      };

    case 'fallido':
      return {
        estado: 'fallido',
        terminal: true,
        mensaje: 'No se pudo completar la operación. Nada cambió en tu cuenta.',
        puede_reintentar: true,
        error_publico: 'No se pudo completar la operación. Nada cambió en tu cuenta.'
      };

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
