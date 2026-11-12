import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('../app/node_modules/puppeteer-core');

const ASTRO_PORT = 8099;
const MOCK_SUPABASE_PORT = 54331;
const MOCK_GATE_PORT = 4207;
const GATE_KEY = 'test_gate_internal_key_q35d_xyz';

console.log('========================================================================');
console.log('  SUITE DE CRITERIOS — BLOQUE CORTO: SALDO SE LEE CON NOMBRE DEL MOTOR  ');
console.log('========================================================================\n');

let mockSaldoResponse: any = {
  ok: true,
  cliente: '1001',
  saldo: {
    disponible: 1.8063,
    reservado: 0
  },
  moneda: 'MXN'
};

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

async function main() {
  const portalSrcDir = path.join(process.cwd(), 'app', 'src');

  // ---------------------------------------------------------------------------
  // 1. VERIFICACIÓN ESTÁTICA DEL CÓDIGO FUENTE
  // ---------------------------------------------------------------------------
  console.log('--- 1. VERIFICACIÓN ESTÁTICA: NOMBRES OBSOLETOS Y ?? 0 ---');

  // Buscar saldo_control, saldo?.credit, credito_conmutador en todo app/src/
  function scanFiles(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results = results.concat(scanFiles(fullPath));
      } else if (file.endsWith('.astro') || file.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allSrcFiles = scanFiles(portalSrcDir);
  const hallazgosObsoletos: string[] = [];

  for (const f of allSrcFiles) {
    const content = fs.readFileSync(f, 'utf8');
    const rel = path.relative(portalSrcDir, f);
    if (/saldo_control|saldo\?\.credit|credito_conmutador/.test(content)) {
      const matches = content.match(/[^\n]*(?:saldo_control|saldo\?\.credit|credito_conmutador)[^\n]*/g) || [];
      hallazgosObsoletos.push(`${rel} -> ${matches.map(m => m.trim()).join(' | ')}`);
    }
  }

  const c1StaticPass = hallazgosObsoletos.length === 0;
  report(
    'C1_SIN_NOMBRES_OBSOLETOS',
    c1StaticPass,
    c1StaticPass
      ? '0 coincidencias de saldo_control, saldo?.credit o credito_conmutador en app/src/'
      : `Encontradas coincidencias obsoletas:\n     ${hallazgosObsoletos.join('\n     ')}`
  );

  // Verificar baja.astro líneas de lectura
  const bajaContent = fs.readFileSync(path.join(portalSrcDir, 'pages', 'cuenta', 'baja.astro'), 'utf8');
  const bajaLeeSaldoMotor = bajaContent.includes('sData.saldo.disponible') || bajaContent.includes('sData.saldo?.disponible');
  const bajaSinSaldoControl = !bajaContent.includes('saldo_control');
  const bajaMuestraNoDisponible = bajaContent.includes('No disponible');
  const c2BajaStaticPass = bajaLeeSaldoMotor && bajaSinSaldoControl && bajaMuestraNoDisponible;
  report(
    'C2_BAJA_LEE_SALDO_MOTOR',
    c2BajaStaticPass,
    `Lee sData.saldo.disponible: ${bajaLeeSaldoMotor}, Sin saldo_control: ${bajaSinSaldoControl}, Muestra 'No disponible': ${bajaMuestraNoDisponible}`
  );

  // ---------------------------------------------------------------------------
  // 2. VERIFICACIÓN DINÁMICA CON SERVIDOR DE PRUEBA
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. VERIFICACIÓN DINÁMICA: RENDERIZADO CON SALDO 1.8063 Y FALLO ---');

  // Mock Gate
  const gateServer = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/v1/cliente/saldo')) {
      if (mockSaldoResponse) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(mockSaldoResponse));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Conmutador no responde' }));
      }
    }
    if (url.startsWith('/v1/cliente/extensiones')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, extensiones: [{ id: 1, name: 'cristian', status: 1, online: true }] }));
    }
    if (url.startsWith('/v1/cliente/troncales')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, troncales: [{ id: 2, name: 'p2p_1_22de5', status: 1, online: true }] }));
    }
    if (url.startsWith('/v1/cliente/dids')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, dids: [{ did: '522201990000', timbra_en: 'cristian' }] }));
    }
    if (url.startsWith('/v1/cliente/avisos/pendientes') || url.startsWith('/v1/cliente/avisos')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, avisos: [] }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
  });
  await new Promise<void>(r => gateServer.listen(MOCK_GATE_PORT, '127.0.0.1', r));

  // Mock Supabase
  const supabaseServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/auth/v1/token?grant_type=password') {
      res.writeHead(200);
      return res.end(JSON.stringify({
        access_token: 'fake-jwt-token-1001-q35d',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'fake-refresh-token',
        user: { id: '11111111-1111-4111-8111-111111111111', email: 'cristianxrdz@gmail.com', user_metadata: { cliente: '1001' } }
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
  await new Promise<void>(r => supabaseServer.listen(MOCK_SUPABASE_PORT, '127.0.0.1', r));

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
      if (msg.includes('Server listening on') || msg.includes(`http://127.0.0.1:${ASTRO_PORT}`)) {
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

  try {
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

    // Escenario 1: Con saldo.disponible = 1.8063
    // Verificar en Dashboard (index.astro)
    const saldoDashboardText = await page.$eval('.saldo-value', (el: any) => el.textContent?.trim() || '');
    const dashMuestra181 = saldoDashboardText.includes('1.81');

    // Verificar en Pantalla de Baja (baja.astro)
    await page.goto(`http://127.0.0.1:${ASTRO_PORT}/cuenta/baja`, { waitUntil: 'networkidle0' });
    const saldoBajaText = await page.$eval('.inventory-item .inventory-value', (el: any) => el.textContent?.trim() || '');
    const bajaMuestra181 = saldoBajaText.includes('1.81');

    report(
      'C3_BAJA_MUESTRA_1_81',
      bajaMuestra181,
      `Con saldo.disponible = 1.8063, baja.astro muestra '${saldoBajaText}' (esperado '1.81')`
    );

    // Criterio: Dashboard y baja muestran el MISMO número
    const coinciden = dashMuestra181 && bajaMuestra181;
    report(
      'C4_DASHBOARD_Y_BAJA_COINCIDEN',
      coinciden,
      coinciden
        ? `Ambas pantallas muestran 1.81 (Dashboard: '${saldoDashboardText}', Baja: '${saldoBajaText}')`
        : `Divergencia: Dashboard muestra '${saldoDashboardText}', Baja muestra '${saldoBajaText}'`
    );

    // Escenario 2: Simular fallo de lectura o conmutador que no responde
    mockSaldoResponse = null;

    await page.goto(`http://127.0.0.1:${ASTRO_PORT}/cuenta/baja`, { waitUntil: 'networkidle0' });
    const saldoBajaFallo = await page.$eval('.inventory-item .inventory-value', (el: any) => el.textContent?.trim() || '');
    const noMuestraCeroEnFallo = !saldoBajaFallo.includes('0.00') && (saldoBajaFallo.includes('No disponible') || saldoBajaFallo.includes('no disponible'));

    report(
      'C5_FALLO_LECTURA_NO_MUESTRA_CERO_SINO_NO_DISPONIBLE',
      noMuestraCeroEnFallo,
      `Ante fallo de lectura en baja, valor es '${saldoBajaFallo}' (esperado 'No disponible', NO 0.00)`
    );

  } finally {
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
  console.error('Error fatal:', err);
  process.exit(1);
});
