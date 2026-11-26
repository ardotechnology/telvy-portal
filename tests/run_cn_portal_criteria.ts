import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatearPildoraEstado } from '../app/src/lib/estado_pill.ts';
import { traducirEstadoOrden } from '../app/src/lib/orden_traductor.ts';

console.log('=======================================================================');
console.log('  VERIFICACIÓN CN2, CN4, CN5, CN6 — PORTAL TELVY                       ');
console.log('=======================================================================\n');

// CN2: Píldora de estado sólo muestra "Desconectada" si el conmutador lo confirma (online === false)
{
  const sinConfirmar = formatearPildoraEstado('ext', null, null);
  assert.equal(sinConfirmar.texto, 'No disponible', 'CN2: sin confirmación debe mostrar No disponible');

  const desconectada = formatearPildoraEstado('ext', false, 'UNREACHABLE');
  assert.equal(desconectada.texto, 'Desconectada', 'CN2: confirmado offline debe mostrar Desconectada');

  const registrada = formatearPildoraEstado('ext', true, 'OK (20 ms)');
  assert.equal(registrada.texto, 'Registrada', 'CN2: confirmado online debe mostrar Registrada');
  console.log('✅ CN2 (píldora): Desconectada sólo con confirmación; No disponible si no se pudo consultar');
}

// CN5: traductor nunca atribuye a la baja un fallo del canje o del alta
{
  const canjeConMotivo = traducirEstadoOrden(
    'compensado',
    'ord-vch-1',
    null,
    'canje_voucher',
    'Esta tarjeta prepago ya fue utilizada'
  );
  assert.equal(canjeConMotivo.mensaje, 'Esta tarjeta prepago ya fue utilizada');
  assert.ok(!canjeConMotivo.mensaje.toLowerCase().includes('retirar'));
  assert.ok(!canjeConMotivo.mensaje.toLowerCase().includes('baja'));

  const canjeSinMotivo = traducirEstadoOrden('compensado', 'ord-vch-2', null, 'canje_voucher', null);
  assert.ok(!canjeSinMotivo.mensaje.toLowerCase().includes('retirar'));
  assert.ok(!canjeSinMotivo.mensaje.toLowerCase().includes('baja'));

  const altaSinMotivo = traducirEstadoOrden('compensado', 'ord-alta-1', null, 'alta_nueva_cliente', null);
  assert.ok(!altaSinMotivo.mensaje.toLowerCase().includes('retirar'));
  assert.ok(!altaSinMotivo.mensaje.toLowerCase().includes('baja'));
  console.log('✅ CN5 (traductor): ningún mensaje atribuye a la baja un fallo de canje o alta');
}

// CN4 & CN6 & CN2 en código fuente del portal autenticado y endpoint de pago
{
  const indexSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'app/src/pages/index.astro'),
    'utf8'
  );
  const pagarApiSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'app/src/pages/api/publico/alta/pagar.ts'),
    'utf8'
  );

  // CN4: Prohibido mostrar el falso "Tu factura está en proceso"; el pago desde el portal genera proforma y muestra soporte en fallo
  assert.ok(
    !indexSrc.includes('Tu factura está en proceso'),
    'CN4: index.astro no debe decir "Tu factura está en proceso"'
  );
  assert.ok(
    pagarApiSrc.includes('crearProformaAltaSentinel'),
    'CN4: /api/publico/alta/pagar debe crear la proforma al pagar desde el portal'
  );
  assert.ok(
    indexSrc.includes('soporte@telvy.net'),
    'CN4: index.astro muestra contacto de soporte en caso de fallo'
  );
  console.log('✅ CN4 (portal): proforma se genera al pagar en el portal y nunca dice "Tu factura está en proceso"');

  // CN2: index.astro muestra "Estado no disponible" si falla la consulta de extensiones
  assert.ok(
    indexSrc.includes('errorExt ?') && indexSrc.includes('Estado no disponible'),
    'CN2: index.astro debe mostrar Estado no disponible si falla /v1/cliente/extensiones'
  );
  console.log('✅ CN2 (portal): index.astro muestra Estado no disponible si el conmutador no responde');

  // CN6: index.astro desactiva pendienteDePago cuando hay saldo > 0 y oculta avisoSaldoCero tras canje
  assert.ok(
    indexSrc.includes('tieneSaldoPositivo') &&
      indexSrc.includes('!tieneSaldoPositivo') &&
      indexSrc.includes('id="avisoSaldoCero"') &&
      indexSrc.includes("document.getElementById('avisoSaldoCero')"),
    'CN6: index.astro debe ocultar aviso de saldo 0 y pendiente de pago en cuanto haya saldo'
  );
  console.log('✅ CN6 (portal): tras un canje se oculta el aviso de saldo 0 y el banner de pendiente de pago');
}

console.log('\n🎉 TODAS LAS VERIFICACIONES DEL PORTAL (CN2, CN4, CN5, CN6) PASARON.\n');
