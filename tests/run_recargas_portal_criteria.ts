import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

test('PARTE 3 · portal recargas: denominaciones y vigencia_dias desde API (nada cableado), entrega autenticada, caducidad exacta y vencido sin opción de canje', async () => {
  const mod = await import(
    path.join(process.cwd(), 'app/src/lib/sentinel_recargas.ts')
  );

  // 1) Catálogo y vigencia vienen del API (ningún número cableado)
  const cat = await mod.obtenerCatalogoRecargasSentinel({
    sentinelUrl: 'https://sentinel.test',
    integracionKey: 'secret_test',
    fetcher: (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          vigencia_dias: 30,
          denominaciones: [
            { id: 'd200', monto: 200, moneda: 'MXN', nombre: 'Recarga $200' },
            { id: 'd300', monto: 300, moneda: 'MXN', nombre: 'Recarga $300' },
            { id: 'd500', monto: 500, moneda: 'MXN', nombre: 'Recarga $500' },
            { id: 'd700', monto: 700, moneda: 'MXN', nombre: 'Recarga $700' }
          ]
        }),
        { status: 200 }
      )) as any
  });

  assert.equal(cat.ok, true);
  assert.deepEqual(
    cat.denominaciones.map((d: any) => d.monto),
    [200, 300, 500, 700]
  );
  assert.equal(cat.vigencia_dias, 30);

  // Aviso de vigencia usa el número devuelto por el API (si cambia a 45 en el motor, el aviso dice 45)
  assert.match(mod.formatearAvisoVigencia(30), /30 días/);
  assert.match(mod.formatearAvisoVigencia(45), /45 días/);

  // 2) Consulta de código: requiere dueño autenticado + pago aprobado, devuelve fecha de caducidad del API
  const sinPago = await mod.consultarCodigoVoucherSentinel(
    { facturaId: 'fac-pend', clienteId: 'cli-1' },
    {
      sentinelUrl: 'https://sentinel.test',
      integracionKey: 'secret_test',
      fetcher: (async () =>
        new Response(
          JSON.stringify({ ok: false, error: 'El código del voucher sólo está disponible después de aprobarse el pago.' }),
          { status: 409 }
        )) as any
    }
  );
  assert.equal(sinPago.ok, false);
  assert.equal(sinPago.codigo, undefined);

  const aprobado = await mod.consultarCodigoVoucherSentinel(
    { facturaId: 'fac-ok', clienteId: 'cli-1' },
    {
      sentinelUrl: 'https://sentinel.test',
      integracionKey: 'secret_test',
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            ok: true,
            voucher_id: 'v-1',
            factura_id: 'fac-ok',
            codigo: '574199',
            monto: 200,
            moneda: 'MXN',
            estado: 'emitido',
            expira_at: '2026-12-27T12:00:00.000Z',
            vencido: false,
            primera_entrega: true
          }),
          { status: 200 }
        )) as any
    }
  );
  assert.equal(aprobado.ok, true);
  assert.equal(aprobado.codigo, '574199');
  assert.equal(mod.formatearFechaCaducidad(aprobado.expira_at), '27/12/2026');

  // 3) Una recarga vencida se clasifica como vencida y SIN opción de canje ni consulta de código
  const estadoVencido = mod.clasificarEstadoRecarga(
    { estado_visible: 'disponible', expira_at: '2026-11-01T12:00:00.000Z' },
    new Date('2026-11-27T12:00:00.000Z')
  );
  assert.equal(estadoVencido.estado, 'vencida');
  assert.equal(estadoVencido.puedeCanjear, false);
  assert.equal(estadoVencido.puedeConsultarCodigo, false);

  // Mensaje claro al intentar canjear un vencido
  const msgVencido = mod.formatearErrorCanjeVencido('2026-11-01T12:00:00.000Z');
  assert.match(msgVencido, /caduc/i);
  assert.match(msgVencido, /01\/11\/2026/);
});
