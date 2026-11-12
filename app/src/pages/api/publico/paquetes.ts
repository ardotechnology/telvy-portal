import type { APIRoute } from 'astro';

const TELVY_GATE_URL = process.env.VOIP_GATE_URL || process.env.TELVY_GATE_URL || 'http://host.docker.internal:4100';

export const GET: APIRoute = async () => {
  try {
    const res = await fetch(`${TELVY_GATE_URL}/v1/publico/paquetes`);
    const data = await res.json().catch(() => ({ ok: false, paquetes: [] }));
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message || 'Error consultando paquetes' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
