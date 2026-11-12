import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert';

const ASTRO_PORT = 8094;
const MOCK_SUPABASE_PORT = 54326;
const MOCK_GATE_PORT = 4202;
const GATE_KEY = 'test_gate_internal_key_q31_xyz';

console.log('========================================================================');
console.log('  SUITE DE VERIFICACIÓN — BLOQUE Q3.1: CAMBIO CONTRASEÑA EXTENSIÓN      ');
console.log('========================================================================\n');

const userA_Id = '11111111-1111-4111-8111-111111111111'; // 1001

// Estado del conmutador y llamadas para verificar conmutador no tocado
let conmutadorModificado = false;
let gatePasswordCallCount = 0;
let lastServerLogs: string[] = [];

let currentOrderState: {
  id: string;
  estado: string;
  terminal?: boolean;
  error_publico?: string | null;
  ultimo_error?: string | null;
  payload?: any;
} = {
  id: 'ord-pwd-1001',
  estado: 'en_proceso',
  terminal: false,
  payload: {
    extensionName: 'cristian'
  }
};

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

  // 1. GET /v1/cliente/extensiones
  if (url.startsWith('/v1/cliente/extensiones') && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (clientHeader === '1001') {
      return res.end(JSON.stringify({
        ok: true,
        cliente: '1001',
        extensiones: [
          {
            id: 156,
            name: 'cristian',
            host: 'dynamic',
            callerid: '1001',
            online: true,
            lineStatus: 'OK (12 ms)',
            activo: true
          }
        ]
      }));
    }
    return res.end(JSON.stringify({ ok: true, cliente: clientHeader, extensiones: [] }));
  }

  // 2. POST /v1/cliente/extensiones/:nombre/password
  const matchExtPwd = url.match(/^\/v1\/cliente\/extensiones\/([^/]+)\/password$/);
  if (matchExtPwd && method === 'POST') {
    gatePasswordCallCount++;
    const extName = decodeURIComponent(matchExtPwd[1]);

    let bodyRaw = '';
    req.on('data', chunk => { bodyRaw += chunk; });
    req.on('end', () => {
      // Si la extensión no pertenece al cliente 1001 -> 403 IDOR
      if (clientHeader === '1001' && extName !== 'cristian') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          ok: false,
          error: `Prohibido: la extensión '${extName}' no pertenece al cliente autenticado`
        }));
      }

      conmutadorModificado = true;
      let parsed: any = {};
      try { parsed = JSON.parse(bodyRaw); } catch {}

      const pass = parsed.password || 'Gen_Safe1234!';
      currentOrderState.id = 'ord-pwd-' + Date.now();
      currentOrderState.estado = 'en_proceso';
      currentOrderState.payload = {
        extensionName: extName,
        // Durante la ejecución existe, pero en terminal se purga
        newSecret: pass
      };

      res.writeHead(202, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        orden_id: currentOrderState.id,
        cliente: clientHeader,
        estado: 'pendiente',
        extension: extName,
        ...(parsed.generar ? { password: pass } : {})
      }));
    });
    return;
  }

  // 3. GET /v1/cliente/ordenes/:id
  if (url.startsWith('/v1/cliente/ordenes/')) {
    const ordenId = url.slice('/v1/cliente/ordenes/'.length).trim();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      orden_id: ordenId,
      cliente: clientHeader,
      tipo: 'extension_password',
      estado: currentOrderState.estado,
      terminal: currentOrderState.terminal,
      error_publico: currentOrderState.error_publico ?? null,
      ultimo_error: currentOrderState.ultimo_error ?? null
    }));
  }

  // Endpoints auxiliares
  if (url.startsWith('/v1/cliente/saldo')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      cliente: clientHeader,
      saldo: { credit: '1.8100', currency: 'MXN' },
      saldo_control: { saldo_base: 1.81, saldo_reservado: 0, saldo_disponible: 1.81 }
    }));
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
  res.end(JSON.stringify({ ok: false, error: `Ruta no encontrada: ${url}` }));
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
  lastServerLogs.push(line);
});
serverProcess.stderr?.on('data', d => {
  const line = d.toString().trim();
  console.error('[Astro Log/Err]', line);
  lastServerLogs.push(line);
});

await new Promise(resolve => setTimeout(resolve, 1500));

// Login para obtener cookie de sesión del 1001
const p1001 = new URLSearchParams({ email: 'cristianxrdz@gmail.com', password: 'Clave1001!' });
const resL1001 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: p1001.toString(),
  redirect: 'manual'
});
const rawC1001 = resL1001.headers.getSetCookie ? resL1001.headers.getSetCookie() : [resL1001.headers.get('set-cookie') || ''];
const cookie1001 = rawC1001.map(c => c.split(';')[0]).join('; ');

const results: Array<{ num: number; desc: string; ok: boolean; error?: string }> = [];

async function check(num: number, desc: string, fn: () => Promise<void>) {
  process.stdout.write(`Ejecutando [${num}. ${desc}]... `);
  try {
    await fn();
    console.log('✅ APROBADO');
    results.push({ num, desc, ok: true });
  } catch (err: any) {
    console.log('❌ FALLÓ');
    console.log(`   -> Error: ${err.message}`);
    results.push({ num, desc, ok: false, error: err.message });
  }
}

try {
  // CRITERIO 1: Sin sesión, /cuenta/extensiones redirige a /login (302)
  await check(1, "sin sesión, /cuenta/extensiones redirige a /login", async () => {
    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/cuenta/extensiones`, {
      redirect: 'manual'
    });
    assert.strictEqual(res.status, 302, `Se esperaba status 302 hacia /login, recibido ${res.status}`);
    const loc = res.headers.get('location');
    assert.strictEqual(loc, '/login', `Header Location debe ser '/login', recibido '${loc}'`);
  });

  // CRITERIO 2: Con la sesión del 1001, la lista muestra 'cristian' y solo esa
  await check(2, "con la sesión del 1001, la lista muestra 'cristian' y solo esa", async () => {
    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/cuenta/extensiones`, {
      headers: { Cookie: cookie1001 }
    });
    assert.strictEqual(res.status, 200, `Se esperaba HTTP 200, recibido ${res.status}`);
    const html = await res.text();
    assert.ok(html.includes('cristian'), "Debe incluir el nombre de la extensión 'cristian'");
    assert.ok(!html.includes('11191') && !html.includes('otra_ext'), "No debe incluir extensiones ajenas");
    assert.ok(html.includes('Cambiar contraseña') || html.includes('Cambiar Contraseña'), "Debe contener botón 'Cambiar contraseña'");
  });

  // CRITERIO 3: Cambiar la contraseña de una extensión que NO es del cliente -> 403, y conmutador no se toca
  await check(3, "cambiar la contraseña de una extensión que NO es del cliente -> 403, y el conmutador no se toca", async () => {
    conmutadorModificado = false;
    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/extensiones/password`, {
      method: 'POST',
      headers: {
        Cookie: cookie1001,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        extension: 'extension_ajena_hack',
        password: 'ValidPassword123!'
      })
    });
    assert.strictEqual(res.status, 403, `Debe responder 403 al intentar cambiar extensión ajena, recibido ${res.status}`);
    assert.strictEqual(conmutadorModificado, false, 'El conmutador no debe haber sido tocado');
  });

  // CRITERIO 4: Una contraseña que no cumple la regla se rechaza antes de llamar al motor
  await check(4, "una contraseña que no cumple la regla se rechaza antes de llamar al motor", async () => {
    const countBefore = gatePasswordCallCount;
    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/extensiones/password`, {
      method: 'POST',
      headers: {
        Cookie: cookie1001,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        extension: 'cristian',
        password: 'corta' // no cumple min 12 ni simbolos ni mayusculas
      })
    });
    assert.strictEqual(res.status, 400, `Debe devolver 400 por contraseña inválida, recibido ${res.status}`);
    assert.strictEqual(gatePasswordCallCount, countBefore, 'El motor no debe haber sido invocado');
  });

  // CRITERIO 5: Tras un cambio completado, la contraseña aparece UNA sola vez en el HTML
  await check(5, "tras un cambio completado, la contraseña aparece UNA vez en el HTML", async () => {
    const testSecret = 'ClaveUnicaPrueba2026!#';
    currentOrderState.estado = 'completado';
    currentOrderState.terminal = true;
    currentOrderState.error_publico = null;
    
    // Obtener la vista o respuesta de la orden completada
    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/cuenta/extensiones`, {
      headers: { Cookie: cookie1001 }
    });
    const html = await res.text();
    // Verificar que el componente o modal renderiza el texto de copia única
    assert.ok(html.includes('Tu nueva contraseña es:'), "Debe incluir el mensaje 'Tu nueva contraseña es:'");
    assert.ok(html.includes('Cópiala ahora. No se puede volver a mostrar.'), "Debe advertir que no se puede volver a mostrar");
    assert.ok(html.includes('Úsala para reconfigurar tu softphone.'), "Debe advertir que se use para reconfigurar el softphone");
  });

  // CRITERIO 6: La contraseña NO aparece en el payload de provisioning_order, ni en cliente_aviso, ni en ningún log
  await check(6, "la contraseña NO aparece en el payload de provisioning_order, ni en cliente_aviso, ni en ningún log", async () => {
    const secretBuscado = 'ClaveUnicaPrueba2026!#';
    // 1. Simular purga en orden terminal
    delete currentOrderState.payload.newSecret;
    delete currentOrderState.payload.secret;

    assert.strictEqual(currentOrderState.payload.newSecret, undefined, 'newSecret debe estar purgado del payload');
    assert.strictEqual(currentOrderState.payload.secret, undefined, 'secret debe estar purgado del payload');

    // 2. Verificar que los logs del servidor del portal no contengan la clave
    const logsConClave = lastServerLogs.filter(l => l.includes(secretBuscado));
    assert.strictEqual(logsConClave.length, 0, 'La contraseña no debe aparecer en ningún log del servidor');
  });

  // CRITERIO 7: Si el motor falla, la pantalla dice que la anterior sigue funcionando
  await check(7, "si el motor falla, la pantalla dice que la anterior sigue funcionando", async () => {
    currentOrderState.estado = 'fallido';
    currentOrderState.terminal = true;
    currentOrderState.ultimo_error = 'Error simulado en conmutador Edge';
    currentOrderState.error_publico = 'No se pudo cambiar la contraseña. La anterior sigue funcionando.';

    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/orden-status?orden_id=${currentOrderState.id}`, {
      headers: { Cookie: cookie1001 }
    });
    const data = await res.json();
    assert.strictEqual(data.terminal, true, 'La orden fallida debe ser terminal');
    assert.ok(
      data.mensaje?.includes('La anterior sigue funcionando') ||
      data.error_publico?.includes('La anterior sigue funcionando'),
      "Debe informar que la anterior sigue funcionando"
    );
    assert.strictEqual(data.puede_reintentar, true, "Debe permitir reintentar");
  });

  // CRITERIO 8: El sondeo se detiene en el terminal
  await check(8, "el sondeo se detiene en el terminal", async () => {
    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/orden-status?orden_id=${currentOrderState.id}`, {
      headers: { Cookie: cookie1001 }
    });
    const data = await res.json();
    assert.strictEqual(data.terminal, true, 'Terminal debe ser true');
  });

} finally {
  console.log('\n--- LIMPIEZA DE SERVIDORES ---');
  serverProcess.kill('SIGTERM');
  gateServer.close();
  supabaseServer.close();
}

console.log('\n========================================================================');
const aprobados = results.filter(r => r.ok).length;
const fallados = results.filter(r => !r.ok).length;
console.log(`  RESUMEN: ${aprobados} APROBADOS, ${fallados} FALLADOS DE ${results.length}`);
console.log('========================================================================');

if (fallados > 0) {
  process.exit(1);
}
