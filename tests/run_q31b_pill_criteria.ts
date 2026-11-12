import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert';

const ASTRO_PORT = 8095;
const MOCK_SUPABASE_PORT = 54327;
const MOCK_GATE_PORT = 4203;
const GATE_KEY = 'test_gate_internal_key_q31b_xyz';

console.log('========================================================================');
console.log('  SUITE DE VERIFICACIÓN — BLOQUE Q3.1b: PÍLDORA DE ESTADO UNIFICADA     ');
console.log('========================================================================\n');

const userA_Id = '11111111-1111-4111-8111-111111111111'; // 1001

// Servidor simulador de Gate / Motor VoIP
const gateServer = http.createServer((req, res) => {
  const internalKey = req.headers['x-internal-key'] as string;
  const clientHeader = req.headers['x-authenticated-client'] as string;

  if (internalKey !== GATE_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Unauthorized gate key' }));
  }

  const url = req.url || '';

  // GET /v1/cliente/extensiones
  if (url.startsWith('/v1/cliente/extensiones')) {
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
            // Simula la salida real de Asterisk/Magnus
            lineStatus: 'OK (20 ms) localhost',
            activo: true
          }
        ]
      }));
    }
    return res.end(JSON.stringify({ ok: true, cliente: clientHeader, extensiones: [] }));
  }

  // GET /v1/cliente/troncales
  if (url.startsWith('/v1/cliente/troncales')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (clientHeader === '1001') {
      return res.end(JSON.stringify({
        ok: true,
        cliente: '1001',
        troncales: [
          {
            id: 201,
            name: 'p2p_1_22de5',
            host: '192.168.1.100',
            online: true,
            lineStatus: 'OK (15 ms) localhost',
            activo: true
          }
        ]
      }));
    }
    return res.end(JSON.stringify({ ok: true, cliente: clientHeader, troncales: [] }));
  }

  // Endpoints estándar
  if (url.startsWith('/v1/cliente/saldo')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      cliente: clientHeader,
      saldo: { credit: '1.8100', currency: 'MXN' },
      saldo_control: { saldo_base: 1.81, saldo_reservado: 0, saldo_disponible: 1.81 }
    }));
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
  // CRITERIO 1: /cuenta/extensiones NO contiene 'localhost'
  await check(1, "/cuenta/extensiones NO contiene 'localhost'", async () => {
    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/cuenta/extensiones`, {
      headers: { Cookie: cookie1001 }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(
      !html.toLowerCase().includes('localhost'),
      `La pantalla /cuenta/extensiones contiene 'localhost' filtrado en el estado`
    );
  });

  // CRITERIO 2: /cuenta/extensiones muestra 'Registrada' o 'Desconectada', nunca 'En línea'
  await check(2, "/cuenta/extensiones muestra 'Registrada' o 'Desconectada', nunca 'En línea'", async () => {
    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/cuenta/extensiones`, {
      headers: { Cookie: cookie1001 }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(
      !html.includes('En Línea') && !html.includes('En línea'),
      `La pantalla /cuenta/extensiones contiene 'En línea' / 'En Línea' aplicado a una extensión`
    );
    assert.ok(
      html.includes('Registrada') || html.includes('Desconectada'),
      `La pantalla /cuenta/extensiones debe mostrar 'Registrada' o 'Desconectada'`
    );
  });

  // CRITERIO 3: / NO contiene 'localhost'
  await check(3, "/ NO contiene 'localhost'", async () => {
    const res = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, {
      headers: { Cookie: cookie1001 }
    });
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(
      !html.toLowerCase().includes('localhost'),
      `La pantalla principal / contiene 'localhost'`
    );
  });

  // CRITERIO 4: Ninguna página contiene 'OK (' (tanto HTML servido como archivos .astro)
  await check(4, "ninguna página contiene 'OK ('", async () => {
    // 1. Verificar HTML servido de /cuenta/extensiones y /
    const resExt = await fetch(`http://127.0.0.1:${ASTRO_PORT}/cuenta/extensiones`, {
      headers: { Cookie: cookie1001 }
    });
    const htmlExt = await resExt.text();
    assert.ok(!htmlExt.includes('OK ('), "HTML de /cuenta/extensiones no debe contener 'OK ('");

    const resHome = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, {
      headers: { Cookie: cookie1001 }
    });
    const htmlHome = await resHome.text();
    assert.ok(!htmlHome.includes('OK ('), "HTML de / no debe contener 'OK ('");

    // 2. Escaneo estricto de código en app/src/pages para que no vuelva a pasar
    const pagesDir = path.resolve('./app/src/pages');
    const walk = (dir: string): string[] => {
      let files: string[] = [];
      for (const item of fs.readdirSync(dir)) {
        const full = path.join(dir, item);
        if (fs.statSync(full).isDirectory()) {
          files = files.concat(walk(full));
        } else if (item.endsWith('.astro')) {
          files.push(full);
        }
      }
      return files;
    };

    const astroFiles = walk(pagesDir);
    for (const f of astroFiles) {
      const content = fs.readFileSync(f, 'utf8');
      assert.ok(
        !content.includes('OK ('),
        `El archivo ${path.relative('.', f)} contiene la cadena cruda 'OK ('`
      );
    }
  });

  // CRITERIO 5: Un recurso sin dato de registro muestra 'sin verificar'
  await check(5, "un recurso sin dato de registro muestra 'sin verificar'", async () => {
    // Importar directamente el formateador unificado o verificarlo en la renderización
    // Si aún no existe el archivo estado_pill.ts, fallará aquí
    const pillModulePath = path.resolve('./app/src/lib/estado_pill.ts');
    assert.ok(fs.existsSync(pillModulePath), "Debe existir el módulo app/src/lib/estado_pill.ts");
    
    const { formatearPildoraEstado } = await import(pillModulePath);
    const resSinDato = formatearPildoraEstado('ext', true, '');
    assert.strictEqual(resSinDato.meta, 'sin verificar', "Recurso sin dato debe devolver meta 'sin verificar'");
    assert.strictEqual(resSinDato.texto, 'Registrada');

    const trkSinDato = formatearPildoraEstado('trk', false, undefined);
    assert.strictEqual(trkSinDato.meta, 'sin verificar', "Troncal sin dato debe devolver meta 'sin verificar'");
    assert.strictEqual(trkSinDato.texto, 'Sin respuesta');
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
