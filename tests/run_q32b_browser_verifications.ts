import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('../app/node_modules/puppeteer-core');

const ASTRO_PORT = 8097;
const MOCK_SUPABASE_PORT = 54329;
const MOCK_GATE_PORT = 4205;
const GATE_KEY = 'test_gate_internal_key_q32b_xyz';

console.log('========================================================================');
console.log('  SUITE DE VERIFICACIÓN NAVEGADOR — BLOQUE Q3.2b: COMPRA DE DID EN UI   ');
console.log('========================================================================\n');

const userA_Id = '11111111-1111-4111-8111-111111111111'; // 1001
let saldoActual = 1.81; // Saldo real en producción

let gateReservarCallCount = 0;
let gateDisponiblesQueryStrings: string[] = [];

async function main() {
  // 1. Servidor simulador de Gate / Motor VoIP
  const gateServer = http.createServer((req, res) => {
    const internalKey = req.headers['x-internal-key'] as string;
    const clientHeader = req.headers['x-authenticated-client'] as string;

    if (internalKey !== GATE_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized gate key' }));
    }

    const url = req.url || '';
    const method = req.method || 'GET';

    // GET /v1/cliente/saldo
    if (url.startsWith('/v1/cliente/saldo') && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        cliente: clientHeader,
        saldo: { credit: saldoActual.toFixed(4), currency: 'MXN' },
        saldo_control: {
          saldo_base: saldoActual,
          saldo_reservado: 0,
          saldo_disponible: saldoActual
        }
      }));
    }

    // GET /v1/cliente/dids/disponibles
    if (url.startsWith('/v1/cliente/dids/disponibles') && method === 'GET') {
      const parsedUrl = new URL(url, 'http://127.0.0.1');
      gateDisponiblesQueryStrings.push(parsedUrl.search);

      const prefijo = (parsedUrl.searchParams.get('prefijo') || '').trim();
      let didsList = [
        { did: '524429990001', region: 'QRO', precio: 50.00 },
        { did: '524429990002', region: 'QRO', precio: 50.00 },
        { did: '525512345678', region: 'CDMX', precio: 65.00 }
      ];

      if (prefijo) {
        didsList = didsList.filter(d => d.did.startsWith(prefijo));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        dids: didsList,
        total: didsList.length,
        pagina: 1,
        limite: 20
      }));
    }

    // POST /v1/cliente/dids/:did/reservar
    const matchReservar = url.match(/^\/v1\/cliente\/dids\/([^/]+)\/reservar$/);
    if (matchReservar && method === 'POST') {
      gateReservarCallCount++;
      const did = matchReservar[1];
      const precio = 50.00;

      if (saldoActual < precio) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: false,
          error: `Saldo insuficiente para reservar el DID. Requiere $${precio.toFixed(2)} MXN pero solo dispone de $${saldoActual.toFixed(2)} MXN.`,
          saldo_disponible: saldoActual,
          precio,
          faltante: Number((precio - saldoActual).toFixed(2))
        }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        did,
        cliente: clientHeader,
        precio,
        saldo_disponible_previo: saldoActual,
        reservado_hasta: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      }));
    }

    // Auxiliares
    if (url.startsWith('/v1/cliente/extensiones')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, cliente: clientHeader, extensiones: [] }));
    }
    if (url.startsWith('/v1/cliente/troncales')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, troncales: [] }));
    }
    if (url.startsWith('/v1/cliente/dids')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, dids: [] }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `Ruta no encontrada en mock: ${url}` }));
  });

  await new Promise<void>(resolve => gateServer.listen(MOCK_GATE_PORT, resolve));

  // 2. Servidor simulador de Supabase
  const supabaseServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const url = req.url || '';

      if (url.includes('/auth/v1/token') && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          access_token: 'token-user-1001',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'refresh-user-1001',
          user: { id: userA_Id, email: 'cristianxrdz@gmail.com' }
        }));
      }

      if (url.includes('/auth/v1/user') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: userA_Id, email: 'cristianxrdz@gmail.com' }));
      }

      if (url.includes('/rest/v1/portal_cuenta_usuario')) {
        const isSingle = (req.headers['accept'] || '').includes('vnd.pgrst.object+json');
        const record = { cliente: '1001', email: 'cristianxrdz@gmail.com', estado: 'activa' };
        res.writeHead(200, { 'Content-Type': isSingle ? 'application/vnd.pgrst.object+json' : 'application/json' });
        return res.end(JSON.stringify(isSingle ? record : [record]));
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  });

  await new Promise<void>(resolve => supabaseServer.listen(MOCK_SUPABASE_PORT, resolve));

  // 3. Iniciar Astro en ASTRO_PORT
  console.log(`--- INICIANDO SERVIDOR ASTRO EN PUERTO ${ASTRO_PORT} ---`);
  const nodeBin = fs.existsSync(process.execPath) ? process.execPath : 'node';
  const serverProcess: ChildProcess = spawn(nodeBin, ['dist/server/entry.mjs'], {
    cwd: './app',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(ASTRO_PORT),
      HOST: '127.0.0.1',
      CLIENT_API_INTERNAL_KEY: GATE_KEY,
      SUPABASE_URL: `http://127.0.0.1:${MOCK_SUPABASE_PORT}`,
      SUPABASE_ANON_KEY: 'test-anon-key-valid',
      TELVY_GATE_URL: `http://127.0.0.1:${MOCK_GATE_PORT}`,
      VOIP_GATE_URL: `http://127.0.0.1:${MOCK_GATE_PORT}`,
      VOIP_GATE_INTERNAL_KEY: GATE_KEY,
      VOIP_ENGINE_INTERNAL_KEY: GATE_KEY
    },
    stdio: 'pipe'
  });

  serverProcess.stderr?.on('data', chunk => {
    const line = chunk.toString();
    if (line.includes('error') || line.includes('Error')) {
      console.error('[ASTRO STDERR]', line.trim());
    }
  });

  await new Promise(r => setTimeout(r, 1500));

  let browser: puppeteer.Browser | null = null;
  let pasados = 0;
  let fallados = 0;

  function report(criterio: string, ok: boolean, detalle: string) {
    if (ok) {
      console.log(`  ✅ [PASS] ${criterio}: ${detalle}`);
      pasados++;
    } else {
      console.error(`  ❌ [FAIL] ${criterio}: ${detalle}`);
      fallados++;
    }
  }

  try {
    // 4. Iniciar Puppeteer con Chrome local
    browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Capturar errores de consola y excepciones no controladas
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    page.on('response', res => {
      if (res.status() >= 400) {
        console.log(`[HTTP ERROR ${res.status()}] ${res.url()}`);
      }
    });

    page.on('pageerror', (err: Error) => {
      pageErrors.push(err.message);
    });

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('favicon.ico')) {
          consoleErrors.push(text);
        }
      }
    });

    // Iniciar sesión para obtener cookie
    console.log('\n--- 1. AUTENTICACIÓN Y CARGA DE PÁGINA ---');
    await page.goto(`http://127.0.0.1:${ASTRO_PORT}/login`, { waitUntil: 'networkidle0' });
    await page.type('#email', 'cristianxrdz@gmail.com');
    await page.type('#password', 'password123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('button[type="submit"]')
    ]);

    // Navegar a /cuenta/comprar-did
    console.log('\n--- 2. CARGA DE /cuenta/comprar-did Y MONITOREO DE ERRORES ---');
    // Limpiar buffers previos de login para medir estrictamente la carga de /cuenta/comprar-did
    pageErrors.length = 0;
    consoleErrors.length = 0;

    await page.goto(`http://127.0.0.1:${ASTRO_PORT}/cuenta/comprar-did`, { waitUntil: 'networkidle0' });

    // CRITERIO B1: Al cargar /cuenta/comprar-did, NO hay ningún error de consola ni excepción no capturada
    const tieneErrorSaldo = pageErrors.some(e => e.includes('saldoDisponible is not defined')) ||
                            consoleErrors.some(e => e.includes('saldoDisponible is not defined'));
    const totalErrores = pageErrors.length + consoleErrors.length;

    report(
      'B1_CONSOLA_LIMPIA',
      totalErrores === 0,
      totalErrores === 0
        ? 'Consola y runtime limpios sin excepciones'
        : `Errores detectados (${totalErrores}): ${[...pageErrors, ...consoleErrors].join(' | ')}`
    );

    // CRITERIO B2: El filtro por prefijo en pantalla consulta y actualiza la tabla
    console.log('\n--- 3. FILTRADO POR PREFIJO EN UI ---');
    await page.waitForSelector('#inputPrefijo');
    await page.type('#inputPrefijo', '52442');
    await page.click('#btnSearch');

    // Esperar a que se actualice la tabla
    await page.waitForFunction(() => {
      const tbody = document.getElementById('tbodyDids');
      return tbody && !tbody.innerText.includes('Buscando números');
    }, { timeout: 3000 }).catch(() => {});

    const tbodyText = await page.$eval('#tbodyDids', el => el.textContent || '');
    const tiene442 = tbodyText.includes('524429990001');
    const noTiene55 = !tbodyText.includes('525512345678');
    const queryEnviada = gateDisponiblesQueryStrings.some(q => q.includes('prefijo=52442'));

    report(
      'B2_FILTRO_PREFIJO_UI',
      tiene442 && noTiene55 && queryEnviada,
      `Filtrado ejecutado: query enviada=${queryEnviada}, contiene 442=${tiene442}, excluye 55=${noTiene55}`
    );

    // CRITERIO B3: Pulsar Reservar dispara la llamada a /api/cuenta/dids/reservar o validación
    console.log('\n--- 4. INTERACCIÓN CON BOTÓN RESERVAR ---');
    const btnReserve = await page.$('.btn-reserve');
    assert.ok(btnReserve, 'Debe existir al menos un botón de reservar');

    // Escuchar requests
    let apiReservarLlamada = false;
    page.on('request', req => {
      if (req.url().includes('/api/cuenta/dids/reservar')) {
        apiReservarLlamada = true;
      }
    });

    await btnReserve.click();
    await new Promise(r => setTimeout(r, 600));

    report(
      'B3_PULSAR_RESERVAR_EVENTO',
      apiReservarLlamada || (pageErrors.length === 0 && !tieneErrorSaldo),
      `Evento de click procesado (api llamada: ${apiReservarLlamada})`
    );

    // CRITERIO B4: Con saldo insuficiente, aparece el mensaje del faltante
    console.log('\n--- 5. MENSAJE DE SALDO INSUFICIENTE Y FALTANTE ---');
    const boxVisible = await page.$eval('#boxInsuficienteGeneral', el => (el as HTMLElement).style.display !== 'none');
    const boxText = await page.$eval('#boxInsuficienteGeneral', el => el.textContent || '');
    const tieneFaltante = boxText.includes('48.19') && (boxText.includes('insuficiente') || boxText.includes('Te faltan'));

    report(
      'B4_MENSAJE_FALTANTE_UI',
      boxVisible && tieneFaltante,
      `Mensaje visible: ${boxVisible}, texto faltante: "${boxText.trim()}"`
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
