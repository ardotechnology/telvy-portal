import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('=======================================================================');
console.log('  VERIFICACIÓN RUTA INTERNA — POST /api/interno/limpiar-cuenta         ');
console.log('=======================================================================\n');

const routePath = path.resolve(process.cwd(), 'app/src/pages/api/interno/limpiar-cuenta.ts');
const middlewarePath = path.resolve(process.cwd(), 'app/src/middleware.ts');

assert.ok(fs.existsSync(routePath), `La ruta interna no existe todavía: ${routePath}`);
const middlewareSrc = fs.readFileSync(middlewarePath, 'utf8');
assert.ok(
  middlewareSrc.includes("pathname.startsWith('/api/interno/')"),
  'middleware.ts debe excluir /api/interno/ de la autenticación de sesión de navegador'
);

const { POST } = await import('../app/src/pages/api/interno/limpiar-cuenta.ts');

function makeFakeSupabase(opts: {
  cuentas: Array<{ auth_user_id: string; cliente: string; email: string; estado: string }>;
  authUsers: Array<{ id: string; email: string }>;
}) {
  const cuentas = opts.cuentas.map((c) => ({ ...c }));
  const authUsers = opts.authUsers.map((u) => ({ ...u }));
  const deletedClientes: string[] = [];
  const deletedAuthIds: string[] = [];

  const client = {
    from(table: string) {
      assert.equal(table, 'portal_cuenta_usuario');
      return {
        select(_cols: string) {
          return {
            async eq(col: string, val: string) {
              assert.equal(col, 'cliente');
              const matched = cuentas.filter((c) => c.cliente === val);
              return { data: matched, error: null };
            }
          };
        },
        delete() {
          return {
            async eq(col: string, val: string) {
              assert.equal(col, 'cliente');
              deletedClientes.push(val);
              for (let i = cuentas.length - 1; i >= 0; i--) {
                if (cuentas[i].cliente === val) cuentas.splice(i, 1);
              }
              return { data: null, error: null };
            }
          };
        }
      };
    },
    auth: {
      admin: {
        async deleteUser(id: string) {
          deletedAuthIds.push(id);
          const idx = authUsers.findIndex((u) => u.id === id);
          if (idx >= 0) authUsers.splice(idx, 1);
          return { data: {}, error: null };
        }
      }
    }
  };

  return { client: client as any, cuentas, authUsers, deletedClientes, deletedAuthIds };
}

function makeRequest(body: Record<string, unknown>, authHeader?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  return new Request('http://127.0.0.1:3000/api/interno/limpiar-cuenta', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

process.env.SENTINEL_INTEGRACION_KEY = 'llave-secreta-integracion-test';

// a) Sin llave -> 401, cero borrados
{
  const fake = makeFakeSupabase({
    cuentas: [{ auth_user_id: 'auth-1163', cliente: '1163', email: 'c1163@telvy.test', estado: 'activa' }],
    authUsers: [{ id: 'auth-1163', email: 'c1163@telvy.test' }]
  });
  const res = await POST({
    request: makeRequest({ cliente_username: '1163' }),
    locals: { supabaseAdminOverride: fake.client }
  } as any);
  const data = await res.json();
  assert.equal(res.status, 401, 'Sin llave debe devolver 401');
  assert.equal(data.ok, false);
  assert.ok(data.error);
  assert.deepEqual(fake.deletedClientes, []);
  assert.deepEqual(fake.deletedAuthIds, []);
  assert.equal(fake.cuentas.length, 1);
  assert.equal(fake.authUsers.length, 1);
  console.log('✅ a) sin llave -> 401, cero borrados');
}

// b) Con llave y cliente con cuenta -> borra la fila y el usuario de Auth, y responde el resumen
{
  const fake = makeFakeSupabase({
    cuentas: [
      { auth_user_id: 'auth-1001', cliente: '1001', email: 'otro@telvy.test', estado: 'activa' },
      { auth_user_id: 'auth-1163', cliente: '1163', email: 'c1163@telvy.test', estado: 'activa' }
    ],
    authUsers: [
      { id: 'auth-1001', email: 'otro@telvy.test' },
      { id: 'auth-1163', email: 'c1163@telvy.test' }
    ]
  });
  const res = await POST({
    request: makeRequest({ cliente_username: '1163' }, 'Bearer llave-secreta-integracion-test'),
    locals: { supabaseAdminOverride: fake.client }
  } as any);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.cliente, '1163');
  assert.equal(data.filas_borradas, 1);
  assert.deepEqual(data.auth_user_ids_borrados, ['auth-1163']);
  assert.equal(fake.cuentas.length, 1, 'No debe borrar cuentas ajenas');
  assert.equal(fake.cuentas[0].cliente, '1001');
  assert.equal(fake.authUsers.length, 1);
  assert.equal(fake.authUsers[0].id, 'auth-1001');
  console.log(`✅ b) con llave y cliente con cuenta -> borra fila y Auth, resumen: ${JSON.stringify(data)}`);
}

// c) Con llave y cliente sin cuenta -> ok, cero borrados (idempotente)
{
  const fake = makeFakeSupabase({
    cuentas: [{ auth_user_id: 'auth-1001', cliente: '1001', email: 'otro@telvy.test', estado: 'activa' }],
    authUsers: [{ id: 'auth-1001', email: 'otro@telvy.test' }]
  });
  const res = await POST({
    request: makeRequest({ cliente_username: '9999' }, 'Bearer llave-secreta-integracion-test'),
    locals: { supabaseAdminOverride: fake.client }
  } as any);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.cliente, '9999');
  assert.equal(data.filas_borradas, 0);
  assert.deepEqual(data.auth_user_ids_borrados, []);
  assert.deepEqual(fake.deletedClientes, []);
  assert.deepEqual(fake.deletedAuthIds, []);
  assert.equal(fake.cuentas.length, 1);
  console.log(`✅ c) con llave y cliente sin cuenta -> 200 idempotente, cero borrados: ${JSON.stringify(data)}`);
}

// d) Con llave y sin cliente -> 400, cero borrados
{
  const fake = makeFakeSupabase({
    cuentas: [{ auth_user_id: 'auth-1001', cliente: '1001', email: 'otro@telvy.test', estado: 'activa' }],
    authUsers: [{ id: 'auth-1001', email: 'otro@telvy.test' }]
  });
  const res = await POST({
    request: makeRequest({}, 'Bearer llave-secreta-integracion-test'),
    locals: { supabaseAdminOverride: fake.client }
  } as any);
  const data = await res.json();
  assert.equal(res.status, 400, 'Sin cliente_username debe devolver 400');
  assert.equal(data.ok, false);
  assert.ok(data.error);
  assert.deepEqual(fake.deletedClientes, []);
  assert.deepEqual(fake.deletedAuthIds, []);
  console.log('✅ d) con llave y sin cliente -> 400, cero borrados');
}

console.log('\n🎉 TODOS LOS CASOS (a, b, c, d) DE LA RUTA INTERNA PASARON.\n');
