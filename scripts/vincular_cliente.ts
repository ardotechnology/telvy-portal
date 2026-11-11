#!/usr/bin/env node
/**
 * Script de Operador — Vinculación de Cuenta de Cliente en Supabase Auth y portal_cuenta_usuario
 * Uso:
 *   node --env-file=.env scripts/vincular_cliente.ts --cliente 1001 --email cliente1001@telvy.net [--password Secreto123!]
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('[Error Operador] SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias en .env');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function parseArgs() {
  const args = process.argv.slice(2);
  let cliente = '1001';
  let email = 'cliente1001@telvy.net';
  let password = '';
  let estado = 'activa';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cliente' && args[i + 1]) {
      cliente = args[++i];
    } else if (args[i] === '--email' && args[i + 1]) {
      email = args[++i];
    } else if (args[i] === '--password' && args[i + 1]) {
      password = args[++i];
    } else if (args[i] === '--estado' && args[i + 1]) {
      estado = args[++i];
    }
  }

  return { cliente, email, password, estado };
}

async function main() {
  const { cliente, email, password, estado } = parseArgs();
  console.log(`[Operador] Vinculando cliente '${cliente}' con email '${email}' (estado: ${estado})...`);

  // 1. Buscar si el usuario ya existe en auth.users
  const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('[Error Operador] Error listando usuarios de Auth:', listError.message);
    process.exit(1);
  }

  let authUser = usersData.users.find(u => u.email?.toLowerCase() === email.toLowerCase());

  if (!authUser) {
    if (password) {
      console.log(`[Operador] Creando usuario en Supabase Auth con confirmación de correo automática...`);
      const { data: createData, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { cliente }
      });
      if (createError) {
        console.error('[Error Operador] Falla al crear usuario en Auth:', createError.message);
        process.exit(1);
      }
      authUser = createData.user;
    } else {
      console.log(`[Operador] Enviando invitación de registro por correo (inviteUserByEmail)...`);
      const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
        data: { cliente }
      });
      if (inviteError) {
        console.error('[Error Operador] Falla al enviar invitación:', inviteError.message);
        process.exit(1);
      }
      authUser = inviteData.user;
    }
  } else {
    console.log(`[Operador] Usuario ya existente en Auth: ${authUser.id}`);
    if (password) {
      console.log(`[Operador] Actualizando contraseña de acceso para usuario existente...`);
      await supabase.auth.admin.updateUserById(authUser.id, {
        password,
        email_confirm: true
      });
    }
  }

  // 2. Insertar o actualizar en portal_cuenta_usuario
  const { data: cuentaData, error: dbError } = await supabase
    .from('portal_cuenta_usuario')
    .upsert(
      {
        auth_user_id: authUser.id,
        cliente,
        email,
        estado,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'auth_user_id' }
    )
    .select()
    .single();

  if (dbError) {
    console.error('[Error Operador] Falla al persistir en portal_cuenta_usuario:', dbError.message);
    process.exit(1);
  }

  console.log('\n✅ VINCULACIÓN EXITOSA:');
  console.log(`   Auth User ID : ${authUser.id}`);
  console.log(`   Cliente Telvy: ${cuentaData.cliente}`);
  console.log(`   Email        : ${cuentaData.email}`);
  console.log(`   Estado       : ${cuentaData.estado}`);
}

main().catch(err => {
  console.error('[Error Fatal Operador]', err);
  process.exit(1);
});
