import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('=======================================================================');
console.log('  VERIFICACIÓN: /alta-confirmada NO MUESTRA PLAN, IMPORTE NI PAGO      ');
console.log('=======================================================================\n');

const altaConfirmadaSrc = fs.readFileSync(
  path.resolve(process.cwd(), 'app/src/pages/alta-confirmada.astro'),
  'utf8'
);
const indexSrc = fs.readFileSync(
  path.resolve(process.cwd(), 'app/src/pages/index.astro'),
  'utf8'
);

// 1. La pantalla pública de correo confirmado NO debe mostrar datos del plan, importe ni enlace/botón de pago
assert.ok(
  !altaConfirmadaSrc.includes('Plan elegido'),
  'alta-confirmada.astro NO debe mostrar "Plan elegido"'
);
assert.ok(
  !altaConfirmadaSrc.includes('ficha_pago_url'),
  'alta-confirmada.astro NO debe mostrar ni enlazar ficha_pago_url'
);
assert.ok(
  !altaConfirmadaSrc.includes('montoVisible') && !altaConfirmadaSrc.includes('paquete_precio'),
  'alta-confirmada.astro NO debe mostrar importe ni precio del paquete'
);
assert.ok(
  !altaConfirmadaSrc.includes('nombrePlanVisible') && !altaConfirmadaSrc.includes('paquete_nombre'),
  'alta-confirmada.astro NO debe mostrar nombre del plan ni paquete'
);
assert.ok(
  !altaConfirmadaSrc.includes('/api/publico/alta/pagar') && !altaConfirmadaSrc.includes('/api/publico/alta/ficha-pago'),
  'alta-confirmada.astro NO debe consultar ficha-pago ni iniciar pago desde la pantalla pública'
);
assert.ok(
  !altaConfirmadaSrc.includes('obtenerDatosFiscalesSentinel') && !altaConfirmadaSrc.includes('crearProformaAltaSentinel'),
  'alta-confirmada.astro NO debe cargar datos comerciales/fiscales del cliente'
);
console.log('✅ 1) alta-confirmada.astro no expone plan, importe ni enlace de pago');

// 2. La pantalla pública SÍ confirma el correo, limpia sesión previa y ofrece entrar al portal
assert.ok(
  altaConfirmadaSrc.includes('cerrarSesionPortal(Astro)'),
  'alta-confirmada.astro conserva el cierre defensivo de sesión previa'
);
assert.ok(
  altaConfirmadaSrc.includes('¡Correo confirmado!') && altaConfirmadaSrc.includes('href={loginHref}'),
  'alta-confirmada.astro confirma el correo y ofrece entrar al portal (loginHref)'
);
console.log('✅ 2) alta-confirmada.astro solo confirma el correo y ofrece entrar al portal');

// 3. El portal autenticado (index.astro) SÍ tiene el botón/enlace de pago con sesión iniciada
assert.ok(
  indexSrc.includes('Astro.locals.portalCuenta?.cliente') &&
    indexSrc.includes('btnGenerarProformaPortal') &&
    indexSrc.includes('/api/publico/alta/pagar'),
  'index.astro debe requerir sesión iniciada y ofrecer el botón de pago dentro de la cuenta'
);
console.log('✅ 3) index.astro (con sesión iniciada) conserva el botón de pago dentro del portal');

console.log('\n🎉 TODAS LAS VERIFICACIONES DE /alta-confirmada PASARON.\n');
