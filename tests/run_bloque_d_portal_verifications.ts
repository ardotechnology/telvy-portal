/**
 * Verificación automatizada de Bloque D en portal-telvy
 */
import assert from 'node:assert';
import fs from 'node:fs';

async function main() {
  console.log('========================================================================');
  console.log('  VERIFICACIÓN PORTAL — BLOQUE D: RETENCIÓN DE DIDs POR 15 DÍAS        ');
  console.log('========================================================================\n');

  // 1. Verificar index.astro: pill-warn y texto "Reservado para ti · vence el"
  const indexPath = '/Users/ardogroup/Desktop/portal-telvy/app/src/pages/index.astro';
  const indexContent = fs.readFileSync(indexPath, 'utf-8');

  console.log('1. Verificando template index.astro...');
  assert.ok(
    indexContent.includes('Reservado para ti · vence el'),
    'index.astro debe contener el texto de badge "Reservado para ti · vence el"'
  );
  assert.ok(
    indexContent.includes('pill-warn'),
    'index.astro debe definir y usar la clase CSS .pill-warn'
  );
  assert.ok(
    indexContent.includes('didsActivos = didsData.filter'),
    'index.astro debe filtrar DIDs reservados para el conteo de servicios activos del banner'
  );
  console.log('   ✅ index.astro cumple con todos los requisitos de Bloque D.');

  // 2. Verificar cuenta/baja.astro: texto de advertencia actualizado
  const bajaPath = '/Users/ardogroup/Desktop/portal-telvy/app/src/pages/cuenta/baja.astro';
  const bajaContent = fs.readFileSync(bajaPath, 'utf-8');

  console.log('2. Verificando advertencia en cuenta/baja.astro...');
  const fraseEsperada = 'Tus números quedan reservados 15 días. Después vuelven al inventario y otra persona puede contratarlos.';
  assert.ok(
    bajaContent.includes(fraseEsperada),
    `cuenta/baja.astro debe contener la advertencia exacta:\n"${fraseEsperada}"`
  );
  console.log('   ✅ cuenta/baja.astro tiene la advertencia de retención de 15 días.');

  console.log('\n========================================================================');
  console.log('  TODAS LAS VERIFICACIONES DEL PORTAL BLOQUE D APROBADAS (100% OK)     ');
  console.log('========================================================================');
}

main().catch(err => {
  console.error('❌ Error en verificación:', err);
  process.exit(1);
});
