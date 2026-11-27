import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const indexSrc = fs.readFileSync(
  path.join(process.cwd(), 'app/src/pages/index.astro'),
  'utf8'
);

const avisoRe =
  /Los cambios aplican a las próximas facturas; las ya emitidas conservan los datos con los que se generaron\./gi;

// 1) El aviso aparece exactamente UNA sola vez (no duplicado)
const ocurrencias = indexSrc.match(avisoRe) || [];
assert.equal(
  ocurrencias.length,
  1,
  `El aviso debe aparecer exactamente 1 vez, pero apareció ${ocurrencias.length}`
);

// 2) La descripción de la tarjeta conserva únicamente el texto informativo base
const descMatch = indexSrc.match(
  /<h2 class="card-title">Datos fiscales<\/h2>\s*<p class="card-desc">([^<]+)<\/p>/
);
assert.ok(descMatch, 'Debe existir la descripción de la tarjeta de Datos fiscales');
assert.equal(
  descMatch[1].trim(),
  'Información para la emisión de tus facturas CFDI 4.0.',
  'La descripción de la tarjeta no debe esconder el aviso de alcance fiscal'
);

// 3) El aviso vive como elemento propio visible junto al feedback en .fiscal-actions
const actionsMatch = indexSrc.match(
  /<div class="fiscal-actions">([\s\S]*?)<\/div>\s*<\/form>/
);
assert.ok(actionsMatch, 'Debe existir el bloque .fiscal-actions del formulario fiscal');
assert.match(actionsMatch[1], /id="fiscalFeedback"/);
assert.match(actionsMatch[1], /id="fiscalScopeNotice"/);
assert.match(actionsMatch[1], avisoRe);

// 4) Confirmación visible y sincronización tras guardar se mantienen intactas
assert.match(
  indexSrc,
  /Datos fiscales guardados y verificados correctamente\./
);
assert.match(indexSrc, /if \(data\.cliente\)/);

console.log('✅ PORTAL AVISO VISIBLE Y CONFIRMACION DATOS FISCALES PASSED');
