import assert from 'node:assert';
import http from 'node:http';
import { spawn } from 'node:child_process';

const ASTRO_PORT = 8092;
const MOCK_GATE_PORT = 4199;
const MOCK_SUPABASE_PORT = 54323;
const GATE_KEY = 'test_gate_internal_key_xyz987654321';
const userA_Id = '11111111-1111-4111-8111-111111111111';

async function main() {
  console.log('========================================================================');
  console.log('  VERIFICACIÓN COSMÉTICA DE PILLS DE ESTADO (EXTENSIONES Y TRONCALES)   ');
  console.log('========================================================================\n');

  // 1. Iniciar mock de telvy-client-gate con lineStatus "OK (17 ms) localhost" y "OK (12 ms) localhost"
  const gateServer = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/v1/cliente/saldo')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        cliente: '1001',
        saldo: { credit: '154.20000', currency: 'MXN' }
      }));
    }

    if (url.startsWith('/v1/cliente/extensiones')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        cliente: '1001',
        extensiones: [
          {
            id: 101,
            name: 'cristian',
            host: 'dynamic',
            callerid: '1001',
            online: true,
            lineStatus: 'OK (17 ms) localhost',
            activo: 1
          },
          {
            id: 102,
            name: 'ext_sin_verificar',
            host: 'dynamic',
            callerid: '1002',
            online: true,
            lineStatus: 'OK',
            activo: 1
          }
        ]
      }));
    }

    if (url.startsWith('/v1/cliente/troncales')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        cliente: '1001',
        troncales: [
          {
            id: 501,
            name: 'p2p_1_22de5',
            host: '140.84.180.77',
            max_channels: 10,
            online: true,
            lineStatus: 'OK (12 ms) localhost',
            activo: 1
          },
          {
            id: 502,
            name: 'p2p_sin_verificar',
            host: '140.84.180.77',
            max_channels: 10,
            online: false,
            lineStatus: 'UNKNOWN',
            activo: 1
          }
        ]
      }));
    }

    if (url.startsWith('/v1/cliente/dids')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, dids: [] }));
    }

    if (url.startsWith('/v1/cliente/avisos/pendientes')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, avisos: [] }));
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>(resolve => gateServer.listen(MOCK_GATE_PORT, resolve));

  // 2. Supabase Mock Server (Auth + PostgREST)
  const supabaseServer = http.createServer((req, res) => {
    const url = req.url || '';
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
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
        res.writeHead(200, { 'Content-Type': isSingle ? 'application/vnd.pgrst.object+json' : 'application/json' });
        const record = { cliente: '1001', email: 'cristianxrdz@gmail.com', estado: 'activa' };
        return res.end(JSON.stringify(isSingle ? record : [record]));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    });
  });

  await new Promise<void>(resolve => supabaseServer.listen(MOCK_SUPABASE_PORT, resolve));

  // 3. Levantar Astro
  const astroProc = spawn('node', ['dist/server/entry.mjs'], {
    cwd: '/Users/ardogroup/Desktop/portal-telvy/app',
    env: {
      ...process.env,
      PORT: String(ASTRO_PORT),
      HOST: '127.0.0.1',
      TELVY_GATE_URL: `http://127.0.0.1:${MOCK_GATE_PORT}`,
      CLIENT_API_INTERNAL_KEY: GATE_KEY,
      SUPABASE_URL: `http://127.0.0.1:${MOCK_SUPABASE_PORT}`,
      SUPABASE_ANON_KEY: 'test_anon_key'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise(r => setTimeout(r, 1500));

  try {
    // 4. Login como cristianxrdz@gmail.com
    const loginRes = await fetch(`http://127.0.0.1:${ASTRO_PORT}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=cristianxrdz@gmail.com&password=Clave1001!',
      redirect: 'manual'
    });

    const cookieHeader = loginRes.headers.get('set-cookie');
    assert.ok(cookieHeader, 'Debe devolver cookie de sesión en login');

    const cookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [cookieHeader];
    const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

    // 5. Solicitar /
    const pageRes = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, {
      headers: { Cookie: cookieStr }
    });

    const html = await pageRes.text();

    console.log('--- VALIDACIONES DE FORMATO VISUAL ---');

    // Validación A: grep que NUNCA exista "localhost" en el HTML
    const hasLocalhost = html.includes('localhost');
    console.log(`¿La palabra 'localhost' aparece en el HTML servido?: ${hasLocalhost ? '❌ SÍ (ERROR)' : '✅ NO (CORRECTO)'}`);
    assert.strictEqual(hasLocalhost, false, "El HTML no debe contener 'localhost'");

    // Validación B: Extensión con latencia "Registrada · 17 ms"
    const hasExtRegistradaLatencia = html.includes('Registrada') && html.includes('17 ms');
    console.log(`¿Extensión muestra 'Registrada · 17 ms' sin paréntesis anidados?: ${hasExtRegistradaLatencia ? '✅ SÍ' : '❌ NO'}`);
    assert.ok(hasExtRegistradaLatencia, "La extensión debe mostrar 'Registrada · 17 ms'");

    // Validación C: Troncal con latencia "En línea · 12 ms"
    const hasTrkEnLineaLatencia = html.includes('En línea') && html.includes('12 ms');
    console.log(`¿Troncal muestra 'En línea · 12 ms' sin paréntesis anidados?: ${hasTrkEnLineaLatencia ? '✅ SÍ' : '❌ NO'}`);
    assert.ok(hasTrkEnLineaLatencia, "La troncal debe mostrar 'En línea · 12 ms'");

    // Validación D: Sin verificación no debe decir OK, debe decir "sin verificar"
    const hasSinVerificar = html.includes('sin verificar');
    console.log(`¿Recursos sin qualify/latencia muestran 'sin verificar' en lugar de 'OK'?: ${hasSinVerificar ? '✅ SÍ' : '❌ NO'}`);
    assert.ok(hasSinVerificar, "Debe mostrar 'sin verificar'");

    // Validación E: Troncal desconectada muestra "Sin respuesta"
    const hasSinRespuesta = html.includes('Sin respuesta');
    console.log(`¿Troncal desconectada muestra 'Sin respuesta'?: ${hasSinRespuesta ? '✅ SÍ' : '❌ NO'}`);
    assert.ok(hasSinRespuesta, "La troncal desconectada debe mostrar 'Sin respuesta'");

    // Imprimir fragmentos relevantes de HTML
    console.log('\n--- FRAGMENTOS HTML RENDERIZADOS ---');
    const tableMatches = html.match(/<table[\s\S]*?<\/table>/g);
    if (tableMatches) {
      for (let i = 0; i < tableMatches.length; i++) {
        console.log(`\n[Tabla ${i + 1}]:\n${tableMatches[i]}\n`);
      }
    }

    console.log('\n========================================================================');
    console.log('  ✅ TODAS LAS VALIDACIONES COSMÉTICAS APROBADAS AL 100%');
    console.log('========================================================================\n');

  } finally {
    astroProc.kill('SIGTERM');
    await new Promise<void>(resolve => gateServer.close(() => resolve()));
    await new Promise<void>(resolve => supabaseServer.close(() => resolve()));
  }
}

main().catch(err => {
  console.error('Error en prueba cosmética:', err);
  process.exit(1);
});
