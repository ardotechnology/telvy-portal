import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert';

const ASTRO_PORT = 8092;
const MOCK_SUPABASE_PORT = 54324;
const MOCK_GATE_PORT = 4200;
const GATE_KEY = 'test_gate_internal_key_xyz987654321';

console.log('========================================================================');
console.log('  EJECUTANDO SUITE DE VERIFICACIONES — BLOQUE Q3.3b: BANNER REACTIVAR  ');
console.log('========================================================================\n');

const userA_Id = '11111111-1111-4111-8111-111111111111'; // 1001

// Control dinámico del estado del conmutador y de la puerta
let gateActive = true;
const conmutadorState = {
  1001: {
    active: 0,
    saldo: '1.8100',
    extensiones: [] as any[],
    troncales: [] as any[],
    dids: [] as any[]
  }
};

// Servidor simulador de Gate / Motor VoIP
const gateServer = http.createServer((req, res) => {
  if (!gateActive) {
    req.socket.destroy();
    return;
  }

  const internalKey = req.headers['x-internal-key'] as string;
  const clientHeader = req.headers['x-authenticated-client'] as string;

  if (internalKey !== GATE_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Unauthorized gate key' }));
  }

  const url = req.url || '';

  // GET /v1/cliente/saldo
  if (url.startsWith('/v1/cliente/saldo')) {
    const c = conmutadorState[clientHeader];
    if (!c) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Cliente no encontrado' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      cliente: clientHeader,
      saldo: { credit: c.saldo, currency: 'MXN' },
      saldo_control: { saldo_base: Number(c.saldo), saldo_reservado: 0, saldo_disponible: Number(c.saldo) }
    }));
  }

  // GET /v1/cliente/extensiones
  if (url.startsWith('/v1/cliente/extensiones')) {
    const c = conmutadorState[clientHeader];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, extensiones: c?.extensiones || [] }));
  }

  // GET /v1/cliente/troncales
  if (url.startsWith('/v1/cliente/troncales')) {
    const c = conmutadorState[clientHeader];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, troncales: c?.troncales || [] }));
  }

  // GET /v1/cliente/dids
  if (url.startsWith('/v1/cliente/dids')) {
    const c = conmutadorState[clientHeader];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, dids: c?.dids || [] }));
  }

  // GET /v1/cliente/avisos/pendientes
  if (url.startsWith('/v1/cliente/avisos/pendientes')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, avisos: [] }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Endpoint no encontrado' }));
});

await new Promise<void>(resolve => gateServer.listen(MOCK_GATE_PORT, resolve));

// Mock Supabase Server
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

// Iniciar Astro
console.log(`--- INICIANDO SERVIDOR ASTRO EN PUERTO ${ASTRO_PORT} ---`);
const nodeBin = fs.existsSync(process.execPath) ? process.execPath : (fs.existsSync('/Users/ardogroup/.local/bin/node') ? '/Users/ardogroup/.local/bin/node' : 'node');
const serverProcess: ChildProcess = spawn(nodeBin, ['dist/server/entry.mjs'], {
  cwd: './app',
  env: {
    ...process.env,
    PORT: String(ASTRO_PORT),
    HOST: '127.0.0.1',
    CLIENT_API_INTERNAL_KEY: GATE_KEY,
    SUPABASE_URL: `http://127.0.0.1:${MOCK_SUPABASE_PORT}`,
    SUPABASE_ANON_KEY: 'test-anon-key-valid',
    TELVY_GATE_URL: `http://127.0.0.1:${MOCK_GATE_PORT}`
  },
  stdio: 'pipe'
});

serverProcess.stdout?.on('data', d => {
  const line = d.toString().trim();
  if (line.includes('Server listening')) console.log('[Astro]', line);
});
serverProcess.stderr?.on('data', d => console.error('[Astro Err]', d.toString().trim()));

await new Promise(resolve => setTimeout(resolve, 1500));

// Login para obtener cookies legítimas de Supabase SSR
const p1001 = new URLSearchParams({ email: 'cristianxrdz@gmail.com', password: 'Clave1001!' });
const resL1001 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: p1001.toString(),
  redirect: 'manual'
});
const rawC1001 = resL1001.headers.getSetCookie ? resL1001.headers.getSetCookie() : [resL1001.headers.get('set-cookie') || ''];
const cookie1001 = rawC1001.map(c => c.split(';')[0]).join('; ');

async function main() {
  try {
    // -------------------------------------------------------------------------
    // CRITERIO 1: con saldo 1.81 y CERO servicios -> banner visible y botón Reactivar
    // -------------------------------------------------------------------------
    console.log('\n--- CRITERIO 1: Saldo 1.81 y CERO servicios -> Banner visible y botón Reactivar ---');
    conmutadorState[1001].saldo = '1.8100';
    conmutadorState[1001].extensiones = [];
    conmutadorState[1001].troncales = [];
    conmutadorState[1001].dids = [];

    const resC1 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, { headers: { Cookie: cookie1001 } });
    console.log(`HTTP Status: ${resC1.status}`);
    const htmlC1 = await resC1.text();

    const hasBannerC1 = htmlC1.includes('Tu cuenta no tiene servicios activos');
    const hasBtnReactivarC1 = htmlC1.includes('id="btnReactivar"') || htmlC1.includes('Reactivar Cuenta');
    console.log(`  ¿Banner de cuenta sin servicios visible?: ${hasBannerC1}`);
    console.log(`  ¿Botón Reactivar presente?: ${hasBtnReactivarC1}`);

    assert.ok(hasBannerC1, 'CRITERIO 1 FALLÓ: El banner DEBE ser visible con saldo 1.81 y 0 servicios');
    assert.ok(hasBtnReactivarC1, 'CRITERIO 1 FALLÓ: El botón Reactivar DEBE estar presente');
    console.log('✅ CRITERIO 1 APROBADO: Banner visible y botón de reactivación presente con saldo 1.81 y 0 servicios.\n');

    // -------------------------------------------------------------------------
    // CRITERIO 2: con saldo 1.81 y UNA extensión -> banner AUSENTE
    // -------------------------------------------------------------------------
    console.log('--- CRITERIO 2: Saldo 1.81 y UNA extensión -> Banner AUSENTE ---');
    conmutadorState[1001].extensiones = [
      { id: 156, name: 'cristian', host: 'dynamic', callerid: '1001', online: true, lineStatus: 'OK', activo: 1 }
    ];

    const resC2 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, { headers: { Cookie: cookie1001 } });
    const htmlC2 = await resC2.text();
    const hasBannerC2 = htmlC2.includes('Tu cuenta no tiene servicios activos');
    console.log(`  ¿Banner de reactivación visible?: ${hasBannerC2}`);

    assert.strictEqual(hasBannerC2, false, 'CRITERIO 2 FALLÓ: El banner DEBE estar ausente cuando hay al menos 1 servicio');
    console.log('✅ CRITERIO 2 APROBADO: Banner ausente al haber al menos un servicio activo.\n');

    // -------------------------------------------------------------------------
    // CRITERIO 3: con saldo 0 y cero servicios -> banner visible, SIN la frase del saldo
    // -------------------------------------------------------------------------
    console.log('--- CRITERIO 3: Saldo 0 y cero servicios -> Banner visible SIN frase de saldo ---');
    conmutadorState[1001].saldo = '0.0000';
    conmutadorState[1001].extensiones = [];
    conmutadorState[1001].troncales = [];
    conmutadorState[1001].dids = [];

    const resC3 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, { headers: { Cookie: cookie1001 } });
    const htmlC3 = await resC3.text();
    const hasBannerC3 = htmlC3.includes('Tu cuenta no tiene servicios activos');
    const mentionsSaldoC3 = htmlC3.includes('se conserva y se restablece');

    console.log(`  ¿Banner visible?: ${hasBannerC3}`);
    console.log(`  ¿Menciona saldo conservado cuando saldo es 0?: ${mentionsSaldoC3}`);

    assert.ok(hasBannerC3, 'CRITERIO 3 FALLÓ: El banner DEBE ser visible con saldo 0 y 0 servicios');
    assert.strictEqual(mentionsSaldoC3, false, 'CRITERIO 3 FALLÓ: No debe mencionar saldo conservado si el saldo es 0');
    console.log('✅ CRITERIO 3 APROBADO: Banner visible sin frase de saldo cuando saldo es 0.\n');

    // -------------------------------------------------------------------------
    // CRITERIO 5: el texto del banner incluye el importe conservado cuando el saldo no es 0
    // -------------------------------------------------------------------------
    console.log('--- CRITERIO 5: Importe conservado en banner cuando saldo no es 0 ---');
    conmutadorState[1001].saldo = '1.8100';
    conmutadorState[1001].extensiones = [];

    const resC5 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, { headers: { Cookie: cookie1001 } });
    const htmlC5 = await resC5.text();
    const hasSaldoFrase = htmlC5.includes('Tu saldo de $1.81 MXN se conserva y se restablece si reactivas la cuenta');
    console.log(`  ¿Texto exacto de saldo conservado presente ($1.81 MXN)?: ${hasSaldoFrase}`);

    assert.ok(hasSaldoFrase, 'CRITERIO 5 FALLÓ: El banner debe incluir "Tu saldo de $1.81 MXN se conserva y se restablece si reactivas la cuenta."');
    console.log('✅ CRITERIO 5 APROBADO: El texto del banner incluye fielmente el importe conservado.\n');

    // -------------------------------------------------------------------------
    // CRITERIO 4: con el motor caído -> aviso "estado no disponible", sin banner y sin error 500
    // -------------------------------------------------------------------------
    console.log('--- CRITERIO 4: Motor caído -> Aviso "estado no disponible", sin banner y sin error 500 ---');
    gateActive = false; // Simular caída total del motor

    const resC4 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, { headers: { Cookie: cookie1001 } });
    console.log(`HTTP Status con motor caído: ${resC4.status}`);
    const htmlC4 = await resC4.text();

    const hasBannerC4 = htmlC4.includes('Tu cuenta no tiene servicios activos');
    const hasEstadoNoDisponible = htmlC4.includes('estado no disponible') || htmlC4.includes('Estado no disponible');

    console.log(`  ¿Status HTTP es 200 (sin error 500)?: ${resC4.status === 200}`);
    console.log(`  ¿Aviso "estado no disponible" presente?: ${hasEstadoNoDisponible}`);
    console.log(`  ¿Banner de reactivación ausente?: ${!hasBannerC4}`);

    assert.strictEqual(resC4.status, 200, 'CRITERIO 4 FALLÓ: No debe arrojar error 500');
    assert.ok(hasEstadoNoDisponible, 'CRITERIO 4 FALLÓ: Debe mostrar aviso de estado no disponible');
    assert.strictEqual(hasBannerC4, false, 'CRITERIO 4 FALLÓ: El banner NO debe mostrarse si la lectura falló');
    console.log('✅ CRITERIO 4 APROBADO: Motor caído muestra "estado no disponible" sin banner ni error 500.\n');

    console.log('========================================================================');
    console.log('  RESUMEN: TODOS LOS CRITERIOS DEL BLOQUE Q3.3b APROBADOS (100% GREEN)  ');
    console.log('========================================================================\n');

  } finally {
    serverProcess.kill('SIGTERM');
    supabaseServer.close();
    gateServer.close();
  }
}

main().catch(err => {
  console.error('\n❌ ERROR FATAL:', err.message);
  serverProcess.kill('SIGTERM');
  supabaseServer.close();
  gateServer.close();
  process.exit(1);
});
