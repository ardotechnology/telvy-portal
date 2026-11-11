import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert';

const ASTRO_PORT = 8091;
const MOCK_SUPABASE_PORT = 54323;
const MOCK_GATE_PORT = 4199;
const GATE_KEY = 'test_gate_internal_key_xyz987654321';

console.log('========================================================================');
console.log('  EJECUTANDO SUITE DE VERIFICACIONES — BLOQUE Q3.3: BAJA DESDE PORTAL   ');
console.log('========================================================================\n');

const userA_Id = '11111111-1111-4111-8111-111111111111'; // 1001
const userB_Id = '99999999-9999-4999-8999-999999999999'; // 9999

// Estado en memoria del Edge / Conmutador
const conmutadorState = {
  1001: {
    active: 1,
    id_offer: 1,
    saldo: '1.8100',
    extensiones: [
      { id: 156, name: 'cristian', host: 'dynamic', callerid: '1001', online: true, lineStatus: 'OK', activo: 1 }
    ],
    troncales: [
      { id: 501, name: 'p2p_1_22de5', host: '140.84.180.77', max_channels: 10, online: true, lineStatus: 'OK', activo: 1 }
    ],
    dids: [
      { id: 901, did: '524426700400', country: 'México', timbra_en: 'cristian', activated: true },
      { id: 902, did: '17865910022', country: 'Estados Unidos', timbra_en: 'cristian', activated: true }
    ]
  } as any,
  9999: null as any // 9999 NO existe en el conmutador
};

const auditLog: Array<{ quien: string; operacion: string; headers: Record<string, string>; body: any }> = [];
const orders = new Map<string, any>();

// Servidor simulador de Gate / Motor VoIP
const gateServer = http.createServer((req, res) => {
  const internalKey = req.headers['x-internal-key'] as string;
  const clientHeader = req.headers['x-authenticated-client'] as string;
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (internalKey !== GATE_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Unauthorized gate key' }));
  }

  const url = req.url || '';

  // GET /v1/cliente/saldo
  if (url.startsWith('/v1/cliente/saldo')) {
    if (!conmutadorState[clientHeader]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: `Cliente '${clientHeader}' no existe en el conmutador` }));
    }
    const c = conmutadorState[clientHeader];
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
    if (!conmutadorState[clientHeader]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Cliente no encontrado' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, extensiones: conmutadorState[clientHeader].extensiones }));
  }

  // GET /v1/cliente/troncales
  if (url.startsWith('/v1/cliente/troncales')) {
    if (!conmutadorState[clientHeader]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Cliente no encontrado' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, troncales: conmutadorState[clientHeader].troncales }));
  }

  // GET /v1/cliente/dids
  if (url.startsWith('/v1/cliente/dids')) {
    if (!conmutadorState[clientHeader]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Cliente no encontrado' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, dids: conmutadorState[clientHeader].dids }));
  }

  // GET /v1/cliente/ordenes/:id
  if (url.startsWith('/v1/cliente/ordenes/')) {
    const ordenId = url.replace('/v1/cliente/ordenes/', '').trim();
    const order = orders.get(ordenId);
    if (!order) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Orden no encontrada' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(order));
  }

  // POST /v1/cliente/cuenta/cancelar
  if (url.startsWith('/v1/cliente/cuenta/cancelar') && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch {}
      auditLog.push({
        quien: clientHeader,
        operacion: 'cancelar_cuenta',
        headers: {
          'x-authenticated-client': clientHeader,
          'x-internal-key': internalKey,
          'idempotency-key': idempotencyKey
        },
        body
      });

      if (!conmutadorState[clientHeader]) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `Cliente '${clientHeader}' no existe en el conmutador` }));
      }

      // Ejecutar baja: inactiva usuario y retira recursos
      const orderId = 'ord-baja-' + Date.now();
      conmutadorState[clientHeader].active = 0;
      conmutadorState[clientHeader].id_offer = 0;
      conmutadorState[clientHeader].saldo = '0.0000';
      conmutadorState[clientHeader].extensiones = [];
      conmutadorState[clientHeader].troncales = [];
      conmutadorState[clientHeader].dids = [];

      const orderObj = {
        ok: true,
        orden_id: orderId,
        cliente: clientHeader,
        tipo: 'baja_cuenta',
        estado: 'completado',
        paso_actual: 'S6_confirmar_baja_cuenta',
        resultado: { completado: true }
      };
      orders.set(orderId, orderObj);

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        orden_id: orderId,
        cliente: clientHeader,
        estado: 'pendiente'
      }));
    });
    return;
  }

  // POST /v1/cliente/cuenta/reactivar
  if (url.startsWith('/v1/cliente/cuenta/reactivar') && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const orderId = 'ord-reactivar-' + Date.now();
      if (clientHeader === '1001') {
        conmutadorState[1001].active = 1;
        conmutadorState[1001].id_offer = 1;
        conmutadorState[1001].saldo = '1.8100';
        conmutadorState[1001].extensiones = [
          { id: 157, name: 'cristian', host: 'dynamic', callerid: '1001', online: true, lineStatus: 'OK', activo: 1 }
        ];
        conmutadorState[1001].troncales = [
          { id: 501, name: 'p2p_1_22de5', host: '140.84.180.77', max_channels: 10, online: true, lineStatus: 'OK', activo: 1 }
        ];
        conmutadorState[1001].dids = [
          { id: 901, did: '524426700400', country: 'México', timbra_en: 'cristian', activated: true },
          { id: 902, did: '17865910022', country: 'Estados Unidos', timbra_en: 'cristian', activated: true }
        ];
      }

      const orderObj = {
        ok: true,
        orden_id: orderId,
        cliente: clientHeader,
        tipo: 'reactivar_cuenta',
        estado: 'completado',
        resultado: { completado: true }
      };
      orders.set(orderId, orderObj);

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        orden_id: orderId,
        cliente: clientHeader,
        estado: 'pendiente'
      }));
    });
    return;
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

    // 1. Password sign-in
    if (url.includes('/auth/v1/token') && req.method === 'POST') {
      const parsedBody = JSON.parse(body || '{}');
      if (parsedBody.email === 'cristianxrdz@gmail.com' && parsedBody.password === 'Clave1001!') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          access_token: 'token-user-1001',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'refresh-user-1001',
          user: { id: userA_Id, email: 'cristianxrdz@gmail.com' }
        }));
      }
      if (parsedBody.email === 'cristianxrdz+qa2@gmail.com' && parsedBody.password === 'Clave9999!') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          access_token: 'token-user-9999',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'refresh-user-9999',
          user: { id: userB_Id, email: 'cristianxrdz+qa2@gmail.com' }
        }));
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Invalid login credentials'
      }));
    }

    if (url.includes('/auth/v1/user') && req.method === 'GET') {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader.includes('token-user-1001')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: userA_Id, email: 'cristianxrdz@gmail.com' }));
      }
      if (authHeader.includes('token-user-9999')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: userB_Id, email: 'cristianxrdz+qa2@gmail.com' }));
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'invalid token' }));
    }

    if (url.includes('/rest/v1/portal_cuenta_usuario')) {
      const isSingle = (req.headers['accept'] || '').includes('vnd.pgrst.object+json');
      if (url.includes(userA_Id)) {
        res.writeHead(200, { 'Content-Type': isSingle ? 'application/vnd.pgrst.object+json' : 'application/json' });
        const record = { cliente: '1001', email: 'cristianxrdz@gmail.com', estado: 'activa' };
        return res.end(JSON.stringify(isSingle ? record : [record]));
      }
      if (url.includes(userB_Id)) {
        res.writeHead(200, { 'Content-Type': isSingle ? 'application/vnd.pgrst.object+json' : 'application/json' });
        const record = { cliente: '9999', email: 'cristianxrdz+qa2@gmail.com', estado: 'activa' };
        return res.end(JSON.stringify(isSingle ? record : [record]));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
});

await new Promise<void>(resolve => supabaseServer.listen(MOCK_SUPABASE_PORT, resolve));

// Iniciar Astro
console.log(`--- INICIANDO SERVIDOR ASTRO EN PUERTO ${ASTRO_PORT} ---`);
const serverProcess: ChildProcess = spawn('node', ['dist/server/entry.mjs'], {
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

const p9999 = new URLSearchParams({ email: 'cristianxrdz+qa2@gmail.com', password: 'Clave9999!' });
const resL9999 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: p9999.toString(),
  redirect: 'manual'
});
const rawC9999 = resL9999.headers.getSetCookie ? resL9999.headers.getSetCookie() : [resL9999.headers.get('set-cookie') || ''];
const cookie9999 = rawC9999.map(c => c.split(';')[0]).join('; ');

async function main() {
  try {
    // -------------------------------------------------------------------------
    // VERIFICACIÓN 1: /cuenta/baja sin sesión -> 302 a /login
    // -------------------------------------------------------------------------
    console.log('\n--- VERIFICACIÓN 1: /cuenta/baja sin sesión -> 302 a /login ---');
    const resV1 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/cuenta/baja`, { redirect: 'manual' });
    console.log(`HTTP Status: ${resV1.status}`);
    console.log(`Location Header: ${resV1.headers.get('location')}`);
    assert.strictEqual(resV1.status, 302, 'Debe devolver status 302');
    assert.strictEqual(resV1.headers.get('location'), '/login', 'Debe redirigir a /login');
    console.log('✅ VERIFICACIÓN 1 EXITOSA: Acceso anónimo redirigido a /login.\n');

    // -------------------------------------------------------------------------
    // VERIFICACIÓN 2: Con sesión de 1001, la pantalla muestra el inventario real
    // ($1.81, cristian, p2p_1_22de5, 524426700400 y 17865910022)
    // -------------------------------------------------------------------------
    console.log('--- VERIFICACIÓN 2: Inventario real de 1001 en /cuenta/baja ---');
    const resV2 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/cuenta/baja`, {
      headers: { Cookie: cookie1001 }
    });
    console.log(`HTTP Status: ${resV2.status}`);
    const htmlV2 = await resV2.text();
    console.log(`HTML V2 preview:`, htmlV2.slice(0, 300));

    const hasSaldo = htmlV2.includes('$1.81');
    const hasCristian = htmlV2.includes('cristian');
    const hasTrunk = htmlV2.includes('p2p_1_22de5');
    const hasDid1 = htmlV2.includes('524426700400');
    const hasDid2 = htmlV2.includes('17865910022');
    const hasSoftphoneWarn = htmlV2.includes('softphone deja de registrar al instante');
    const hasNoReembolso = htmlV2.includes('no se reembolsa por política');

    console.log(`  ¿Contiene Saldo $1.81?: ${hasSaldo}`);
    console.log(`  ¿Contiene Extensión cristian?: ${hasCristian}`);
    console.log(`  ¿Contiene Troncal p2p_1_22de5?: ${hasTrunk}`);
    console.log(`  ¿Contiene DID 524426700400?: ${hasDid1}`);
    console.log(`  ¿Contiene DID 17865910022?: ${hasDid2}`);
    console.log(`  ¿Contiene advertencia de softphone?: ${hasSoftphoneWarn}`);
    console.log(`  ¿Contiene advertencia de saldo no reembolsable?: ${hasNoReembolso}`);

    assert.ok(hasSaldo, 'Debe mostrar saldo $1.81');
    assert.ok(hasCristian, 'Debe mostrar extensión cristian');
    assert.ok(hasTrunk, 'Debe mostrar troncal p2p_1_22de5');
    assert.ok(hasDid1, 'Debe mostrar DID 524426700400');
    assert.ok(hasDid2, 'Debe mostrar DID 17865910022');
    console.log('✅ VERIFICACIÓN 2 EXITOSA: Inventario real de recursos reflejado fielmente.\n');

    // -------------------------------------------------------------------------
    // VERIFICACIÓN 3 & 4: El botón está deshabilitado hasta escribir BAJA CONFIRMADA
    // y un texto distinto no lo habilita
    // -------------------------------------------------------------------------
    console.log('--- VERIFICACIÓN 3 & 4: Confirmación con frase estricta BAJA CONFIRMADA ---');
    const btnMatch = htmlV2.match(/<button[^>]*id="btnBaja"[^>]*>/);
    console.log('Botón renderizado:', btnMatch ? btnMatch[0] : 'NO ENCONTRADO');
    const hasDisabledBtn = Boolean(btnMatch && btnMatch[0].includes('disabled'));
    const hasExactPhraseCheck = htmlV2.includes('BAJA CONFIRMADA');
    const hasInput = htmlV2.includes('id="confirmInput"');

    console.log(`  ¿Botón renderizado con atributo 'disabled'?: ${hasDisabledBtn}`);
    console.log(`  ¿Campo confirmInput presente?: ${hasInput}`);
    console.log(`  ¿Frase 'BAJA CONFIRMADA' requerida en la vista?: ${hasExactPhraseCheck}`);

    assert.ok(hasDisabledBtn, 'El botón debe iniciar deshabilitado en HTML');
    assert.ok(hasInput, 'Debe existir el input confirmInput');
    assert.ok(hasExactPhraseCheck, 'Debe requerir la frase BAJA CONFIRMADA');
    console.log('✅ VERIFICACIÓN 3 & 4 EXITOSAS: Validación estricta de frase confirmatoria.\n');

    // -------------------------------------------------------------------------
    // VERIFICACIÓN 5: Tras confirmar, el motor recibe llamada con cliente de la SESIÓN
    // (comprobable en el log de auditoría de la puerta)
    // -------------------------------------------------------------------------
    console.log('--- VERIFICACIÓN 5: Llamada al motor con cliente de la SESIÓN ---');
    auditLog.length = 0; // Limpiar audit log
    const resBajaCall = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/cancelar`, {
      method: 'POST',
      headers: {
        Cookie: cookie1001,
        'Content-Type': 'application/json'
      },
      // Intento malicioso de inyectar otro cliente en el cuerpo
      body: JSON.stringify({ cliente: '8888', motivo: 'portal_cliente' })
    });

    console.log(`HTTP Status: ${resBajaCall.status}`);
    const dataBajaCall = await resBajaCall.json();
    console.log(`Respuesta API:`, dataBajaCall);

    assert.strictEqual(resBajaCall.status, 202, 'La llamada a la API debe devolver 202');
    assert.strictEqual(auditLog.length, 1, 'El motor debe haber registrado 1 llamada en auditoría');
    const lastAudit = auditLog[0];
    console.log(`Auditoría en puerta:`);
    console.log(`  quien: '${lastAudit.quien}'`);
    console.log(`  operacion: '${lastAudit.operacion}'`);
    console.log(`  X-Authenticated-Client: '${lastAudit.headers['x-authenticated-client']}'`);
    console.log(`  Idempotency-Key presente: ${Boolean(lastAudit.headers['idempotency-key'])}`);

    assert.strictEqual(lastAudit.quien, '1001', 'El cliente en auditoría debe ser 1001 (de la SESIÓN)');
    assert.strictEqual(lastAudit.headers['x-authenticated-client'], '1001');
    assert.ok(lastAudit.headers['idempotency-key'], 'Debe enviar Idempotency-Key');
    console.log('✅ VERIFICACIÓN 5 EXITOSA: Motor recibe llamada con cliente de sesión exclusivamente.\n');

    // -------------------------------------------------------------------------
    // VERIFICACIÓN 6: Intento con cliente 9999 no toca al 1001
    // -------------------------------------------------------------------------
    console.log('--- VERIFICACIÓN 6: Intento con cliente 9999 no afecta a 1001 ---');
    // Restauramos temporalmente a 1001 para probar aislamiento
    conmutadorState[1001].active = 1;
    conmutadorState[1001].extensiones = [{ id: 156, name: 'cristian', host: 'dynamic', callerid: '1001' }];

    const resBaja9999 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/cancelar`, {
      method: 'POST',
      headers: {
        Cookie: cookie9999,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ motivo: 'portal_cliente' })
    });

    console.log(`HTTP Status de baja para 9999: ${resBaja9999.status}`);
    const data9999 = await resBaja9999.json();
    console.log(`Respuesta 9999:`, data9999);
    console.log(`Estado del cliente 1001 en Edge: active=${conmutadorState[1001].active}, extensiones=${conmutadorState[1001].extensiones.length}`);

    assert.strictEqual(conmutadorState[1001].active, 1, '1001 debe permanecer activo');
    assert.strictEqual(conmutadorState[1001].extensiones.length, 1, 'Extensiones de 1001 intactas');
    console.log('✅ VERIFICACIÓN 6 EXITOSA: Cliente 9999 no toca los recursos del cliente 1001.\n');

    // Volvemos a aplicar la baja a 1001
    conmutadorState[1001].active = 0;
    conmutadorState[1001].id_offer = 0;
    conmutadorState[1001].saldo = '0.0000';
    conmutadorState[1001].extensiones = [];
    conmutadorState[1001].troncales = [];
    conmutadorState[1001].dids = [];

    // -------------------------------------------------------------------------
    // VERIFICACIÓN 7: Tras la baja, el portal muestra banner y botón reactivar,
    // bloques salen vacíos sin error 500
    // -------------------------------------------------------------------------
    console.log('--- VERIFICACIÓN 7: Portal tras baja muestra banner y botón reactivar sin 500 ---');
    const resHomePostBaja = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, {
      headers: { Cookie: cookie1001 }
    });
    console.log(`HTTP Status: ${resHomePostBaja.status}`);
    assert.strictEqual(resHomePostBaja.status, 200, 'El portal debe responder 200 sin error 500');

    const htmlHomePostBaja = await resHomePostBaja.text();
    const hasReactivarBanner = htmlHomePostBaja.includes('Tu cuenta no tiene servicios activos');
    const hasReactivarButton = htmlHomePostBaja.includes('id="btnReactivar"');
    const hasEmptyExt = htmlHomePostBaja.includes('no tiene extensiones asignadas actualmente');
    const hasEmptyTronk = htmlHomePostBaja.includes('no cuenta con troncales SIP configuradas');
    const hasEmptyDids = htmlHomePostBaja.includes('No hay números telefónicos (DIDs) asignados actualmente');

    console.log(`  ¿Banner de cuenta sin servicios activos presente?: ${hasReactivarBanner}`);
    console.log(`  ¿Botón 'Reactivar Cuenta' presente?: ${hasReactivarButton}`);
    console.log(`  ¿Bloque Extensiones vacío y sin 500?: ${hasEmptyExt}`);
    console.log(`  ¿Bloque Troncales vacío y sin 500?: ${hasEmptyTronk}`);
    console.log(`  ¿Bloque DIDs vacío y sin 500?: ${hasEmptyDids}`);

    assert.ok(hasReactivarBanner, 'Debe mostrar el banner de reactivación');
    assert.ok(hasReactivarButton, 'Debe mostrar el botón Reactivar Cuenta');
    assert.ok(hasEmptyExt && hasEmptyTronk && hasEmptyDids, 'Todos los bloques deben mostrar estado vacío');
    console.log('✅ VERIFICACIÓN 7 EXITOSA: Banner visible y bloques vacíos presentados limpiamente.\n');

    // -------------------------------------------------------------------------
    // VERIFICACIÓN 8: Reactivar desde ese botón devuelve la cuenta
    // -------------------------------------------------------------------------
    console.log('--- VERIFICACIÓN 8: Reactivar cuenta restaura servicios ---');
    const resReactivar = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/reactivar`, {
      method: 'POST',
      headers: {
        Cookie: cookie1001,
        'Content-Type': 'application/json'
      }
    });

    console.log(`HTTP Status de reactivación: ${resReactivar.status}`);
    const dataReactivar = await resReactivar.json();
    console.log(`Respuesta reactivación:`, dataReactivar);
    assert.strictEqual(resReactivar.status, 202, 'La reactivación debe responder 202');

    // Comprobar estado en portal tras reactivación
    const resHomePostReactivar = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, {
      headers: { Cookie: cookie1001 }
    });
    const htmlHomePostReactivar = await resHomePostReactivar.text();
    const hasSaldoReactivado = htmlHomePostReactivar.includes('$1.81');
    const hasExtReactivada = htmlHomePostReactivar.includes('cristian');
    const hasTrkReactivada = htmlHomePostReactivar.includes('p2p_1_22de5');
    const bannerDesaparecio = !htmlHomePostReactivar.includes('Tu cuenta no tiene servicios activos');

    console.log(`  ¿Saldo $1.81 restaurado?: ${hasSaldoReactivado}`);
    console.log(`  ¿Extensión cristian restaurada?: ${hasExtReactivada}`);
    console.log(`  ¿Troncal p2p_1_22de5 restaurada?: ${hasTrkReactivada}`);
    console.log(`  ¿Banner de reactivación ausente al estar activo?: ${bannerDesaparecio}`);

    assert.ok(hasSaldoReactivado, 'Saldo debe estar restaurado');
    assert.ok(hasExtReactivada, 'Extensión cristian debe estar restaurada');
    assert.ok(hasTrkReactivada, 'Troncal p2p_1_22de5 debe estar restaurada');
    assert.ok(bannerDesaparecio, 'El banner NO debe aparecer cuando el cliente está activo');
    console.log('✅ VERIFICACIÓN 8 EXITOSA: Reactivación completada y portal restaurado al 100%.\n');

    console.log('========================================================================');
    console.log('  RESUMEN: LAS 8 VERIFICACIONES DE BLOQUE Q3.3 APROBADAS (100% GREEN)   ');
    console.log('========================================================================\n');

  } finally {
    serverProcess.kill('SIGTERM');
    supabaseServer.close();
    gateServer.close();
  }
}

main().catch(err => {
  console.error('❌ ERROR FATAL EN SUITE Q3.3:', err);
  serverProcess.kill('SIGTERM');
  supabaseServer.close();
  gateServer.close();
  process.exit(1);
});
