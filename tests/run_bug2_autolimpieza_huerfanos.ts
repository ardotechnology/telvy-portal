import assert from 'node:assert/strict';
import {
  createSupabaseUserWithConfirmation,
  limpiarUsuarioAuthHuerfanoSiNoTieneCuenta
} from '../app/src/lib/supabase_admin.ts';

console.log('=======================================================================');
console.log('  VERIFICACIÓN BUG 2 — AUTOLIMPIEZA DE HUÉRFANOS (supabase_admin.ts)   ');
console.log('=======================================================================\n');

const COLUMNAS_REALES_PORTAL_CUENTA = new Set([
  'auth_user_id',
  'cliente',
  'email',
  'estado',
  'created_at',
  'updated_at'
]);

function validarSelectColumnasReales(cols: string) {
  const lista = cols.split(',').map((c) => c.trim()).filter(Boolean);
  for (const col of lista) {
    if (!COLUMNAS_REALES_PORTAL_CUENTA.has(col)) {
      return {
        message: `column portal_cuenta_usuario.${col} does not exist`,
        code: '42703'
      };
    }
  }
  return null;
}

function makeFakeSupabase(opts: {
  cuentas: Array<{ auth_user_id: string; cliente: string; email: string; estado: string }>;
  authUsers: Array<{ id: string; email: string }>;
  forzarFalloSelect?: string;
  forzarExcepcionSelect?: boolean;
  forzarFalloDeleteUser?: string;
}) {
  const cuentas = opts.cuentas.map((c) => ({ ...c }));
  const authUsers = opts.authUsers.map((u) => ({ ...u }));
  const deletedAuthIds: string[] = [];
  const deletedCuentaIds: string[] = [];
  const selectQueries: string[] = [];
  let seq = 100;

  const client = {
    from(table: string) {
      assert.equal(table, 'portal_cuenta_usuario');
      return {
        select(cols: string) {
          selectQueries.push(cols);
          let emailFilter = '';
          let estadoFilter: string | null = null;
          const chain = {
            ilike(col: string, val: string) {
              assert.equal(col, 'email');
              emailFilter = val.toLowerCase();
              return chain;
            },
            eq(col: string, val: string) {
              assert.equal(col, 'estado');
              estadoFilter = val;
              return chain;
            },
            async limit(_n: number) {
              if (opts.forzarExcepcionSelect) {
                throw new Error('conexion_bd_caida_simulada');
              }
              if (opts.forzarFalloSelect) {
                return { data: null, error: { message: opts.forzarFalloSelect } };
              }
              const colErr = validarSelectColumnasReales(cols);
              if (colErr) {
                return { data: null, error: colErr };
              }
              const matches = cuentas.filter(
                (c) =>
                  c.email.toLowerCase() === emailFilter &&
                  (estadoFilter === null || c.estado === estadoFilter)
              );
              return { data: matches.slice(0, _n), error: null };
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
            return {
              data: { user: null },
              error: { message: 'User already registered', status: 422 }
            };
          }
          const created = { id: `new-auth-${++seq}`, email: emailNorm };
          authUsers.push(created);
          return { data: { user: created }, error: null };
        },
        async listUsers(_opts: { page: number; perPage: number }) {
          return { data: { users: [...authUsers] }, error: null };
        },
        async deleteUser(id: string) {
          if (opts.forzarFalloDeleteUser) {
            return { data: {}, error: { message: opts.forzarFalloDeleteUser } };
          }
          deletedAuthIds.push(id);
          const idx = authUsers.findIndex((u) => u.id === id);
          if (idx >= 0) authUsers.splice(idx, 1);
          return { data: {}, error: null };
        }
      },
      async resend(_input: any) {
        return { data: {}, error: null };
      }
    }
  };

  return { client: client as any, deletedAuthIds, deletedCuentaIds, selectQueries, cuentas, authUsers };
}

const erroresLogueados: string[] = [];
const origConsoleError = console.error;
console.error = (...args: any[]) => {
  erroresLogueados.push(args.map((a) => String(a)).join(' '));
};

try {
  // Caso 1: Huérfano SIN fila en portal_cuenta_usuario -> se limpia el usuario Auth y el alta completa (201)
  {
    const fake = makeFakeSupabase({
      cuentas: [
        { auth_user_id: 'otro-activo-1', cliente: 'cli_a', email: 'otro1@telvy.test', estado: 'activa' },
        { auth_user_id: 'otro-susp-1', cliente: 'cli_s', email: 'susp@telvy.test', estado: 'suspendida' }
      ],
      authUsers: [
        { id: 'otro-activo-1', email: 'otro1@telvy.test' },
        { id: 'otro-susp-1', email: 'susp@telvy.test' },
        { id: 'huerfano-sin-fila', email: 'huerfano@telvy.test' }
      ]
    });

    const cuentasAntes = fake.cuentas.length;
    const authAntes = fake.authUsers.length;

    const res = await createSupabaseUserWithConfirmation({
      email: 'huerfano@telvy.test',
      password: 'Password123!',
      nombre: 'Huérfano Sin Fila',
      telefono: '8110000099',
      supabaseClient: fake.client
    });

    assert.equal(res.ok, true, 'El huérfano sin fila debe limpiarse y completar el alta');
    assert.equal(res.status, 201);
    assert.ok(res.userId && res.userId !== 'huerfano-sin-fila');
    assert.deepEqual(fake.deletedAuthIds, ['huerfano-sin-fila']);
    assert.deepEqual(fake.deletedCuentaIds, [], 'No debe ejecutar borrados en portal_cuenta_usuario');
    assert.equal(fake.cuentas.length, cuentasAntes, 'El conteo de filas en portal_cuenta_usuario no cambia');
    assert.equal(fake.authUsers.length, authAntes, 'Conteo de Auth: 1 huérfano borrado + 1 nuevo creado');
    assert.equal(fake.selectQueries[0], 'auth_user_id, cliente, estado');
    console.log('✅ Caso 1 (huérfano SIN fila): se limpia y el alta completa (201), 0 filas ajenas tocadas');
  }

  // Caso 2: Cuenta ACTIVA con extensión viva en el motor -> 409 con mensaje actual y 0 borrados
  {
    const fake = makeFakeSupabase({
      cuentas: [
        { auth_user_id: 'real-1', cliente: 'cli_real', email: 'real@telvy.test', estado: 'activa' }
      ],
      authUsers: [{ id: 'real-1', email: 'real@telvy.test' }]
    });

    const cuentasAntes = fake.cuentas.length;
    const authAntes = fake.authUsers.length;
    const motorConExtension: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          cliente: 'cli_real',
          id_user: 10,
          extensiones: [{ id: 1, name: 'cli_real101', status: 1, activo: true, online: true }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as any;

    const res = await createSupabaseUserWithConfirmation({
      email: 'real@telvy.test',
      password: 'Password123!',
      nombre: 'Cliente Real',
      telefono: '8110000001',
      supabaseClient: fake.client,
      gateUrl: 'http://motor.test:4100',
      internalKey: 'internal-test-key',
      fetcher: motorConExtension
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409);
    assert.equal(res.error, 'Este correo ya tiene cuenta, inicia sesión');
    assert.deepEqual(fake.deletedAuthIds, []);
    assert.deepEqual(fake.deletedCuentaIds, []);
    assert.equal(fake.cuentas.length, cuentasAntes);
    assert.equal(fake.authUsers.length, authAntes);
    console.log('✅ Caso 2 (cuenta ACTIVA con extensión en motor): 409 con mensaje actual y cero borrados');
  }

  // Caso 2b: Cuenta ACTIVA pero el motor no responde -> 502 con motivo real y 0 borrados (nunca a ciegas)
  {
    erroresLogueados.length = 0;
    const fake = makeFakeSupabase({
      cuentas: [
        { auth_user_id: 'real-down', cliente: 'cli_down', email: 'motordown@telvy.test', estado: 'activa' }
      ],
      authUsers: [{ id: 'real-down', email: 'motordown@telvy.test' }]
    });

    const cuentasAntes = fake.cuentas.length;
    const authAntes = fake.authUsers.length;
    const motorCaido: typeof fetch = (async () => {
      throw new Error('ECONNREFUSED motor no responde');
    }) as any;

    const res = await createSupabaseUserWithConfirmation({
      email: 'motordown@telvy.test',
      password: 'Password123!',
      nombre: 'Cliente Motor Caído',
      telefono: '8110000009',
      supabaseClient: fake.client,
      gateUrl: 'http://motor.test:4100',
      internalKey: 'internal-test-key',
      fetcher: motorCaido
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 502, 'Cuando el motor no responde debe devolver 502');
    assert.ok(res.error && res.error.includes('ECONNREFUSED'), `Debe reportar el motivo real (recibido: ${res.error})`);
    assert.ok(!res.error?.includes('inicia sesión'));
    assert.deepEqual(fake.deletedAuthIds, []);
    assert.deepEqual(fake.deletedCuentaIds, []);
    assert.equal(fake.cuentas.length, cuentasAntes);
    assert.equal(fake.authUsers.length, authAntes);
    assert.ok(erroresLogueados.some((l) => l.includes('ECONNREFUSED')));
    console.log('✅ Caso 2b (motor caído): 502 con motivo real y cero borrados');
  }

  // Caso 3: Fila con estado = 'suspendida' -> 409 nombrando el estado, y conteo de filas y usuarios Auth NO cambia
  {
    const fake = makeFakeSupabase({
      cuentas: [
        { auth_user_id: 'otro-activo-1', cliente: 'cli_a', email: 'otro1@telvy.test', estado: 'activa' },
        { auth_user_id: 'susp-1', cliente: 'cli_susp', email: 'suspendida@telvy.test', estado: 'suspendida' }
      ],
      authUsers: [
        { id: 'otro-activo-1', email: 'otro1@telvy.test' },
        { id: 'susp-1', email: 'suspendida@telvy.test' }
      ]
    });

    const cuentasAntes = fake.cuentas.length;
    const authAntes = fake.authUsers.length;

    const res = await createSupabaseUserWithConfirmation({
      email: 'suspendida@telvy.test',
      password: 'Password123!',
      nombre: 'Cliente Suspendido',
      telefono: '8110000005',
      supabaseClient: fake.client
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, 409, 'Cuenta suspendida debe devolver 409, nunca 502');
    assert.ok(
      res.error && res.error.includes('suspendida'),
      `El mensaje debe nombrar el estado real (recibido: ${res.error})`
    );
    assert.deepEqual(fake.deletedAuthIds, [], 'NO debe borrar el usuario de Auth');
    assert.deepEqual(fake.deletedCuentaIds, [], 'NO debe borrar la fila de portal_cuenta_usuario');
    assert.equal(fake.cuentas.length, cuentasAntes, 'Conteo de filas NO cambia');
    assert.equal(fake.authUsers.length, authAntes, 'Conteo de usuarios Auth NO cambia');
    console.log(`✅ Caso 3 (fila estado = 'suspendida'): 409 nombrando estado ("${res.error}"), 0 borrados y conteos intactos`);
  }

  // Caso 4: Fallo real de limpieza -> 502 con el motivo, nunca 409 ni 'inicia sesión'
  {
    erroresLogueados.length = 0;
    const fakeErr = makeFakeSupabase({
      cuentas: [
        { auth_user_id: 'otro-activo-1', cliente: 'cli_a', email: 'otro1@telvy.test', estado: 'activa' }
      ],
      authUsers: [
        { id: 'otro-activo-1', email: 'otro1@telvy.test' },
        { id: 'u-err', email: 'fallo@telvy.test' }
      ],
      forzarFalloSelect: 'timeout_postgres_simulado'
    });

    const cuentasAntes = fakeErr.cuentas.length;
    const authAntes = fakeErr.authUsers.length;

    const resErr = await createSupabaseUserWithConfirmation({
      email: 'fallo@telvy.test',
      password: 'Password123!',
      nombre: 'Prueba Fallo Select',
      telefono: '8110000002',
      supabaseClient: fakeErr.client
    });

    assert.equal(resErr.ok, false);
    assert.equal(resErr.status, 502);
    assert.ok(resErr.error && resErr.error.includes('timeout_postgres_simulado'));
    assert.ok(!resErr.error?.includes('inicia sesión'));
    assert.equal(fakeErr.cuentas.length, cuentasAntes);
    assert.equal(fakeErr.authUsers.length, authAntes);
    assert.ok(erroresLogueados.some((l) => l.includes('timeout_postgres_simulado')));

    // Excepción directa -> no lanza
    const fakeThrow = makeFakeSupabase({
      cuentas: [],
      authUsers: [{ id: 'u-throw', email: 'excepcion@telvy.test' }],
      forzarExcepcionSelect: true
    });
    const checkDirecto = await limpiarUsuarioAuthHuerfanoSiNoTieneCuenta(fakeThrow.client, 'excepcion@telvy.test');
    assert.equal(checkDirecto.tieneCuentaActiva, false);
    assert.equal(checkDirecto.huerfanoEliminado, false);
    assert.equal(checkDirecto.errorLimpieza, 'conexion_bd_caida_simulada');

    // Fallo en deleteUser -> 502 con motivo
    const fakeDelErr = makeFakeSupabase({
      cuentas: [],
      authUsers: [{ id: 'u-del-err', email: 'delerr@telvy.test' }],
      forzarFalloDeleteUser: 'auth_admin_delete_denied'
    });
    const resDelErr = await createSupabaseUserWithConfirmation({
      email: 'delerr@telvy.test',
      password: 'Password123!',
      nombre: 'Prueba Fallo Delete',
      telefono: '8110000004',
      supabaseClient: fakeDelErr.client
    });
    assert.equal(resDelErr.ok, false);
    assert.equal(resDelErr.status, 502);
    assert.ok(resDelErr.error && resDelErr.error.includes('auth_admin_delete_denied'));
    assert.ok(!resDelErr.error?.includes('inicia sesión'));

    console.log('✅ Caso 4 (fallo real de limpieza): 502 con el motivo real, nunca 409 ni "inicia sesión"');
  }

  console.log('\n🎉 TODAS LAS VERIFICACIONES DEL APRETÓN AL BUG 2 PASARON.\n');
} finally {
  console.error = origConsoleError;
}
