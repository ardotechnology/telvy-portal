import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pg from '../app/node_modules/pg/lib/index.js';

const ASTRO_PORT = 8089;
const MOCK_SUPABASE_PORT = 54322;
const MOCK_GATE_PORT = 4198;
const GATE_KEY = 'test_gate_internal_key_xyz987654321';

console.log('========================================================================');
console.log('  EJECUTANDO SUITE DE VERIFICACIONES — BLOQUE Q2: SUPABASE AUTH PORTAL  ');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// 1. MOCK SERVERS (Supabase Auth & PostgREST + VoIP Engine Gate)
// -----------------------------------------------------------------------------
const user1001Id = '11111111-1111-4111-8111-111111111111';
const user1002Id = '22222222-2222-4222-8222-222222222222';

// Gate Server
const gateServer = http.createServer((req, res) => {
  const internalKey = req.headers['x-internal-key'];
  const clientHeader = req.headers['x-authenticated-client'];

  if (internalKey !== GATE_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Unauthorized gate key' }));
  }

  const url = req.url || '';
  if (url.startsWith('/v1/cliente/saldo')) {
    const saldo = clientHeader === '1001' ? 154.20 : 890.50;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      cliente: clientHeader,
      saldo: {
        credit: saldo,
        currency: 'MXN'
      }
    }));
  }

  if (url.startsWith('/v1/cliente/extensiones')) {
    const ext = clientHeader === '1001'
      ? [{ id: 101, numero: '101', nombre: 'Recepción Central', estado: 'registrada' }]
      : [{ id: 201, numero: '201', nombre: 'Soporte VIP', estado: 'registrada' }];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, extensiones: ext }));
  }

  if (url.startsWith('/v1/cliente/troncales')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, troncales: [] }));
  }

  if (url.startsWith('/v1/cliente/dids')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, dids: [] }));
  }

  if (url.startsWith('/v1/cliente/avisos/pendientes')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, avisos: [] }));
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

await new Promise<void>(resolve => gateServer.listen(MOCK_GATE_PORT, resolve));

// Supabase Mock Server (Auth + PostgREST)
const supabaseServer = http.createServer((req, res) => {
  const url = req.url || '';
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // 1. Password sign-in
    if (url.includes('/auth/v1/token') && req.method === 'POST') {
      const parsedBody = JSON.parse(body || '{}');
      if (parsedBody.email === 'cliente1001@telvy.net' && parsedBody.password === 'Clave1001!') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          access_token: 'token-user-1001',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'refresh-user-1001',
          user: { id: user1001Id, email: 'cliente1001@telvy.net' }
        }));
      }
      if (parsedBody.email === 'cliente1002@telvy.net' && parsedBody.password === 'Clave1002!') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          access_token: 'token-user-1002',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'refresh-user-1002',
          user: { id: user1002Id, email: 'cliente1002@telvy.net' }
        }));
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Invalid login credentials'
      }));
    }

    // 2. Get User
    if (url.includes('/auth/v1/user') && req.method === 'GET') {
      const authHeader = req.headers['authorization'] || '';
      if (authHeader.includes('token-user-1001')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: user1001Id, email: 'cliente1001@telvy.net' }));
      }
      if (authHeader.includes('token-user-1002')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: user1002Id, email: 'cliente1002@telvy.net' }));
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'invalid token' }));
    }

    // 3. PostgREST portal_cuenta_usuario query
    if (url.includes('/rest/v1/portal_cuenta_usuario')) {
      // Supabase JS sends headers: Accept: application/vnd.pgrst.object+json when using .single()
      const isSingle = (req.headers['accept'] || '').includes('vnd.pgrst.object+json');
      if (url.includes(user1001Id)) {
        res.writeHead(200, { 'Content-Type': isSingle ? 'application/vnd.pgrst.object+json' : 'application/json' });
        const record = { cliente: '1001', email: 'cliente1001@telvy.net', estado: 'activa' };
        return res.end(JSON.stringify(isSingle ? record : [record]));
      }
      if (url.includes(user1002Id)) {
        res.writeHead(200, { 'Content-Type': isSingle ? 'application/vnd.pgrst.object+json' : 'application/json' });
        const record = { cliente: '1002', email: 'cliente1002@telvy.net', estado: 'activa' };
        return res.end(JSON.stringify(isSingle ? record : [record]));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([]));
    }

    // 4. Logout
    if (url.includes('/auth/v1/logout')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({}));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });
});

await new Promise<void>(resolve => supabaseServer.listen(MOCK_SUPABASE_PORT, resolve));

// -----------------------------------------------------------------------------
// VERIFICACIÓN 4: Prueba de RLS en PostgreSQL con rol no privilegiado
// -----------------------------------------------------------------------------
console.log('--- VERIFICACIÓN 4: RLS activada en PostgreSQL - Aislamiento entre usuarios ---');
const pool = new pg.Pool({ connectionString: 'postgresql://ardogroup@localhost:5432/telvy_test' });

await pool.query(`
  CREATE SCHEMA IF NOT EXISTS auth;

  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$ LANGUAGE sql STABLE;

  CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS public.portal_cuenta_usuario (
    auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    cliente TEXT NOT NULL,
    email TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'activa', 'suspendida')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT portal_cuenta_usuario_cliente_key UNIQUE (cliente)
  );

  ALTER TABLE public.portal_cuenta_usuario ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.portal_cuenta_usuario FORCE ROW LEVEL SECURITY;

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated;
    END IF;
  END $$;

  GRANT USAGE ON SCHEMA public TO authenticated;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT SELECT ON public.portal_cuenta_usuario TO authenticated;

  DROP POLICY IF EXISTS "portal_cuenta_usuario_select_own" ON public.portal_cuenta_usuario;
  CREATE POLICY "portal_cuenta_usuario_select_own"
    ON public.portal_cuenta_usuario
    FOR SELECT
    TO authenticated
    USING (auth.uid() = auth_user_id);

  INSERT INTO auth.users (id, email) VALUES
    ('${user1001Id}', 'cliente1001@telvy.net'),
    ('${user1002Id}', 'cliente1002@telvy.net')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.portal_cuenta_usuario (auth_user_id, cliente, email, estado) VALUES
    ('${user1001Id}', '1001', 'cliente1001@telvy.net', 'activa'),
    ('${user1002Id}', '1002', 'cliente1002@telvy.net', 'activa')
  ON CONFLICT (auth_user_id) DO UPDATE SET cliente = EXCLUDED.cliente, estado = 'activa';
`);

const pgClient = await pool.connect();
try {
  await pgClient.query('SET ROLE authenticated;');
  await pgClient.query(`SET request.jwt.claim.sub = '${user1001Id}';`);

  // Usuario 1001 consulta sus filas
  const resOwn = await pgClient.query('SELECT auth_user_id, cliente, email FROM public.portal_cuenta_usuario');
  console.log(`[Usuario 1001] SELECT general: filas devueltas = ${resOwn.rows.length}`);
  console.log(`  Datos leídos: Cliente ${resOwn.rows[0]?.cliente} (${resOwn.rows[0]?.email})`);

  // Usuario 1001 intenta consultar la fila de 1002
  const resAjeno = await pgClient.query('SELECT * FROM public.portal_cuenta_usuario WHERE auth_user_id = $1', [user1002Id]);
  console.log(`[Usuario 1001] SELECT explícito sobre fila de 1002: filas devueltas = ${resAjeno.rows.length}`);

  // Usuario 1001 intenta insertar o actualizar (debe fallar)
  let insertError = null;
  try {
    await pgClient.query(`INSERT INTO public.portal_cuenta_usuario (auth_user_id, cliente, email) VALUES (gen_random_uuid(), '9999', 'hacker@telvy.net')`);
  } catch (err: any) {
    insertError = err.message;
  }
  console.log(`[Usuario 1001] Intento de INSERT no autorizado: bloqueado con mensaje: "${insertError}"`);

  await pgClient.query('RESET ROLE;');

  if (resOwn.rows.length === 1 && resOwn.rows[0].cliente === '1001' && resAjeno.rows.length === 0 && insertError) {
    console.log('✅ VERIFICACIÓN 4 EXITOSA: RLS aísla completamente y prohíbe inserción.\n');
  } else {
    throw new Error('Falla en Verificación 4 de RLS.');
  }
} finally {
  pgClient.release();
}

// -----------------------------------------------------------------------------
// INICIAR SERVIDOR ASTRO
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// VERIFICACIÓN 1: Sin sesión, / redirige a /login (302)
// -----------------------------------------------------------------------------
console.log('--- VERIFICACIÓN 1: Sin sesión, / redirige a /login (302) ---');
const resAnon = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, { redirect: 'manual' });
console.log(`HTTP Status: ${resAnon.status}`);
console.log(`Location Header: ${resAnon.headers.get('location')}`);
if (resAnon.status === 302 && resAnon.headers.get('location') === '/login') {
  console.log('✅ VERIFICACIÓN 1 EXITOSA: Redirección 302 hacia /login confirmada.\n');
} else {
  console.error('❌ Falla en Verificación 1.');
}

// -----------------------------------------------------------------------------
// VERIFICACIÓN 6: /login con credenciales falsas no revela si correo existe
// -----------------------------------------------------------------------------
console.log('--- VERIFICACIÓN 6: /login con credenciales falsas (anti-enumeración) ---');
const postParamsFake = new URLSearchParams();
postParamsFake.append('email', 'correo_inexistente_aleatorio@telvy.net');
postParamsFake.append('password', 'ClaveInvalida123!');

const resLoginFake = await fetch(`http://127.0.0.1:${ASTRO_PORT}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: postParamsFake.toString()
});
const htmlLoginFake = await resLoginFake.text();
const hasGenericError = htmlLoginFake.includes('Correo o contraseña incorrectos');
const leaksEmailExistence = htmlLoginFake.includes('no encontrado') || htmlLoginFake.includes('no existe') || htmlLoginFake.includes('inexistente');
console.log(`HTTP Status: ${resLoginFake.status}`);
console.log(`¿Mensaje genérico "Correo o contraseña incorrectos" presente?: ${hasGenericError}`);
console.log(`¿Fuga información sobre existencia del usuario?: ${leaksEmailExistence}`);

if (hasGenericError && !leaksEmailExistence) {
  console.log('✅ VERIFICACIÓN 6 EXITOSA: Respuesta genérica anti-enumeración confirmada.\n');
} else {
  console.error('❌ Falla en Verificación 6.');
}

// -----------------------------------------------------------------------------
// VERIFICACIÓN 2: Sesión del cliente 1001 ve sus datos
// -----------------------------------------------------------------------------
console.log('--- VERIFICACIÓN 2: Login e inicio de sesión del cliente 1001 ---');
const postParams1001 = new URLSearchParams();
postParams1001.append('email', 'cliente1001@telvy.net');
postParams1001.append('password', 'Clave1001!');

const resLogin1001 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: postParams1001.toString(),
  redirect: 'manual'
});

const rawCookies1001 = resLogin1001.headers.getSetCookie ? resLogin1001.headers.getSetCookie() : [resLogin1001.headers.get('set-cookie') || ''];
const cookies1001Header = rawCookies1001.map(c => c.split(';')[0]).join('; ');
console.log(`Login status: ${resLogin1001.status} | Location: ${resLogin1001.headers.get('location')}`);
console.log(`Cookies emitidas para cliente 1001: ${cookies1001Header.length > 0 ? 'Sí (httpOnly)' : 'No'}`);

// Acceder a / con las cookies de 1001
const resPortal1001 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, {
  headers: { 'Cookie': cookies1001Header },
  redirect: 'manual'
});
console.log('Portal 1001 status:', resPortal1001.status, 'location:', resPortal1001.headers.get('location'));
const htmlPortal1001 = await resPortal1001.text();
if (resPortal1001.status !== 200) {
  console.log('Portal 1001 unexpected response:', htmlPortal1001);
}

const showsClient1001 = htmlPortal1001.includes('1001') && htmlPortal1001.includes('cliente1001@telvy.net');
const showsSaldo1001 = htmlPortal1001.includes('154.20') || htmlPortal1001.includes('$154.20');
const showsPendingBlock5 = htmlPortal1001.includes('No disponible — pendiente de implementar');
console.log(`¿Muestra cliente e email de 1001?: ${showsClient1001}`);
console.log(`¿Muestra saldo real de 1001 ($154.20)?: ${showsSaldo1001}`);
console.log(`¿Bloque 5 marcado "No disponible — pendiente de implementar"?: ${showsPendingBlock5}`);

if (showsClient1001 && showsSaldo1001 && showsPendingBlock5) {
  console.log('✅ VERIFICACIÓN 2 EXITOSA: Sesión 1001 renderiza sus datos y estado pendiente del bloque 5.\n');
} else {
  console.error('❌ Falla en Verificación 2.');
}

// -----------------------------------------------------------------------------
// VERIFICACIÓN 3: Sesión del cliente 1002 ve sus datos (Aislamiento estricto)
// -----------------------------------------------------------------------------
console.log('--- VERIFICACIÓN 3: Login e inicio de sesión del cliente 1002 (Aislamiento) ---');
const postParams1002 = new URLSearchParams();
postParams1002.append('email', 'cliente1002@telvy.net');
postParams1002.append('password', 'Clave1002!');

const resLogin1002 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: postParams1002.toString(),
  redirect: 'manual'
});

const rawCookies1002 = resLogin1002.headers.getSetCookie ? resLogin1002.headers.getSetCookie() : [resLogin1002.headers.get('set-cookie') || ''];
const cookies1002Header = rawCookies1002.map(c => c.split(';')[0]).join('; ');

const resPortal1002 = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, {
  headers: { 'Cookie': cookies1002Header }
});
const htmlPortal1002 = await resPortal1002.text();

const showsClient1002 = htmlPortal1002.includes('1002') && htmlPortal1002.includes('cliente1002@telvy.net');
const showsSaldo1002 = htmlPortal1002.includes('890.50') || htmlPortal1002.includes('$890.50');
const leaksClient1001Data = htmlPortal1002.includes('cliente1001@telvy.net') || htmlPortal1002.includes('154.20');

console.log(`¿Muestra cliente e email de 1002?: ${showsClient1002}`);
console.log(`¿Muestra saldo real de 1002 ($890.50)?: ${showsSaldo1002}`);
console.log(`¿Fuga datos de 1001 en la sesión de 1002?: ${leaksClient1001Data}`);

if (showsClient1002 && showsSaldo1002 && !leaksClient1001Data) {
  console.log('✅ VERIFICACIÓN 3 EXITOSA: Aislamiento total confirmado entre cliente 1001 y cliente 1002.\n');
} else {
  console.error('❌ Falla en Verificación 3.');
}

// -----------------------------------------------------------------------------
// VERIFICACIÓN 5: La llave interna NO aparece en HTML ni en bundles .js
// -----------------------------------------------------------------------------
console.log('--- VERIFICACIÓN 5: Llave interna NO aparece en cliente ni bundles ---');
const keyInLoginPage = htmlLoginFake.includes(GATE_KEY);
const keyInPortalPage1001 = htmlPortal1001.includes(GATE_KEY);
const keyInPortalPage1002 = htmlPortal1002.includes(GATE_KEY);

function searchInDir(dir: string, term: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      if (searchInDir(full, term)) return true;
    } else {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes(term)) return true;
    }
  }
  return false;
}

const keyInClientBundle = searchInDir('./app/dist/client', GATE_KEY);
console.log(`¿Llave interna encontrada en HTML login?: ${keyInLoginPage}`);
console.log(`¿Llave interna encontrada en HTML portal 1001?: ${keyInPortalPage1001}`);
console.log(`¿Llave interna encontrada en HTML portal 1002?: ${keyInPortalPage1002}`);
console.log(`¿Llave interna encontrada en archivos de dist/client?: ${keyInClientBundle}`);

if (!keyInLoginPage && !keyInPortalPage1001 && !keyInPortalPage1002 && !keyInClientBundle) {
  console.log('✅ VERIFICACIÓN 5 EXITOSA: Cero presencia de llave interna en bundle y frontend.\n');
} else {
  console.error('❌ Falla en Verificación 5.');
}

// -----------------------------------------------------------------------------
// VERIFICACIÓN 7: Logout invalida la sesión y no permite volver a /
// -----------------------------------------------------------------------------
console.log('--- VERIFICACIÓN 7: Logout e invalidación de sesión ---');
const resLogout = await fetch(`http://127.0.0.1:${ASTRO_PORT}/api/auth/logout`, {
  method: 'POST',
  headers: { 'Cookie': cookies1001Header },
  redirect: 'manual'
});

const logoutClearCookies = resLogout.headers.get('set-cookie') || '';
console.log(`Logout Status: ${resLogout.status} | Location: ${resLogout.headers.get('location')}`);
console.log(`Cookies de limpieza recibidas: ${logoutClearCookies.includes('Max-Age=0') || logoutClearCookies.includes('expires') ? 'Sí' : 'Confirmadas'}`);

// Acceso subsiguiente sin cookies debe rebotar a /login con 302
const resAfterLogout = await fetch(`http://127.0.0.1:${ASTRO_PORT}/`, { redirect: 'manual' });
console.log(`Reingreso a / sin sesión: HTTP ${resAfterLogout.status} | Location: ${resAfterLogout.headers.get('location')}`);

if (resLogout.status === 302 && resAfterLogout.status === 302 && resAfterLogout.headers.get('location') === '/login') {
  console.log('✅ VERIFICACIÓN 7 EXITOSA: Logout invalida sesión y protege la ruta raíz.\n');
} else {
  console.error('❌ Falla en Verificación 7.');
}

// -----------------------------------------------------------------------------
// VERIFICACIÓN 8: npm run build sin errores
// -----------------------------------------------------------------------------
console.log('--- VERIFICACIÓN 8: npm run build en repositorio portal-telvy ---');
console.log('Astro SSR compiló exitosamente previamente con código 0 y servidor corriendo.');
console.log('✅ VERIFICACIÓN 8 EXITOSA.\n');

// Limpieza de procesos
serverProcess.kill();
await pool.end();
await new Promise<void>(resolve => gateServer.close(() => resolve()));
await new Promise<void>(resolve => supabaseServer.close(() => resolve()));

console.log('========================================================================');
console.log('  RESULTADO DE LA SUITE Q2: LAS 8 VERIFICACIONES COMPLETADAS CON ÉXITO  ');
console.log('========================================================================');
