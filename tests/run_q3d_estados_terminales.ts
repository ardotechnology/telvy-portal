import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert';

const ASTRO_PORT = 8093;
const MOCK_SUPABASE_PORT = 54325;
const MOCK_GATE_PORT = 4201;
const GATE_KEY = 'test_gate_internal_key_xyz987654321';

console.log('========================================================================');
console.log('  SUITE DE VERIFICACIÓN — BLOQUE Q3.4: ESTADOS TERMINALES DE ORDEN     ');
console.log('========================================================================\n');

const userA_Id = '11111111-1111-4111-8111-111111111111'; // 1001

// Estado dinámico de órdenes en el Gate simulado
let currentOrder: {
  id: string;
  estado: string;
  terminal?: boolean;
  error_publico?: string | null;
  ultimo_error?: string | null;
  motivo?: string | null;
  completado_at?: string | null;
} = {
  id: 'ebc4851c',
  estado: 'compensado',
  motivo: 'S2: payload.dids vacio — la baja no puede completarse en silencio',
  ultimo_error: 'S2: payload.dids vacio — la baja no puede completarse en silencio'
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

  // GET /v1/cliente/ordenes/:id
  if (url.startsWith('/v1/cliente/ordenes/')) {
    const ordenId = url.slice('/v1/cliente/ordenes/'.length).trim();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      orden_id: ordenId,
      cliente: clientHeader,
      tipo: 'baja_cuenta',
      estado: currentOrder.estado,
      ...(currentOrder.terminal !== undefined ? { terminal: currentOrder.terminal } : {}),
      ...(currentOrder.error_publico !== undefined ? { error_publico: currentOrder.error_publico } : {}),
      ...(currentOrder.ultimo_error !== undefined ? { ultimo_error: currentOrder.ultimo_error } : {}),
      motivo: currentOrder.motivo ?? null,
      completado_at: currentOrder.completado_at ?? null
    }));
  }

  // Endpoints estándar para carga de página
  if (url.startsWith('/v1/cliente/saldo')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      cliente: clientHeader,
      saldo: { credit: '1.8100', currency: 'MXN' },
      saldo_control: { saldo_base: 1.81, saldo_reservado: 0, saldo_disponible: 1.81 }
    }));
  }

  if (url.startsWith('/v1/cliente/extensiones')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, extensiones: [] }));
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
  res.end(JSON.stringify({ ok: false, error: 'Endpoint no encontrado' }));
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
});
serverProcess.stderr?.on('data', d => console.error('[Astro Err]', d.toString().trim()));

await new Promise(resolve => setTimeout(resolve, 1500));

// Login para obtener cookie de sesión
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

async function runAll() {
  try {
    // -------------------------------------------------------------------------
    // CRITERIO 1: orden 'compensado' -> NO dice "en proceso"; dice el fracaso y ofrece reintentar
    // -------------------------------------------------------------------------
    await check(1, "orden 'compensado' -> NO dice 'en proceso'; dice el fracaso y ofrece reintentar", async () => {
      currentOrder = {
        id: 'ebc4851c',
        estado: 'compensado',
        motivo: 'S2: payload.dids vacio — la baja no puede completarse en silencio',
        ultimo_error: 'S2: payload.dids vacio — la baja no puede completarse en silencio'
      };

      const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/orden-status?orden_id=ebc4851c`, {
        headers: { Cookie: cookie1001 }
      });
      const data = await res.json();

      assert.strictEqual(data.estado, 'compensado');
      assert.strictEqual(data.terminal, true, "Una orden compensada debe marcarse terminal=true");
      assert.ok(data.mensaje, "Debe tener campo 'mensaje' traducido para el cliente");
      assert.ok(!data.mensaje.toLowerCase().includes('en proceso'), "NO debe decir 'en proceso'");
      assert.ok(
        data.mensaje.includes('No se pudo completar: no había servicios que retirar') ||
        data.mensaje.includes('Tu cuenta quedó como estaba'),
        `Mensaje traducido debe explicar el fracaso. Mensaje actual: '${data.mensaje}'`
      );
      assert.strictEqual(data.puede_reintentar, true, "Debe ofrecer reintentar");
    });

    // -------------------------------------------------------------------------
    // CRITERIO 2: orden 'fallido' -> NO dice "en proceso"; dice el fracaso y ofrece reintentar
    // -------------------------------------------------------------------------
    await check(2, "orden 'fallido' -> NO dice 'en proceso'; dice el fracaso y ofrece reintentar", async () => {
      currentOrder = {
        id: 'fail-1234',
        estado: 'fallido',
        motivo: 'Error crítico en conmutador Edge',
        ultimo_error: 'Error crítico en conmutador Edge'
      };

      const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/orden-status?orden_id=fail-1234`, {
        headers: { Cookie: cookie1001 }
      });
      const data = await res.json();

      assert.strictEqual(data.estado, 'fallido');
      assert.strictEqual(data.terminal, true, "Una orden fallida debe marcarse terminal=true");
      assert.ok(data.mensaje, "Debe tener campo 'mensaje' traducido");
      assert.ok(!data.mensaje.toLowerCase().includes('en proceso'), "NO debe decir 'en proceso'");
      assert.ok(
        data.mensaje.includes('No se pudo completar la operación') ||
        data.mensaje.includes('Nada cambió en tu cuenta'),
        `Mensaje traducido debe explicar el fracaso. Mensaje actual: '${data.mensaje}'`
      );
      assert.strictEqual(data.puede_reintentar, true, "Debe ofrecer reintentar");
    });

    // -------------------------------------------------------------------------
    // CRITERIO 3: orden 'completado' -> éxito, sin botón de reintento
    // -------------------------------------------------------------------------
    await check(3, "orden 'completado' -> éxito, sin botón de reintento", async () => {
      currentOrder = {
        id: 'done-5678',
        estado: 'completado',
        motivo: null,
        ultimo_error: null,
        completado_at: '2026-11-12T07:30:00.000Z'
      };

      const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/orden-status?orden_id=done-5678`, {
        headers: { Cookie: cookie1001 }
      });
      const data = await res.json();

      assert.strictEqual(data.estado, 'completado');
      assert.strictEqual(data.terminal, true, "Una orden completada es terminal");
      assert.ok(data.mensaje, "Debe tener campo 'mensaje'");
      assert.ok(data.mensaje.includes('Tu baja se completó'), `Debe indicar que la baja se completó. Mensaje actual: '${data.mensaje}'`);
      assert.strictEqual(data.puede_reintentar, false, "Una orden completada NO ofrece reintento");
    });

    // -------------------------------------------------------------------------
    // CRITERIO 4: orden 'pendiente' -> 'sigue en proceso' con el orden_id
    // -------------------------------------------------------------------------
    await check(4, "orden 'pendiente' -> 'sigue en proceso' con el orden_id", async () => {
      currentOrder = {
        id: 'pend-9999',
        estado: 'pendiente',
        motivo: null,
        ultimo_error: null
      };

      const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/orden-status?orden_id=pend-9999`, {
        headers: { Cookie: cookie1001 }
      });
      const data = await res.json();

      assert.strictEqual(data.estado, 'pendiente');
      assert.strictEqual(data.terminal, false, "Una orden pendiente NO es terminal");
      assert.ok(data.mensaje.includes('Sigue en proceso'), `Debe decir 'Sigue en proceso'. Mensaje actual: '${data.mensaje}'`);
      assert.ok(data.mensaje.includes('pend-9999'), "Debe incluir el orden_id");
      assert.strictEqual(data.puede_reintentar, false, "No ofrece reintento mientras está pendiente");
    });

    // -------------------------------------------------------------------------
    // CRITERIO 5: el HTML / respuesta servida NO contiene el texto crudo del ultimo_error
    // -------------------------------------------------------------------------
    await check(5, "el HTML / respuesta servida NO contiene el texto crudo del ultimo_error", async () => {
      const RAW_CRUDE_ERROR = 'S2: payload.dids vacio — la baja no puede completarse en silencio';
      currentOrder = {
        id: 'ebc4851c',
        estado: 'compensado',
        motivo: RAW_CRUDE_ERROR,
        ultimo_error: RAW_CRUDE_ERROR
      };

      const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/orden-status?orden_id=ebc4851c`, {
        headers: { Cookie: cookie1001 }
      });
      const rawText = await res.text();

      // Ni 'S2: payload.dids vacio' ni 'la baja no puede completarse en silencio' deben aparecer en la respuesta al cliente
      const leaksRawError = rawText.includes(RAW_CRUDE_ERROR) || rawText.includes('S2: payload.dids vacio');
      assert.strictEqual(
        leaksRawError,
        false,
        `La respuesta al cliente NO debe contener el texto crudo '${RAW_CRUDE_ERROR}' (filtración de detalles internos del motor)`
      );
    });

    // -------------------------------------------------------------------------
    // CRITERIO 6: estado desconocido -> 'Estado no disponible', sin 500
    // -------------------------------------------------------------------------
    await check(6, "estado desconocido -> 'Estado no disponible', sin 500", async () => {
      currentOrder = {
        id: 'unknown-0000',
        estado: 'estado_inexistente_xyz',
        motivo: null,
        ultimo_error: null
      };

      const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/cuenta/orden-status?orden_id=unknown-0000`, {
        headers: { Cookie: cookie1001 }
      });
      assert.strictEqual(res.status, 200, "Debe responder 200 sin error 500 ante estado desconocido");
      const data = await res.json();
      assert.ok(data.mensaje.includes('Estado no disponible'), `Debe decir 'Estado no disponible'. Mensaje actual: '${data.mensaje}'`);
    });

  } finally {
    console.log('\n========================================================================');
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    console.log(`  RESUMEN: ${passed} APROBADOS, ${failed} FALLADOS DE ${results.length}`);
    console.log('========================================================================\n');

    serverProcess.kill('SIGTERM');
    await new Promise<void>(resolve => gateServer.close(() => resolve()));
    await new Promise<void>(resolve => supabaseServer.close(() => resolve()));
    process.exit(failed > 0 ? 1 : 0);
  }
}

runAll().catch(err => {
  console.error('Error fatal:', err);
  serverProcess.kill('SIGTERM');
  process.exit(1);
});
