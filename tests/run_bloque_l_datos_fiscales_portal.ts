import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  esFichaFiscalPendiente,
  guardarDatosFiscalesSentinel,
  obtenerDatosFiscalesSentinel,
  resolverServidorClienteMotor,
  usaRfcGenerico
} from '../app/src/lib/sentinel_fiscales.ts';
import { GET, POST } from '../app/src/pages/api/cuenta/datos-fiscales.ts';

function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else out.push(full);
  }
  return out;
}

async function startMockSentinelFiscalServer(expectedKey: string) {
  let ficha: Record<string, any> = {
    id: '22222222-2222-4222-8222-222222222222',
    rfc: 'XAXX010101000',
    razon_social: 'Cliente 1001 Borrador',
    nombre_comercial: 'Cliente 1001',
    regimen_fiscal: '601',
    codigo_postal: null,
    uso_cfdi_sat: 'G03',
    correo_facturacion: null,
    correo_cuenta: '1001@telvy.mx',
    kyc_status: 'pendiente'
  };

  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${expectedKey}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'No autorizado' }));
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/integracion/datos-fiscales') {
      const clienteUsername = url.searchParams.get('cliente_username');
      if (clienteUsername !== '1001') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No existe vínculo para la cuenta indicada' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cliente: ficha }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/integracion/datos-fiscales') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

      if (body.cliente_username !== '1001') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No existe vínculo para la cuenta indicada' }));
        return;
      }

      const rfc = String(body.rfc || '').trim().toUpperCase();
      if (rfc === 'XAXX010101000') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            error:
              'El RFC genérico XAXX010101000 es un marcador de borrador y no se acepta como dato fiscal definitivo'
          })
        );
        return;
      }

      ficha = {
        ...ficha,
        rfc,
        razon_social: body.razon_social,
        ...(body.nombre_comercial ? { nombre_comercial: body.nombre_comercial } : {}),
        regimen_fiscal: body.regimen_fiscal,
        codigo_postal: body.codigo_postal,
        uso_cfdi_sat: String(body.uso_cfdi_sat || '').toUpperCase(),
        ...(body.correo_facturacion ? { correo_facturacion: body.correo_facturacion } : {}),
        kyc_status: 'verificado'
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cliente: ficha }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function main() {
  const SECRET = 'clave-secreta-portal-l5-test';
  const mockSentinel = await startMockSentinelFiscalServer(SECRET);
  process.env.SENTINEL_URL = mockSentinel.baseUrl;
  process.env.SENTINEL_INTEGRACION_KEY = SECRET;
  process.env.TELVY_DEFAULT_SERVIDOR = 'MB-Edge-MTY';

  try {
    // L2: sin sesión -> 401 en API y middleware redirige a /login
    const resNoSessionGet = await GET({ locals: { user: null, portalCuenta: null } } as any);
    const resNoSessionPost = await POST({
      request: new Request('http://localhost/api/cuenta/datos-fiscales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfc: 'ACM200101AB1' })
      }),
      locals: { user: null, portalCuenta: null }
    } as any);
    assert.equal(resNoSessionGet.status, 401);
    assert.equal(resNoSessionPost.status, 401);
    const mwSrc = fs.readFileSync(path.join(process.cwd(), 'app/src/middleware.ts'), 'utf8');
    assert.match(mwSrc, /context\.redirect\('\/login'\)/);
    console.log('L2_SIN_SESION:', JSON.stringify({ getStatus: resNoSessionGet.status, postStatus: resNoSessionPost.status, redirectLoginEnMiddleware: true }));

    // L1: con sesión, lee ficha borrador actual y detecta pendiente
    const locals1001 = {
      user: { id: 'usr-1001', email: '1001@telvy.mx' },
      portalCuenta: { cliente: '1001', email: '1001@telvy.mx', estado: 'activa' }
    };
    const resL1 = await GET({ locals: locals1001 } as any);
    const dataL1 = await resL1.json();
    assert.equal(resL1.status, 200);
    assert.equal(dataL1.cliente.rfc, 'XAXX010101000');
    assert.equal(dataL1.cliente.kyc_status, 'pendiente');
    assert.equal(esFichaFiscalPendiente(dataL1.cliente), true);
    console.log('L1_FICHA_INICIAL_SESION:', JSON.stringify(dataL1.cliente));

    // L4: RFC genérico rechazado con el mensaje de marcador de borrador tal cual
    const resL4 = await POST({
      request: new Request('http://localhost/api/cuenta/datos-fiscales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rfc: 'XAXX010101000',
          razon_social: 'Cliente 1001 SA',
          nombre_comercial: 'Telvy 1001',
          regimen_fiscal: '601',
          codigo_postal: '64000',
          uso_cfdi_sat: 'G03',
          correo_facturacion: 'facturas@1001.mx'
        })
      }),
      locals: locals1001
    } as any);
    const dataL4 = await resL4.json();
    console.log('L4_RECHAZO_RFC_GENERICO:', JSON.stringify({ status: resL4.status, error: dataL4.error }));
    assert.equal(resL4.status, 400);
    assert.match(String(dataL4.error), /XAXX010101000/);
    assert.match(String(dataL4.error), /borrador/i);

    // L3: envío de los 7 campos actualiza a verificado y lectura de vuelta confirma
    const resL3 = await POST({
      request: new Request('http://localhost/api/cuenta/datos-fiscales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rfc: 'TEL210101AB2',
          razon_social: 'CLIENTE 1001 SA DE CV',
          nombre_comercial: 'Telvy 1001',
          regimen_fiscal: '601',
          codigo_postal: '64000',
          uso_cfdi_sat: 'G03',
          correo_facturacion: 'facturas@1001.mx'
        })
      }),
      locals: locals1001
    } as any);
    const dataL3 = await resL3.json();
    assert.equal(resL3.status, 200);
    assert.equal(dataL3.cliente.kyc_status, 'verificado');
    assert.equal(esFichaFiscalPendiente(dataL3.cliente), false);

    const resReadback = await GET({ locals: locals1001 } as any);
    const dataReadback = await resReadback.json();
    console.log('L3_FICHA_VERIFICADA_READBACK:', JSON.stringify(dataReadback.cliente));
    assert.equal(dataReadback.cliente.rfc, 'TEL210101AB2');
    assert.equal(dataReadback.cliente.kyc_status, 'verificado');

    // L5 + N7: la clave de integración NO aparece en index.astro (<script>/HTML) ni en dist/client/
    // y el portal muestra invitación (no bloqueo) cuando kyc_status='verificado' con RFC genérico
    assert.equal(
      esFichaFiscalPendiente({
        id: 'x',
        rfc: 'XAXX010101000',
        razon_social: 'Cliente Nuevo',
        nombre_comercial: 'Cliente Nuevo',
        regimen_fiscal: '616',
        codigo_postal: '76100',
        uso_cfdi_sat: 'S01',
        correo_facturacion: null,
        kyc_status: 'verificado'
      }),
      false,
      'N7: ficha verificada con XAXX010101000 NO debe tratarse como pendiente'
    );
    assert.equal(
      usaRfcGenerico({
        id: 'x',
        rfc: 'XAXX010101000',
        razon_social: 'Cliente Nuevo',
        nombre_comercial: 'Cliente Nuevo',
        regimen_fiscal: '616',
        codigo_postal: '76100',
        uso_cfdi_sat: 'S01',
        correo_facturacion: null,
        kyc_status: 'verificado'
      }),
      true
    );
    const indexSrc = fs.readFileSync(path.join(process.cwd(), 'app/src/pages/index.astro'), 'utf8');
    assert.match(indexSrc, /seccion-datos-fiscales/);
    assert.match(indexSrc, /Facturación a Público en General/i);
    assert.match(indexSrc, /PUBLICO EN GENERAL/);
    assert.match(indexSrc, /616/);
    assert.match(indexSrc, /domicilio fiscal del emisor/i);
    assert.equal(indexSrc.includes('sin datos fiscales verificados no se puede emitir factura'), false, 'N7: ya no debe mostrar mensaje de bloqueo');
    assert.equal(indexSrc.includes('SENTINEL_INTEGRACION_KEY'), false, 'L5: index.astro no debe referenciar la clave');

    // P2 & P3: cliente de MB-Core usa servidor devuelto por el motor (no el default MB-Edge-MTY)
    const servidorCore = await resolverServidorClienteMotor('73941', {
      gateUrl: 'http://motor.test:4100',
      internalKey: 'k-test',
      fetcher: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, cliente: '73941', servidor: 'MB-Core', saldo: { disponible: 50, reservado: 0 }, moneda: 'MXN' })
      })) as any
    });
    console.log('P2_P3_SERVIDOR_CORE:', JSON.stringify({ cliente: '73941', servidorResuelto: servidorCore }));
    assert.equal(servidorCore, 'MB-Core');

    const clientFiles = walkDir(path.join(process.cwd(), 'app/dist/client'));
    const leaks = clientFiles.filter((f) => {
      const content = fs.readFileSync(f, 'utf8');
      return content.includes('SENTINEL_INTEGRACION_KEY') || content.includes(SECRET);
    });
    console.log('L5_AUDITORIA_NAVEGADOR:', JSON.stringify({ clientFilesChecked: clientFiles.length, leaks: leaks.length }));
    assert.equal(leaks.length, 0, `L5: fuga de clave en bundle cliente: ${leaks.join(', ')}`);

    console.log('✅ PORTAL TELVY DATOS FISCALES L1-L5 PASSED');
  } finally {
    delete process.env.SENTINEL_URL;
    delete process.env.SENTINEL_INTEGRACION_KEY;
    await mockSentinel.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
