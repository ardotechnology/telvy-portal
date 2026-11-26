import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardarDatosFiscalesSentinel } from '../app/src/lib/sentinel_fiscales.ts';

async function main() {
  const captured: Array<Record<string, any>> = [];
  const fakeFetch: typeof fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    captured.push(body);
    return new Response(
      JSON.stringify({
        ok: true,
        cliente: {
          id: '11111111-1111-4111-8111-111111111111',
          rfc: body.rfc,
          tipo_persona: body.tipo_persona ?? 'no_especificado',
          nombres: body.nombres ?? null,
          apellidos: body.apellidos ?? null,
          razon_social:
            body.tipo_persona === 'fisica'
              ? `${body.nombres} ${body.apellidos}`.trim()
              : body.razon_social,
          nombre_comercial: body.nombre_comercial || null,
          regimen_fiscal: body.regimen_fiscal,
          codigo_postal: body.codigo_postal,
          uso_cfdi_sat: body.uso_cfdi_sat,
          correo_facturacion: body.correo_facturacion || null,
          kyc_status: 'verificado'
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  // 1) Persona física envía tipo_persona='fisica', nombres y apellidos por separado
  const resFisica = await guardarDatosFiscalesSentinel(
    {
      servidor: 'MB-Edge-MTY',
      cliente_username: '1164',
      tipo_persona: 'fisica',
      nombres: 'Cristian Xavier',
      apellidos: 'Rodríguez Rodríguez',
      rfc: 'RORC900101AB1',
      regimen_fiscal: '612',
      codigo_postal: '64000',
      uso_cfdi_sat: 'G03'
    } as any,
    { sentinelUrl: 'http://sentinel.test', integracionKey: 'test-key', fetcher: fakeFetch }
  );
  assert.equal(resFisica.ok, true);
  assert.equal(captured[0].tipo_persona, 'fisica');
  assert.equal(captured[0].nombres, 'Cristian Xavier');
  assert.equal(captured[0].apellidos, 'Rodríguez Rodríguez');
  assert.equal(captured[0].razon_social, undefined);

  // 2) Persona moral envía tipo_persona='moral' y razon_social
  const resMoral = await guardarDatosFiscalesSentinel(
    {
      servidor: 'MB-Edge-MTY',
      cliente_username: '1164',
      tipo_persona: 'moral',
      razon_social: 'ACME TELECOM',
      rfc: 'ACM200101AB1',
      regimen_fiscal: '601',
      codigo_postal: '64000',
      uso_cfdi_sat: 'G03'
    } as any,
    { sentinelUrl: 'http://sentinel.test', integracionKey: 'test-key', fetcher: fakeFetch }
  );
  assert.equal(resMoral.ok, true);
  assert.equal(captured[1].tipo_persona, 'moral');
  assert.equal(captured[1].razon_social, 'ACME TELECOM');
  assert.equal(captured[1].nombres, undefined);
  assert.equal(captured[1].apellidos, undefined);

  // 3) Formulario en index.astro incluye selector tipo_persona y campos separados nombres / apellidos
  const indexSrc = fs.readFileSync(
    path.join(process.cwd(), 'app/src/pages/index.astro'),
    'utf8'
  );
  assert.match(indexSrc, /name="tipo_persona"/);
  assert.match(indexSrc, /name="nombres"/);
  assert.match(indexSrc, /name="apellidos"/);

  console.log('✅ PORTAL DATOS FISCALES PERSONA FISICA / MORAL PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
