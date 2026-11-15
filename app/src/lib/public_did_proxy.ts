import crypto from 'node:crypto';
import type { APIContext } from 'astro';

const TELVY_GATE_URL =
  process.env.VOIP_GATE_URL || process.env.TELVY_GATE_URL || 'http://127.0.0.1:4100';
const CLIENT_API_INTERNAL_KEY =
  process.env.VOIP_GATE_INTERNAL_KEY || process.env.CLIENT_API_INTERNAL_KEY || '';

const PUBLIC_SESSION_COOKIE = 'telvy_pub_sid';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set(['https://telvy.net', 'https://www.telvy.net']);

const ipHits = new Map<string, number[]>();

function getSessionSecret(): string {
  return (
    process.env.PUBLIC_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    'telvy-public-session-dev-secret-change-me'
  );
}

function signSessionId(sessionId: string): string {
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(sessionId)
    .digest('base64url');
  return `${sessionId}.${sig}`;
}

export function verifySignedSessionToken(rawToken: string | null | undefined): string | null {
  if (!rawToken) return null;
  const parts = rawToken.trim().split('.');
  if (parts.length !== 2) return null;
  const [sessionId, providedSig] = parts;
  if (!UUID_REGEX.test(sessionId) || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(sessionId)
    .digest('base64url');

  const bufA = Buffer.from(providedSig);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length) return null;
  return crypto.timingSafeEqual(bufA, bufB) ? sessionId : null;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

export function extractPublicSessionId(request: Request): string | null {
  const headerToken = request.headers.get('x-public-session');
  const fromHeader = verifySignedSessionToken(headerToken);
  if (fromHeader) return fromHeader;

  const cookies = parseCookies(request.headers.get('cookie'));
  return verifySignedSessionToken(cookies[PUBLIC_SESSION_COOKIE]);
}

export function createSignedPublicSession(): { sessionId: string; setCookieHeader: string } {
  const sessionId = crypto.randomUUID();
  const token = signSessionId(sessionId);
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${PUBLIC_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=3600'
  ];
  if (isProd) parts.push('Secure');
  return { sessionId, setCookieHeader: parts.join('; ') };
}

export function getClientIp(ctx: APIContext): string {
  const xff = ctx.request.headers.get('x-forwarded-for');
  if (xff && xff.trim()) return xff.split(',')[0].trim();
  const xri = ctx.request.headers.get('x-real-ip');
  if (xri && xri.trim()) return xri.trim();
  return ctx.clientAddress || '127.0.0.1';
}

export function checkPublicRateLimit(
  ip: string,
  bucket: string,
  maxRequests: number = 60,
  windowMs: number = 60_000
): boolean {
  const key = `${bucket}:${ip || 'unknown'}`;
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (ipHits.get(key) || []).filter(ts => ts > cutoff);
  if (recent.length >= maxRequests) {
    ipHits.set(key, recent);
    return false;
  }
  recent.push(now);
  ipHits.set(key, recent);
  return true;
}

export function buildCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8'
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Public-Session, Idempotency-Key';
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export async function forwardToMotor(
  pathWithQuery: string,
  init: RequestInit & { clientIp: string }
): Promise<Response> {
  const { clientIp, headers, ...rest } = init;
  const mergedHeaders = new Headers(headers);
  mergedHeaders.set('x-forwarded-for', clientIp);
  if (CLIENT_API_INTERNAL_KEY) {
    mergedHeaders.set('X-Internal-Key', CLIENT_API_INTERNAL_KEY);
  }
  return fetch(`${TELVY_GATE_URL}${pathWithQuery}`, {
    ...rest,
    headers: mergedHeaders
  });
}
