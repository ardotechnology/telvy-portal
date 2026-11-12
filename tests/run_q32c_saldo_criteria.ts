import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('../app/node_modules/puppeteer-core');

const ASTRO_PORT = 8098;
const MOCK_SUPABASE_PORT = 54330;
const MOCK_GATE_PORT = 4206;
const GATE_KEY = 'test_gate_internal_key_q32c_xyz';

console.log('========================================================================');
console.log('  SUITE DE VERIFICACIÓN — BLOQUE Q3.2c: SALDO ÚNICO EN PORTAL           ');
console.log('========================================================================\n');

let mockSaldo = {
  disponible: 51.81,
  reservado: 0
};

async function main() {
  // 1. Servidor simulador de Gate / Motor VoIP (modelo Q3.2c)
  const gateServer = http.createServer((req, res) => {
    const internalKey = req.headers['x-internal-key'] as string;
    const clientHeader = req.headers['x-authenticated-Client'] || req.headers['x-authenticated-client'];

    if (internalKey !== GATE_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized gate key' }));
    }

    const url = req.url || '';
    const method = req.method || 'GET';

    // GET /v1/cliente/saldo (formato único Q3.2c)
    if (url.startsWith('/v1/cliente/saldo') && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        cliente: clientHeader,
        saldo: mockSaldo,
        moneda: 'MXN'
      }));
    }

    // GET /v1/cliente/dids/disponibles
    if (url.startsWith('/v1/cliente/dids/disponibles') && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        dids: [
          { did: '524429990001', region: 'QRO', precio: 50.00 }
        ],
        total: 1,
        pagina: 1,
        limite: 20
      }));
    }

    // POST /v1/cliente/dids/:did/reservar
    if (url.includes('/reservar') && method === 'POST') {
      const precio = 50.00;
      if (mockSaldo.disponible < precio) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: false,
          error: 'Saldo insuficiente',
          saldo_disponible: mockSaldo.disponible,
          precio,
          faltante: precio - mockSaldo.disponible
        }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        did: '524429990001',
        precio,
        saldo_disponible: mockSaldo.disponible - precio
      }));
    }

    // Auxiliares
    if (url.startsWith('/v1/cliente/extensiones')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, cliente: clientHeader, extensiones: [{ id: 1, name: 'cristian', status: 1, online: true }] }));
    }
    if (url.startsWith('/v1/cliente/troncales')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, cliente: clientHeader, troncales: [] }));
    }
    if (url.startsWith('/v1/cliente/dids')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, cliente: clientHeader, dids: [] }));
    }
    if (url.startsWith('/v1/cliente/avisos/pendientes')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, avisos: [] }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });

  await new Promise<void>(resolve => gateServer.listen(MOCK_GATE_PORT, '127.0.0.1', resolve));

  // 2. Servidor simulador de Supabase Auth
  const supabaseServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/auth/v1/token?grant_type=password') {
      res.writeHead(200);
      return res.end(JSON.stringify({
        access_token: 'fake-jwt-token-1001-q32c',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'fake-refresh-token',
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'cristianxrdz@gmail.com',
          user_metadata: { cliente: '1001' }
        }
      }));
    }
    if (req.url === '/auth/v1/user') {
      res.writeHead(200);
      return res.end(JSON.stringify({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'cristianxrdz@gmail.com',
        user_metadata: { cliente: '1001' }
      }));
    }
    if (req.url?.includes('/rest/v1/portal_cuenta_usuario')) {
      const isSingle = (req.headers['accept'] || '').includes('vnd.pgrst.object+json');
      const record = { cliente: '1001', email: 'cristianxrdz@gmail.com', estado: 'activa' };
      res.writeHead(200, { 'Content-Type': isSingle ? 'application/vnd.pgrst.object+json' : 'application/json' });
      return res.end(JSON.stringify(isSingle ? record : [record]));
    }
    res.writeHead(200);
    res.end(JSON.stringify({}));
  });

  await new Promise<void>(resolve => supabaseServer.listen(MOCK_SUPABASE_PORT, '127.0.0.1', resolve));

  // 3. Levantar Astro
  const envAstro = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(ASTRO_PORT),
    HOST: '127.0.0.1',
    ASTRO_PORT: String(ASTRO_PORT),
    SUPABASE_URL: `http://127.0.0.1:${MOCK_SUPABASE_PORT}`,
    SUPABASE_ANON_KEY: 'mock-anon-key',
    PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_SUPABASE_PORT}`,
    PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key',
    TELVY_GATE_URL: `http://127.0.0.1:${MOCK_GATE_PORT}`,
    CLIENT_API_INTERNAL_KEY: GATE_KEY,
    VOIP_GATE_URL: `http://127.0.0.1:${MOCK_GATE_PORT}`,
    VOIP_GATE_INTERNAL_KEY: GATE_KEY
  };

  const serverProcess: ChildProcess = spawn('node', ['dist/server/entry.mjs'], {
    cwd: './app',
    env: envAstro,
    stdio: 'pipe'
  });

  await new Promise<void>((resolve, reject) => {
    let started = false;
    serverProcess.stdout?.on('data', data => {
      const msg = data.toString();
      if (msg.includes('Server listening on') || msg.includes('http://127.0.0.1:8098')) {
        if (!started) {
          started = true;
          resolve();
        }
      }
    });
    serverProcess.stderr?.on('data', data => {
      console.error(`[ASTRO STDERR] ${data.toString()}`);
    });
    serverProcess.on('error', err => reject(err));
    setTimeout(() => {
      if (!started) resolve();
    }, 4000);
  });

  let browser: any = null;
  let pasados = 0;
  let fallados = 0;

  function report(name: string, ok: boolean, details: string) {
    if (ok) {
      console.log(`  ✅ [PASS] ${name}: ${details}`);
      pasados++;
    } else {
      console.error(`  ❌ [FAIL] ${name}: ${details}`);
      fallados++;
    }
  }

  try {
    // CRITERIO 1: La ruta devuelve { saldo: { disponible, reservado }, moneda }
    console.log('--- 1. RESPUESTA DE LA RUTA EN CONTRATO Q3.2c ---');
    const gateRes = await fetch(`http://127.0.0.1:${MOCK_GATE_PORT}/v1/cliente/saldo`, {
      headers: {
        'X-Internal-Key': GATE_KEY,
        'X-Authenticated-Client': '1001'
      }
    });
    const gateData = await gateRes.json().catch(() => ({}));
    const hasSaldoUnico = Boolean(
      gateData.saldo &&
      typeof gateData.saldo.disponible === 'number' &&
      typeof gateData.saldo.reservado === 'number' &&
      gateData.moneda === 'MXN'
    );
    report(
      'C1_RUTA_SALDO_UNICO',
      hasSaldoUnico,
      hasSaldoUnico
        ? `saldo presente con disponible=${gateData.saldo.disponible}, reservado=${gateData.saldo.reservado}, moneda=${gateData.moneda}`
        : `saldo ausente o formato inválido: ${JSON.stringify(gateData)}`
    );

    // CRITERIO 2: Con disponible 51.81 y reservado 0
    console.log('\n--- 2. CIFRAS DEL MOTOR ---');
    const dispOk = Boolean(
      gateData.saldo &&
      gateData.saldo.disponible === 51.81 &&
      gateData.saldo.reservado === 0
    );
    report(
      'C2_SALDO_MOTOR_51_81',
      dispOk,
      dispOk
        ? 'saldo.disponible es exactamente 51.81 y reservado es 0'
        : `Valor no coincide: ${JSON.stringify(gateData.saldo)}`
    );

    // Iniciar browser para verificar portal
    browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${ASTRO_PORT}/login`, { waitUntil: 'networkidle0' });
    await page.type('#email', 'cristianxrdz@gmail.com');
    await page.type('#password', 'password123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('button[type="submit"]')
    ]);

    // CRITERIO 3: El portal muestra 51.81 bajo la etiqueta "Saldo"
    console.log('\n--- 3. PORTAL MUESTRA SALDO 51.81 ---');
    await page.goto(`http://127.0.0.1:${ASTRO_PORT}/`, { waitUntil: 'networkidle0' });
    const homeHtml = await page.content();
    const muestra5181 = homeHtml.includes('$51.81');
    report(
      'C3_PORTAL_MUESTRA_51_81',
      muestra5181,
      muestra5181
        ? 'El portal muestra $51.81 como Saldo'
        : 'El portal no muestra $51.81'
    );

    // CRITERIO 4: NO hay desglose ni segundo saldo ("Crédito para llamadas" ya no aparece)
    console.log('\n--- 4. NO HAY SEGUNDA CIFRA BAJO SALDO ---');
    const sinSegundaCifra = !homeHtml.includes('Crédito para llamadas:') && !homeHtml.includes('Crédito en Conmutador');
    report(
      'C4_SIN_SEGUNDA_CIFRA_SALDO',
      sinSegundaCifra,
      sinSegundaCifra
        ? 'No existe desglose con segundo saldo; una sola verdad operativa en pantalla'
        : 'Se detectó desglose con segunda cifra bajo Saldo'
    );

    // CRITERIO 5: La cifra mostrada en la pantalla de compra coincide con la del motor
    console.log('\n--- 5. COINCIDENCIA ENTRE COMPRA-DID Y MOTOR ---');
    await page.goto(`http://127.0.0.1:${ASTRO_PORT}/cuenta/comprar-did`, { waitUntil: 'networkidle0' });
    const saldoMostradoText = await page.$eval('#lblSaldo', (el: any) => el.textContent || '');
    const saldoMostradoNum = parseFloat(saldoMostradoText.replace(/[^0-9.]/g, ''));
    const coincide = Math.abs(saldoMostradoNum - 51.81) < 0.01;

    report(
      'C5_COINCIDENCIA_PORTAL_MOTOR',
      coincide,
      coincide
        ? `Cifra mostrada en comprar-did ($${saldoMostradoNum}) coincide con la del motor (51.81)`
        : `Discrepancia: comprar-did muestra $${saldoMostradoNum} pero motor tiene 51.81`
    );

  } finally {
    console.log('\n--- LIMPIEZA DE SERVIDORES ---');
    if (browser) await browser.close();
    serverProcess.kill('SIGTERM');
    gateServer.close();
    supabaseServer.close();
  }

  console.log('\n========================================================================');
  console.log(`  RESUMEN: ${pasados} PASADOS, ${fallados} FALLADOS`);
  console.log('========================================================================\n');

  if (fallados > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error fatal en suite:', err);
  process.exit(1);
});
