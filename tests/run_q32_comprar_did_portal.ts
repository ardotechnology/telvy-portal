import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert';

const ASTRO_PORT = 8096;
const MOCK_SUPABASE_PORT = 54328;
const MOCK_GATE_PORT = 4204;
const GATE_KEY = 'test_gate_internal_key_q32_xyz';

console.log('========================================================================');
console.log('  SUITE DE VERIFICACIÓN — BLOQUE Q3.2: COMPRA DE DID DESDE EL PORTAL    ');
console.log('========================================================================\n');

const userA_Id = '11111111-1111-4111-8111-111111111111'; // 1001
let saldoActual = 1.81; // Inicialmente saldo bajo ($1.81 MXN)

let lastOrderState = {
  id: 'ord-did-init',
  estado: 'en_proceso',
  terminal: false,
  error_publico: null as string | null
};

async function main() {
  // Servidor simulador de Gate / Motor VoIP
  const gateServer = http.createServer((req, res) => {
    const internalKey = req.headers['x-internal-key'] as string;
    const clientHeader = req.headers['x-authenticated-client'] as string;

    if (internalKey !== GATE_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Unauthorized gate key' }));
    }

    const url = req.url || '';
    const method = req.method || 'GET';

    // 1. GET /v1/cliente/saldo
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

    // 2. GET /v1/cliente/dids/disponibles
    if (url.startsWith('/v1/cliente/dids/disponibles') && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        dids: [
          { did: '524429990001', region: 'QRO', precio: 50.00 },
          { did: '524429990002', region: 'QRO', precio: 50.00 },
          { did: '525512345678', region: 'CDMX', precio: 65.00 }
        ],
        total: 3,
        pagina: 1,
        limite: 20
      }));
    }

    // 3. POST /v1/cliente/dids/:did/reservar
    const matchReservar = url.match(/^\/v1\/cliente\/dids\/([^/]+)\/reservar$/);
    if (matchReservar && method === 'POST') {
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

      // Saldo suficiente
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

    // 4. POST /v1/cliente/dids/:did/confirmar
    const matchConfirmar = url.match(/^\/v1\/cliente\/dids\/([^/]+)\/confirmar$/);
    if (matchConfirmar && method === 'POST') {
      const did = matchConfirmar[1];
      const idempKey = req.headers['idempotency-key'];
      if (!idempKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Idempotency-Key header requerido' }));
      }

      const orderId = 'ord-buy-' + Date.now();
      lastOrderState = {
        id: orderId,
        estado: 'completado',
        terminal: true,
        error_publico: null
      };

      res.writeHead(202, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        orden_id: orderId,
        did,
        cliente: clientHeader,
        estado: 'en_proceso',
        cobrado: 50.00
      }));
    }

    // 5. GET /v1/cliente/ordenes/:id
    if (url.startsWith('/v1/cliente/ordenes/')) {
      const ordenId = url.slice('/v1/cliente/ordenes/'.length).trim();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        orden_id: ordenId,
        cliente: clientHeader,
        tipo: 'compra_did',
        estado: lastOrderState.estado,
        terminal: lastOrderState.terminal,
        error_publico: lastOrderState.error_publico,
        ultimo_error: null
      }));
    }

    // Endpoints estándar para render de index o sesión
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

  // Servidor simulador de Supabase
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

  // Iniciar Astro en ASTRO_PORT
  console.log(`--- INICIANDO SERVIDOR ASTRO EN PUERTO ${ASTRO_PORT} ---`);
  const nodeBin = fs.existsSync(process.execPath) ? process.execPath : (fs.existsSync('/Users/ardogroup/.local/bin/node') ? '/Users/ardogroup/.local/bin/node' : 'node');
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

  // Esperar arranque de Astro
  await new Promise(r => setTimeout(r, 1500));

  async function makeRequest(path: string, options: {
    method?: string;
    cookie?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}) {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const postData = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined;
      const reqHeaders: Record<string, string> = {
        ...(options.headers || {})
      };
      if (options.cookie) reqHeaders['Cookie'] = options.cookie;
      if (postData && !reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      if (postData) {
        reqHeaders['Content-Length'] = Buffer.byteLength(postData).toString();
      }

      const req = http.request({
        hostname: '127.0.0.1',
        port: ASTRO_PORT,
        path,
        method: options.method || 'GET',
        headers: reqHeaders
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  // Login para obtener cookie de sesión del 1001
  const loginBody = new URLSearchParams({ email: 'cristianxrdz@gmail.com', password: 'password123' }).toString();
  const loginRes = await makeRequest('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginBody
  });

  const rawCookies = loginRes.headers['set-cookie'];
  let authCookie = '';
  if (rawCookies) {
    authCookie = Array.isArray(rawCookies) ? rawCookies.map(c => c.split(';')[0]).join('; ') : (rawCookies as string).split(';')[0];
  }

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
    // CRITERIO 1: Redirección sin autenticación
    console.log('\n--- VERIFICACIÓN 1: ACCESO NO AUTENTICADO ---');
    const noAuthGet = await makeRequest('/cuenta/comprar-did');
    report(
      'C1_UNAUTH_PAGE',
      noAuthGet.status === 302 && (noAuthGet.headers.location === '/login' || (noAuthGet.headers.location || '').includes('login')),
      `Status ${noAuthGet.status}, redirect: ${noAuthGet.headers.location}`
    );

    const noAuthApi = await makeRequest('/api/cuenta/dids/disponibles');
    report(
      'C1_UNAUTH_API',
      noAuthApi.status === 401 || (noAuthApi.status === 302 && (noAuthApi.headers.location || '').includes('login')),
      `API no autenticada protegida (status ${noAuthApi.status}, redirect: ${noAuthApi.headers.location || 'none'})`
    );

    // CRITERIO 2: Pantalla /cuenta/comprar-did autenticada
    console.log('\n--- VERIFICACIÓN 2: RENDERIZADO DE PANTALLA ---');
    const authGet = await makeRequest('/cuenta/comprar-did', { cookie: authCookie });
    const hasSaldo = authGet.body.includes('1.81');
    const hasInputPrefijo = authGet.body.includes('inputPrefijo');
    const hasConfirmText = authGet.body.includes('CONFIRMAR COMPRA');
    const hasBrand = authGet.body.includes('Comprar Número Directo (DID)');

    report(
      'C2_PAGE_RENDER',
      authGet.status === 200 && hasSaldo && hasInputPrefijo && hasConfirmText && hasBrand,
      `Status 200, saldo presente: ${hasSaldo}, input prefijo: ${hasInputPrefijo}, confirm token: ${hasConfirmText}`
    );

    // CRITERIO 3: Búsqueda de DIDs disponibles
    console.log('\n--- VERIFICACIÓN 3: BÚSQUEDA DE DIDS DISPONIBLES ---');
    const dispRes = await makeRequest('/api/cuenta/dids/disponibles?prefijo=52&region=QRO', {
      cookie: authCookie
    });
    const dispData = JSON.parse(dispRes.body);
    report(
      'C3_DIDS_DISPONIBLES',
      dispRes.status === 200 && dispData.ok === true && Array.isArray(dispData.dids) && dispData.dids.length === 3,
      `Status ${dispRes.status}, dids count: ${dispData.dids?.length}`
    );

    // CRITERIO 4: Rechazo por saldo insuficiente (402)
    console.log('\n--- VERIFICACIÓN 4: RECHAZO POR SALDO INSUFICIENTE (HTTP 402) ---');
    const resInsuf = await makeRequest('/api/cuenta/dids/reservar', {
      method: 'POST',
      cookie: authCookie,
      body: { did: '524429990001' }
    });
    const dataInsuf = JSON.parse(resInsuf.body);
    report(
      'C4_SALDO_INSUFICIENTE_402',
      resInsuf.status === 402 &&
      dataInsuf.ok === false &&
      dataInsuf.saldo_disponible === 1.81 &&
      dataInsuf.precio === 50 &&
      dataInsuf.faltante === 48.19,
      `Status ${resInsuf.status}, error: "${dataInsuf.error}", faltante: $${dataInsuf.faltante}`
    );

    // CRITERIO 5: Reserva con saldo suficiente
    console.log('\n--- VERIFICACIÓN 5: RESERVA EXITOSA CON SALDO SUFICIENTE ---');
    saldoActual = 100.00; // Incrementamos saldo simulado a $100 MXN
    const resSuf = await makeRequest('/api/cuenta/dids/reservar', {
      method: 'POST',
      cookie: authCookie,
      body: { did: '524429990001' }
    });
    const dataSuf = JSON.parse(resSuf.body);
    report(
      'C5_RESERVA_EXITOSA',
      resSuf.status === 200 && dataSuf.ok === true && Boolean(dataSuf.reservado_hasta),
      `Status ${resSuf.status}, DID: ${dataSuf.did}, reservado_hasta: ${dataSuf.reservado_hasta}`
    );

    // CRITERIO 6: Validación estricta de confirmación
    console.log('\n--- VERIFICACIÓN 6: VALIDACIÓN DE TEXTO DE CONFIRMACIÓN ---');
    const confBad = await makeRequest('/api/cuenta/dids/confirmar', {
      method: 'POST',
      cookie: authCookie,
      body: { did: '524429990001', confirmacion: 'COMPRA' }
    });
    report(
      'C6_CONFIRM_TEXT_INVALID',
      confBad.status === 400,
      `Status ${confBad.status} al enviar texto incorrecto`
    );

    // CRITERIO 7: Confirmación exitosa y orden de aprovisionamiento
    console.log('\n--- VERIFICACIÓN 7: CONFIRMACIÓN EXITOSA Y ENCOLADO ---');
    const confOk = await makeRequest('/api/cuenta/dids/confirmar', {
      method: 'POST',
      cookie: authCookie,
      body: { did: '524429990001', confirmacion: 'CONFIRMAR COMPRA' }
    });
    const dataOk = JSON.parse(confOk.body);
    report(
      'C7_CONFIRM_OK',
      (confOk.status === 200 || confOk.status === 202) && dataOk.ok === true && Boolean(dataOk.orden_id),
      `Status ${confOk.status}, orden_id: ${dataOk.orden_id}`
    );

    // CRITERIO 8: Consulta de orden terminal en el portal
    console.log('\n--- VERIFICACIÓN 8: CONSULTA DE ESTADO DE LA ORDEN ---');
    const ordRes = await makeRequest(`/api/cuenta/orden-status?orden_id=${dataOk.orden_id}`, {
      cookie: authCookie
    });
    const ordData = JSON.parse(ordRes.body);
    report(
      'C8_ORDEN_TERMINAL',
      ordRes.status === 200 && ordData.estado === 'completado' && ordData.terminal === true,
      `Status ${ordRes.status}, estado: ${ordData.estado}, terminal: ${ordData.terminal}`
    );

  } finally {
    console.log('\n--- LIMPIEZA DE SERVIDORES ---');
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
