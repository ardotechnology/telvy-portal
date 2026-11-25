import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { POST as pagarPost } from '../app/src/pages/api/publico/alta/pagar.ts';
import { firmarTokenFichaAlta } from '../app/src/lib/sentinel_fiscales.ts';

console.log('=======================================================================');
console.log('  VERIFICACIÓN BUG 1 — PROFORMA CON SESIÓN INICIADA (/alta/pagar)      ');
console.log('=======================================================================\n');

const proformasCreadas = new Map<string, { factura_id: string; folio: string; ficha_pago_url: string }>();
const llamadasSentinel: Array<{ servidor: string; cliente_username: string }> = [];

// Mock Sentinel (POST /api/integracion/proforma-alta) — idempotente por servidor + cliente
const sentinelServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/integracion/proforma-alta') {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const servidor = String(body.servidor || '');
      const cliente = String(body.cliente_username || '');
      llamadasSentinel.push({ servidor, cliente_username: cliente });

      const key = `${servidor}::${cliente}::2026-11`;
      const existing = proformasCreadas.get(key);
      if (existing) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            existente: true,
            ...existing,
            descripcion: 'Plan prepago',
            total: 199,
            moneda: 'MXN'
          })
        );
        return;
      }

      const nueva = {
        factura_id: `fac-${proformasCreadas.size + 1}`,
        folio: `TEL-${1000 + proformasCreadas.size + 1}`,
        ficha_pago_url: `https://sentinel.ardo.group/factura/${cliente}-${proformasCreadas.size + 1}`
      };
      proformasCreadas.set(key, nueva);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          existente: false,
          ...nueva,
          descripcion: 'Plan prepago',
          total: 199,
          moneda: 'MXN'
        })
      );
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

// Mock Motor (GET /v1/cliente/saldo) para resolver servidor real del cliente
const gateServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/cliente/saldo') {
    const cliente = req.headers['x-authenticated-client'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, cliente, servidor: 'MB-Edge-MTY', saldo: 0 }));
    return;
  }
  res.writeHead(404);
  res.end();
});

function makeSupabaseMock(user: { id: string } | null, cuenta: { cliente: string; estado: string } | null) {
  return {
    auth: {
      async getUser() {
        return { data: { user }, error: null };
      }
    },
    from(table: string) {
      assert.equal(table, 'portal_cuenta_usuario');
      return {
        select(_cols: string) {
          return {
            eq(col: string, val: string) {
              assert.equal(col, 'auth_user_id');
              return {
                async single() {
                  if (!user || val !== user.id || !cuenta) {
                    return { data: null, error: { message: 'not found' } };
                  }
                  return { data: cuenta, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://127.0.0.1:3000/api/publico/alta/pagar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

await new Promise<void>((resolve) => sentinelServer.listen(0, '127.0.0.1', resolve));
await new Promise<void>((resolve) => gateServer.listen(0, '127.0.0.1', resolve));

const sentinelPort = (sentinelServer.address() as AddressInfo).port;
const gatePort = (gateServer.address() as AddressInfo).port;

process.env.SENTINEL_URL = `http://127.0.0.1:${sentinelPort}`;
process.env.SENTINEL_INTEGRACION_KEY = 'test-sentinel-key-bug1';
process.env.TELVY_GATE_URL = `http://127.0.0.1:${gatePort}`;
process.env.CLIENT_API_INTERNAL_KEY = 'test-gate-key-bug1';

try {
  // 1. Con sesión activa en el portal (middleware dejó user=null, portalCuenta=null, pero locals.supabase tiene sesión): POST sin token -> 200 y ficha_pago_url
  {
    const locals = {
      user: null,
      portalCuenta: null,
      supabase: makeSupabaseMock({ id: 'auth-u-1' }, { cliente: 'cliente_sesion_1', estado: 'activa' })
    };
    const res = await pagarPost({ request: makeRequest({}), locals } as any);
    const data = await res.json();
    assert.equal(res.status, 200, 'Con sesión activa debe devolver 200');
    assert.equal(data.ok, true);
    assert.equal(data.existente, false);
    assert.ok(data.ficha_pago_url.includes('cliente_sesion_1'), 'La ficha debe corresponder al cliente de la sesión');
    console.log('✅ Caso 1: sesión activa sin token -> 200 y ficha_pago_url propia');
  }

  // 2. Dos llamadas seguidas -> UNA sola proforma (idempotente por cliente y periodo)
  {
    const locals = {
      user: null,
      portalCuenta: null,
      supabase: makeSupabaseMock({ id: 'auth-u-1' }, { cliente: 'cliente_sesion_1', estado: 'activa' })
    };
    const res2 = await pagarPost({ request: makeRequest({}), locals } as any);
    const data2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.equal(data2.ok, true);
    assert.equal(data2.existente, true, 'La segunda llamada debe reutilizar la proforma existente');
    assert.equal(proformasCreadas.size, 1, 'Solo debe existir UNA proforma para el cliente y periodo');
    console.log('✅ Caso 2: dos llamadas seguidas -> 1 sola proforma (idempotente)');
  }

  // 3. Sin sesión y sin token -> 401 con el mensaje actual
  {
    const locals = {
      user: null,
      portalCuenta: null,
      supabase: makeSupabaseMock(null, null)
    };
    const res = await pagarPost({ request: makeRequest({}), locals } as any);
    const data = await res.json();
    assert.equal(res.status, 401, 'Sin sesión ni token debe devolver 401');
    assert.equal(data.ok, false);
    assert.equal(data.error, 'Sesión o token de alta requerido para generar la proforma.');
    console.log('✅ Caso 3: sin sesión ni token -> 401 con mensaje exacto');
  }

  // 4. Con token de ficha válido -> 200 (no se rompe lo que ya funcionaba)
  {
    const token = firmarTokenFichaAlta({ cliente: 'cliente_token_1', servidor: 'MB-Core' });
    assert.ok(token, 'Debe firmarse token de ficha');
    const locals = {
      user: null,
      portalCuenta: null,
      supabase: makeSupabaseMock(null, null)
    };
    const res = await pagarPost({ request: makeRequest({ token }), locals } as any);
    const data = await res.json();
    assert.equal(res.status, 200, 'Con token válido debe devolver 200');
    assert.equal(data.ok, true);
    assert.ok(data.ficha_pago_url.includes('cliente_token_1'));
    console.log('✅ Caso 4: token de ficha válido -> 200 y ficha_pago_url');
  }

  // 5. Negativo: intentar generar con un cliente puesto en el body -> ignorado (sin sesión = 401; con sesión = usa solo el de la sesión)
  {
    const localsSinSesion = {
      user: null,
      portalCuenta: null,
      supabase: makeSupabaseMock(null, null)
    };
    const resNoAuth = await pagarPost(
      {
        request: makeRequest({ cliente: 'victima_ajena', cliente_username: 'victima_ajena', servidor: 'MB-Core' }),
        locals: localsSinSesion
      } as any
    );
    assert.equal(resNoAuth.status, 401, 'Cliente en body sin sesión debe ser ignorado y devolver 401');

    const llamadasAntes = llamadasSentinel.length;
    const localsConSesion = {
      user: null,
      portalCuenta: null,
      supabase: makeSupabaseMock({ id: 'auth-u-1' }, { cliente: 'cliente_sesion_1', estado: 'activa' })
    };
    const resConSesion = await pagarPost(
      {
        request: makeRequest({ cliente: 'victima_ajena', cliente_username: 'victima_ajena', servidor: 'MB-Core' }),
        locals: localsConSesion
      } as any
    );
    const dataConSesion = await resConSesion.json();
    assert.equal(resConSesion.status, 200);
    assert.equal(llamadasSentinel.length, llamadasAntes + 1);
    assert.equal(
      llamadasSentinel[llamadasSentinel.length - 1].cliente_username,
      'cliente_sesion_1',
      'Debe usar el cliente de la sesión y jamás el del body'
    );
    assert.ok(!dataConSesion.ficha_pago_url.includes('victima_ajena'));
    console.log('✅ Caso 5 (negativo): cliente en el body ignorado tanto sin sesión (401) como con sesión (usa sesión propia)');
  }

  // 6. Extra: sesión con cuenta inactiva -> 401
  {
    const localsInactiva = {
      user: null,
      portalCuenta: null,
      supabase: makeSupabaseMock({ id: 'auth-u-2' }, { cliente: 'cliente_inactivo', estado: 'suspendida' })
    };
    const res = await pagarPost({ request: makeRequest({}), locals: localsInactiva } as any);
    assert.equal(res.status, 401, 'Cuenta vinculada no activa debe devolver 401');
    console.log('✅ Caso extra: sesión con cuenta no activa -> 401');
  }

  console.log('\n🎉 TODAS LAS VERIFICACIONES DE BUG 1 PASARON.\n');
} finally {
  sentinelServer.close();
  gateServer.close();
}
