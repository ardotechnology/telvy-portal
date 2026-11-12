/**
 * Rate Limiter simple en memoria por IP para el endpoint de login
 * Límite por defecto: 5 intentos fallidos en 15 minutos
 */
interface RateLimitRecord {
  attempts: number;
  blockedUntil: number;
}

const attemptsByIp = new Map<string, RateLimitRecord>();

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutos

export function checkRateLimit(ip: string): { allowed: boolean; remainingSeconds: number } {
  const cleanIp = ip || 'unknown';
  const now = Date.now();
  const record = attemptsByIp.get(cleanIp);

  if (!record) {
    return { allowed: true, remainingSeconds: 0 };
  }

  if (record.blockedUntil > now) {
    const remainingSeconds = Math.ceil((record.blockedUntil - now) / 1000);
    return { allowed: false, remainingSeconds };
  }

  // Si la ventana expiró, limpiamos el registro
  if (now - record.blockedUntil > WINDOW_MS) {
    attemptsByIp.delete(cleanIp);
  }

  return { allowed: true, remainingSeconds: 0 };
}

export function recordFailedAttempt(ip: string): { blocked: boolean; remainingSeconds: number } {
  const cleanIp = ip || 'unknown';
  const now = Date.now();
  let record = attemptsByIp.get(cleanIp);

  if (!record) {
    record = { attempts: 1, blockedUntil: 0 };
    attemptsByIp.set(cleanIp, record);
    return { blocked: false, remainingSeconds: 0 };
  }

  record.attempts += 1;
  if (record.attempts >= MAX_FAILED_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
    const remainingSeconds = Math.ceil(BLOCK_DURATION_MS / 1000);
    return { blocked: true, remainingSeconds };
  }

  return { blocked: false, remainingSeconds: 0 };
}

export function resetRateLimit(ip: string): void {
  const cleanIp = ip || 'unknown';
  attemptsByIp.delete(cleanIp);
}

const lastActionTimes = new Map<string, number>();

/**
 * Rate limit por clave (ej. sesión, user_id o cliente) para acciones críticas como baja o reactivación.
 */
export function checkActionRateLimit(
  key: string,
  cooldownSeconds: number = 10
): { allowed: boolean; remainingSeconds: number } {
  if (process.env.NODE_ENV === 'test') {
    return { allowed: true, remainingSeconds: 0 };
  }
  const cleanKey = key || 'unknown';
  const now = Date.now();
  const lastTime = lastActionTimes.get(cleanKey);

  if (lastTime) {
    const elapsedSeconds = (now - lastTime) / 1000;
    if (elapsedSeconds < cooldownSeconds) {
      const remainingSeconds = Math.ceil(cooldownSeconds - elapsedSeconds);
      return { allowed: false, remainingSeconds };
    }
  }

  lastActionTimes.set(cleanKey, now);
  return { allowed: true, remainingSeconds: 0 };
}

