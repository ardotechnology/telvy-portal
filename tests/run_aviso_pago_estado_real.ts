import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('=======================================================================');
console.log('  VERIFICACIÓN: AVISO DE PAGO USA ESTADO REAL DEL ALTA, NO EL SALDO    ');
console.log('=======================================================================\n');

const indexSrc = fs.readFileSync(
  path.resolve(process.cwd(), 'app/src/pages/index.astro'),
  'utf8'
);

// 1. index.astro NO debe usar el saldo (tieneSaldoPositivo / saldoPostCanje > 0) como señal de pago
assert.ok(
  !indexSrc.includes('tieneSaldoPositivo'),
  'index.astro NO debe usar tieneSaldoPositivo (saldo) para decidir pendienteDePago'
);
assert.ok(
  !indexSrc.includes('if (Number.isFinite(saldoPostCanje) && saldoPostCanje > 0)'),
  'index.astro NO debe condicionar el cierre del banner de pago a saldoPostCanje > 0'
);
assert.ok(
  indexSrc.includes('resolverEstadoPagoPortal'),
  'index.astro debe derivar el aviso desde resolverEstadoPagoPortal (estado real del alta y línea)'
);
assert.ok(
  indexSrc.includes('id="bannerLineaActiva"'),
  'index.astro debe mostrar que la línea está activa cuando el pago quedó acreditado'
);
console.log('✅ 1) index.astro usa estado real del alta/línea y deja de usar el saldo como señal de pago');

// 2. Comportamiento de resolverEstadoPagoPortal
const modPath = '../app/src/lib/estado_pago_portal.ts';
const { resolverEstadoPagoPortal } = await import(modPath);

// Caso 1164 real: estado_pago_alta = 'pagado', línea activa, saldo 0 (pago por tarjeta) y proforma vieja TEL-0010/11/2026
{
  const res = resolverEstadoPagoPortal({
    registroAlta: {
      plan_slug: 'solo-100',
      paquete_nombre: 'Solo 100',
      paquete_precio: 199,
      paquete_moneda: 'MXN',
      estado_pago_alta: 'pagado'
    },
    facturaPendiente: {
      id: 'fac-10',
      folio: 'TEL-0010/11/2026',
      descripcion: 'Alta Solo 100 — Cliente 1164',
      total: 199,
      moneda: 'MXN',
      estado_pago: 'pendiente',
      ficha_pago_url: 'https://sentinel.ardo.group/factura/tok-10'
    },
    tieneLineaActiva: true
  });

  assert.equal(res.pendienteDePago, false, 'Con estado_pago_alta=pagado NO debe mostrar aviso de pendiente');
  assert.equal(res.mostrarLineaActiva, true, 'Con pago acreditado y línea activa debe mostrar línea activa');
  assert.equal(res.folioVisible, null, 'Con pago acreditado NO debe mostrar el folio de la proforma vieja');
  assert.equal(res.fichaPagoUrl, null, 'Con pago acreditado NO debe ofrecer enlace de pago de proforma vieja');
  console.log('✅ 2) Caso 1164 (pagado + línea activa + proforma vieja): sin aviso pendiente ni folio TEL-0010, muestra línea activa');
}

// Caso pendiente real: estado_pago_alta = 'pendiente' -> sí muestra aviso y folio vigente
{
  const res = resolverEstadoPagoPortal({
    registroAlta: {
      plan_slug: 'solo-100',
      paquete_nombre: 'Solo 100',
      paquete_precio: 199,
      paquete_moneda: 'MXN',
      estado_pago_alta: 'pendiente'
    },
    facturaPendiente: {
      id: 'fac-10',
      folio: 'TEL-0010/11/2026',
      descripcion: 'Alta Solo 100 — Cliente 1164',
      total: 199,
      moneda: 'MXN',
      estado_pago: 'pendiente',
      ficha_pago_url: 'https://sentinel.ardo.group/factura/tok-10'
    },
    tieneLineaActiva: false
  });

  assert.equal(res.pendienteDePago, true, 'Con estado_pago_alta=pendiente SÍ debe mostrar aviso de pendiente');
  assert.equal(res.mostrarLineaActiva, false);
  assert.equal(res.folioVisible, 'TEL-0010/11/2026');
  assert.equal(res.fichaPagoUrl, 'https://sentinel.ardo.group/factura/tok-10');
  console.log('✅ 3) Caso alta pendiente: muestra aviso de pendiente y folio vigente');
}

// Caso pagado pero aún sin línea activa
{
  const res = resolverEstadoPagoPortal({
    registroAlta: {
      plan_slug: 'solo-100',
      paquete_nombre: 'Solo 100',
      paquete_precio: 199,
      paquete_moneda: 'MXN',
      estado_pago_alta: 'pagado'
    },
    facturaPendiente: {
      id: 'fac-10',
      folio: 'TEL-0010/11/2026',
      descripcion: 'Alta Solo 100',
      total: 199,
      moneda: 'MXN',
      estado_pago: 'pendiente',
      ficha_pago_url: 'https://sentinel.ardo.group/factura/tok-10'
    },
    tieneLineaActiva: false
  });

  assert.equal(res.pendienteDePago, false);
  assert.equal(res.mostrarLineaActiva, false);
  assert.equal(res.folioVisible, null);
  console.log('✅ 4) Caso pagado sin línea activa aún: no muestra pendiente ni folio viejo, tampoco miente que la línea está activa');
}

console.log('\n🎉 TODAS LAS VERIFICACIONES DE ESTADO REAL DE PAGO PASARON.\n');
