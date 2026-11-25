import assert from 'node:assert/strict';
import {
  createSupabaseUserWithConfirmation,
  limpiarUsuarioAuthHuerfanoSiNoTieneCuenta
} from '../app/src/lib/supabase_admin.ts';

console.log('=======================================================================');
console.log('  VERIFICACIÓN AUTOLIMPIEZA — CLIENTE DADO DE BAJA VS VIVO/SUSPENDIDO  ');
console.log('=======================================================================\n');

function makeFakeSupabase(opts: {
  cuentas: Array<{ auth_user_id: string; cliente: string; email: string; estado: string }>;
  authUsers: Array<{ id: string; email: string }>;
}) {
  const cuentas = opts.cuentas.map((c) => ({ ...c }));
  const authUsers = opts.authUsers.map((u) => ({ ...u }));
  const deletedAuthIds: string[] = [];
  const deletedCuentaIds: string[] = [];
  let seq = 500;

  const client = {
    from(table: string) {
      assert.equal(table, 'portal_cuenta_usuario');
      return {
        select(_cols: string) {
          let emailFilter = '';
          const chain = {
            ilike(col: string, val: string) {
              assert.equal(col, 'email');
              emailFilter = val.toLowerCase();
              return chain;
            },
            async limit(n: number) {
              const matches = cuentas.filter((c) => c.email.toLowerCase() === emailFilter);
              return { data: matches.slice(0, n), error: null };
            }
          };
          return chain;
        },
        delete() {
          return {
            async eq(col: string, val: string) {
              assert.equal(col, 'auth_user_id');
              deletedCuentaIds.push(val);
              const idx = cuentas.findIndex((c) => c.auth_user_id === val);
              if (idx >= 0) cuentas.splice(idx, 1);
              return { data: null, error: null };
            }
          };
        }
      };
    },
    auth: {
      admin: {
        async createUser(input: { email: string }) {
          const emailNorm = input.email.trim().toLowerCase();
          const exists = authUsers.some((u) => u.email.toLowerCase() === emailNorm);
          if (exists) {
            return { data: { user: null }, error: { message: 'User already registered', status: 422 } };
          }
          const created = { id: `new-auth-${++seq}`, email: emailNorm };
          authUsers.push(created);
          return { data: { user: created }, error: null };
        },
        async listUsers() {
          return { data: { users: [...authUsers] }, error: null };
        },
        async deleteUser(id: string) {
          deletedAuthIds.push(id);
          const idx = authUsers.findIndex((u) => u.id === id);
          if (idx >= 0) authUsers.splice(idx, 1);
          return { data: {}, error: null };
        }
      },
      async resend() {
        return { data: {}, error: null };
      }
    }
  };

  return { client: client as any, cuentas, authUsers, deletedAuthIds, deletedCuentaIds };
}

function makeMotorFetcher(handler: (url: string, headers: Record<string, string>) => Promise<Response>) {
  const calls: Array<{ url: string; cliente: string; internalKey: string }> = [];
  const fetcher: typeof fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const hdrs: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers)) {
        hdrs[k.toLowerCase()] = String(v);
      }
    }
    calls.push({
      url,
      cliente: hdrs['x-authenticated-client'] || '',
      internalKey: hdrs['x-internal-key'] || ''
    });
    return handler(url, hdrs);
  }) as any;
  return { fetcher, calls };
}

process.env.TELVY_GATE_URL = 'http://motor.test:4100';
process.env.CLIENT_API_INTERNAL_KEY = 'internal-test-key';

let fallos = 0;
async function runCase(nombre: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${nombre}`);
  } catch (err: any) {
    fallos++;
    console.error(`❌ ${nombre}\n   -> ${err?.message || err}`);
  }
}

// Caso a) Cliente vivo con extensión -> NO borra nada (comportamiento actual intacto)
await runCase('a) cliente vivo con extensión -> NO borra nada (409)', async () => {
  const fake = makeFakeSupabase({
    cuentas: [{ auth_user_id: 'auth-vivo', cliente: '1101', email: 'vivo@telvy.test', estado: 'activa' }],
    authUsers: [{ id: 'auth-vivo', email: 'vivo@telvy.test' }]
  });
  const motor = makeMotorFetcher(async (url) => {
    assert.ok(url.endsWith('/v1/cliente/extensiones'), `Debe consultar /v1/cliente/extensiones (recibido: ${url})`);
    return new Response(
      JSON.stringify({
        ok: true,
        cliente: '1101',
        id_user: 101,
        extensiones: [{ id: 1, name: '1101101', status: 1, activo: true, online: true }]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const res = await (createSupabaseUserWithConfirmation as any)({
    email: 'vivo@telvy.test',
    password: 'Password123!',
    nombre: 'Cliente Vivo',
    telefono: '8110000001',
    supabaseClient: fake.client,
    fetcher: motor.fetcher
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(res.error, 'Este correo ya tiene cuenta, inicia sesión');
  assert.equal(motor.calls.length, 1, 'Debe consultar al motor');
  assert.equal(motor.calls[0].cliente, '1101');
  assert.deepEqual(fake.deletedCuentaIds, []);
  assert.deepEqual(fake.deletedAuthIds, []);
  assert.equal(fake.cuentas.length, 1);
  assert.equal(fake.authUsers.length, 1);
});

// Caso b) Cliente SUSPENDIDO (active = 0 en conmutador, pero extensión viva) -> NO borra nada
await runCase('b) cliente SUSPENDIDO (active 0, extensión viva) -> NO borra nada (409)', async () => {
  const fake = makeFakeSupabase({
    cuentas: [{ auth_user_id: 'auth-susp', cliente: '1102', email: 'suspendido@telvy.test', estado: 'activa' }],
    authUsers: [{ id: 'auth-susp', email: 'suspendido@telvy.test' }]
  });
  const motor = makeMotorFetcher(async () =>
    new Response(
      JSON.stringify({
        ok: true,
        cliente: '1102',
        id_user: 102,
        active: 0, // suspendido en pkg_user, pero su extensión sigue existiendo
        extensiones: [{ id: 2, name: '1102101', status: 1, activo: true, online: false }]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  );

  const res = await (createSupabaseUserWithConfirmation as any)({
    email: 'suspendido@telvy.test',
    password: 'Password123!',
    nombre: 'Cliente Suspendido',
    telefono: '8110000002',
    supabaseClient: fake.client,
    fetcher: motor.fetcher
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 409, 'Cliente suspendido con extensión viva NO se borra');
  assert.equal(motor.calls.length, 1);
  assert.deepEqual(fake.deletedCuentaIds, []);
  assert.deepEqual(fake.deletedAuthIds, []);
  assert.equal(fake.cuentas.length, 1);
  assert.equal(fake.authUsers.length, 1);
});

// Caso c) Cliente dado de baja (sin extensión: 200 con extensiones: [] como cliente 1163) -> borra fila del portal y Auth, y completa el alta (201)
await runCase('c) cliente dado de baja (sin extensión) -> borra fila del portal y usuario de Auth y permite alta (201)', async () => {
  const fake = makeFakeSupabase({
    cuentas: [
      { auth_user_id: 'auth-ajeno', cliente: '1001', email: 'otro@telvy.test', estado: 'activa' },
      { auth_user_id: 'auth-1163', cliente: '1163', email: 'ardo.international.llc@gmail.com', estado: 'activa' }
    ],
    authUsers: [
      { id: 'auth-ajeno', email: 'otro@telvy.test' },
      { id: 'auth-1163', email: 'ardo.international.llc@gmail.com' }
    ]
  });
  const motor = makeMotorFetcher(async () =>
    new Response(
      JSON.stringify({
        ok: true,
        cliente: '1163',
        id_user: 89,
        extensiones: []
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  );

  const res = await (createSupabaseUserWithConfirmation as any)({
    email: 'ardo.international.llc@gmail.com',
    password: 'Password123!',
    nombre: 'Cliente 1163 Nuevo',
    telefono: '8110001163',
    supabaseClient: fake.client,
    fetcher: motor.fetcher
  });

  assert.equal(res.ok, true, `Debe limpiar baja previa y permitir el alta (recibido: status=${res.status}, error=${res.error})`);
  assert.equal(res.status, 201);
  assert.ok(res.userId && res.userId !== 'auth-1163');
  assert.deepEqual(fake.deletedCuentaIds, ['auth-1163'], 'Debe borrar la fila de portal_cuenta_usuario del cliente dado de baja');
  assert.deepEqual(fake.deletedAuthIds, ['auth-1163'], 'Debe borrar el usuario de Auth del cliente dado de baja');
  assert.equal(fake.cuentas.length, 1, 'No debe tocar cuentas ajenas');
  assert.equal(fake.cuentas[0].auth_user_id, 'auth-ajeno');
});

// Caso d) Motor no responde -> NO borra nada y reporta el motivo (502, nunca a ciegas)
await runCase('d) motor no responde -> NO borra nada y reporta el motivo', async () => {
  const fake = makeFakeSupabase({
    cuentas: [{ auth_user_id: 'auth-err', cliente: '1104', email: 'motordown@telvy.test', estado: 'activa' }],
    authUsers: [{ id: 'auth-err', email: 'motordown@telvy.test' }]
  });
  const motor = makeMotorFetcher(async () => {
    throw new Error('ECONNREFUSED motor caido');
  });

  const check = await (limpiarUsuarioAuthHuerfanoSiNoTieneCuenta as any)(
    fake.client,
    'motordown@telvy.test',
    { fetcher: motor.fetcher }
  );
  assert.equal(check.huerfanoEliminado, false, 'Nunca debe borrar si el motor no responde');
  assert.equal(check.tieneCuentaActiva, false, 'No debe mentir que la cuenta está verificada');
  assert.ok(
    check.errorLimpieza && check.errorLimpieza.includes('ECONNREFUSED'),
    `Debe reportar el motivo real del fallo del motor (recibido: ${check.errorLimpieza})`
  );
  assert.deepEqual(fake.deletedCuentaIds, []);
  assert.deepEqual(fake.deletedAuthIds, []);

  const res = await (createSupabaseUserWithConfirmation as any)({
    email: 'motordown@telvy.test',
    password: 'Password123!',
    nombre: 'Motor Caido',
    telefono: '8110000004',
    supabaseClient: fake.client,
    fetcher: motor.fetcher
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 502, 'Con motor caído debe reportar 502 con el motivo, no 409');
  assert.ok(res.error && res.error.includes('ECONNREFUSED'));
  assert.deepEqual(fake.deletedCuentaIds, []);
  assert.deepEqual(fake.deletedAuthIds, []);
});

if (fallos > 0) {
  console.error(`\n❌ FALLARON ${fallos} CASO(S).`);
  process.exit(1);
}

console.log('\n🎉 TODOS LOS CASOS (a, b, c, d) PASARON.\n');
