import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const indexSrc = fs.readFileSync(
  path.join(process.cwd(), 'app/src/pages/index.astro'),
  'utf8'
);

// 1) Aviso visible sobre alcance de cambios fiscales (próximas facturas vs ya emitidas)
assert.match(
  indexSrc,
  /los cambios aplican a las próximas facturas; las ya emitidas conservan los datos con los que se generaron/i
);

// 2) Confirmación visible tras guardar correctamente
assert.match(
  indexSrc,
  /Datos fiscales guardados y verificados correctamente\./
);

// 3) Sincronizar el formulario con data.cliente tras el primer guardado
assert.match(indexSrc, /if \(data\.cliente\)/);

console.log('✅ PORTAL AVISO Y CONFIRMACION DATOS FISCALES PASSED');
