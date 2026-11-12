/**
 * Módulo unificado para formateo de píldoras de estado de recursos VoIP (Extensiones y Troncales).
 *
 * Reglas canónicas:
 *   - Extensión registrada: "Registrada"
 *   - Extensión sin registrar: "Desconectada"
 *   - Troncal alcanzable: "En línea"
 *   - Troncal sin respuesta: "Sin respuesta"
 *   - Sin dato o sin medición válida: "sin verificar"
 *   - Latencia: se extrae estrictamente el tiempo en ms (ej. "20 ms")
 *   - Prohibido filtrar hosts (localhost o IPs) o la cadena "OK"
 */

export type TipoRecursoVoip = 'ext' | 'extension' | 'trk' | 'troncal';

export interface PildoraEstado {
  texto: string;
  meta: string;
  clase: string;
}

export function formatearPildoraEstado(
  tipo: TipoRecursoVoip,
  online: boolean,
  rawStatus?: string | null
): PildoraEstado {
  const isExt = tipo === 'ext' || tipo === 'extension';

  // 1. Etiqueta principal (texto) según el tipo de recurso
  let texto = '';
  if (isExt) {
    texto = online ? 'Registrada' : 'Desconectada';
  } else {
    texto = online ? 'En línea' : 'Sin respuesta';
  }

  // 2. Clase CSS para el color de la píldora
  const clase = online ? 'pill-online' : 'pill-offline';

  // 3. Extracción de metadatos (latencia o 'sin verificar')
  const str = String(rawStatus || '').trim();
  const latencyMatch = str.match(/(\d+\s*ms)/i);
  const latency = latencyMatch ? latencyMatch[1] : null;

  const isUnknown = !str || /unknown|unregistered|unreachable/i.test(str);
  const isBareOk = str.toUpperCase() === 'OK';

  let meta = '';
  if (latency) {
    meta = latency;
  } else if (isBareOk || isUnknown || !str) {
    meta = 'sin verificar';
  } else {
    // Si Magnus devuelve cadenas mixtas, garantizar que nunca se muestre localhost ni 'OK'
    meta = 'sin verificar';
  }

  return {
    texto,
    meta,
    clase
  };
}
