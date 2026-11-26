import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GET as fichaPagoGet } from '../app/src/pages/api/publico/alta/ficha-pago.ts';
import { firmarTokenFichaAlta } from '../app/src/lib/sentinel_fiscales.ts';

console.log('=======================================================================');
console.log('  VERIFICACIÓN API FICHA-PAGO — CARRERA DE REGISTRO EN FACTURACIÓN     ');
console.log('=======================================================================\n');

// Estado del mock de Sentinel por cliente:
// - 'carrera_1': primeros 2 GET devuelven 404; el 3ro ya existe y permite generar proforma
// - 'listo_1': existe desde el primer GET
// - 'persistente_404': siempre devuelve 404
const intentosPorCliente = new Map<string, number>();

const sentinelServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/api/integracion/datos-fiscales') {
    const cliente = url.searchParams.get('cliente_username') || '';
    const n = (intentosPorCliente.get(cliente) || 0) + 1;
    intentosPorCliente.set(cliente, n);

    if (cliente === 'persistente_404' || (cliente === 'carrera_1' && n <= 2)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'No existe vínculo para la cuenta indicada' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        cliente: { id: 'c-1', rfc: 'XAXX010101000', razon_social: cliente, kyc_status: 'pendiente' },
        registro_alta: {
          plan_slug: 'prepago-199',
          paquete_nombre: 'Plan Prepago 199',
          paquete_precio: 199,
          paquete_moneda: 'MXN',
          estado_pago_alta: 'pendiente',
          created_at: new Date().toISOString()
        },
        factura_pendiente: null
      })
    );
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/integracion/proforma-alta') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const cliente = String(body.cliente_username || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          existente: false,
          factura_id: `fac-${cliente}`,
          folio: 'TEL-0009/11/2026',
          descripcion: 'Plan Prepago 199',
          total: 199,
          moneda: 'MXN',
          ficha_pago_url: `https://sentinel.ardo.group/factura/${cliente}`
        })
      );
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

await new Promise<void>((resolve) => sentinelServer.listen(0, '127.0.0.1', resolve));
const port = (sentinelServer.address() as AddressInfo).port;
process.env.SENTINEL_URL = `http://127.0.0.1:${port}`;
process.env.SENTINEL_INTEGRACION_KEY = 'test-sentinel-key-alta-confirmada';

try {
  // Caso 1: Alta recién confirmada consultada en el primer segundo -> espera (esperando=true, error=null),
  //         y cuando Sentinel termina de crearla, genera la ficha sola.
  {
    const token = firmarTokenFichaAlta({ cliente: 'carrera_1', servidor: 'MB-Edge-MTY', plan_slug: 'prepago-199' });
    assert.ok(token);

    const r1 = await fichaPagoGet({ url: new URL(`http://127.0.0.1/api/publico/alta/ficha-pago?token=${encodeURIComponent(token)}`) } as any);
    const d1 = await r1.json();
    assert.equal(r1.status, 200);
    assert.equal(d1.ok, true);
    assert.equal(d1.lista, false);
    assert.equal(d1.esperando, true, 'En 404 inicial debe marcar esperando=true');
    assert.equal(d1.error, null, 'En espera legítima no debe marcar error definitivo');
    assert.ok(d1.motivo.includes('registrarse en facturación'));

    const r2 = await fichaPagoGet({ url: new URL(`http://127.0.0.1/api/publico/alta/ficha-pago?token=${encodeURIComponent(token)}`) } as any);
    const d2 = await r2.json();
    assert.equal(d2.esperando, true);
    assert.equal(d2.lista, false);

    // 3er intento: Sentinel ya creó el cliente -> ficha-pago genera la proforma automáticamente
    const r3 = await fichaPagoGet({ url: new URL(`http://127.0.0.1/api/publico/alta/ficha-pago?token=${encodeURIComponent(token)}`) } as any);
    const d3 = await r3.json();
    assert.equal(r3.status, 200);
    assert.equal(d3.ok, true);
    assert.equal(d3.lista, true, 'En cuanto existe el cliente, la ficha queda lista sola');
    assert.equal(d3.esperando, false);
    assert.equal(d3.factura_pendiente?.folio, 'TEL-0009/11/2026');
    assert.equal(d3.factura_pendiente?.ficha_pago_url, 'https://sentinel.ardo.group/factura/carrera_1');
    console.log('✅ Caso 1: alta recién confirmada -> espera sin error falso y genera la ficha sola al aparecer');
  }

  // Caso 2: Alta ya registrada -> ficha a la primera
  {
    const token = firmarTokenFichaAlta({ cliente: 'listo_1', servidor: 'MB-Edge-MTY', plan_slug: 'prepago-199' });
    assert.ok(token);

    const r = await fichaPagoGet({ url: new URL(`http://127.0.0.1/api/publico/alta/ficha-pago?token=${encodeURIComponent(token)}`) } as any);
    const d = await r.json();
    assert.equal(r.status, 200);
    assert.equal(d.ok, true);
    assert.equal(d.lista, true, 'Con alta ya registrada, la ficha sale a la primera');
    assert.equal(d.esperando, false);
    assert.equal(d.factura_pendiente?.ficha_pago_url, 'https://sentinel.ardo.group/factura/listo_1');
    console.log('✅ Caso 2: alta ya registrada -> ficha generada a la primera');
  }

  // Caso 3: 404 persistente en /api/publico/alta/ficha-pago mantiene espera legítima sin error falso
  {
    const token = firmarTokenFichaAlta({ cliente: 'persistente_404', servidor: 'MB-Edge-MTY', plan_slug: 'prepago-199' });
    assert.ok(token);

    for (let i = 0; i < 3; i++) {
      const r = await fichaPagoGet({ url: new URL(`http://127.0.0.1/api/publico/alta/ficha-pago?token=${encodeURIComponent(token)}`) } as any);
      const d = await r.json();
      assert.equal(d.ok, true);
      assert.equal(d.lista, false);
      assert.equal(d.esperando, true);
      assert.equal(d.error, null);
      assert.ok(d.motivo.includes('registrarse en facturación'));
    }

    console.log('✅ Caso 3: 404 persistente -> mantiene esperando=true y motivo claro sin error falso');
  }

  console.log('\n🎉 TODAS LAS VERIFICACIONES DE CARRERA EN FICHA-PAGO PASARON.\n');
} finally {
  sentinelServer.close();
}
