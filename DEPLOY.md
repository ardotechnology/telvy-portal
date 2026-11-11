# Guía Operativa de Despliegue — Portal de Cliente Telvy

Esta guía documenta los pasos exactos y numerados para desplegar y actualizar el **Portal de Cliente de Telvy** en el servidor de producción `agroupweb` (`140.84.180.77`), utilizando Docker Compose, Caddy como reverse proxy TLS con certificados Cloudflare Origin, y **Supabase Auth** con **Row Level Security (RLS)** para control de acceso y multitenancy (Bloque Q2).

---

## Arquitectura del Bloque Q2 (Autenticación y Aislamiento)

```
[ Navegador / Internet ]
           │ HTTPS :443 (Cloudflare Full Strict)
           ▼
[ Host 140.84.180.77 ]
    ┌────────────────────────────────────────┐
    │ Caddy (Docker)                         │
    │  - Puertos host: 80, 443               │
    │  - Certificados: /etc/caddy/certs/     │
    │  - Proxy reverso: http://app:3000      │
    └──────────────────┬─────────────────────┘
                       │ Red interna Docker (Bridge)
                       ▼
    ┌────────────────────────────────────────┐
    │ App Astro SSR (portal-app)             │
    │  - Puerto interno: 3000 (sin exponer)  │
    │  - Sesiones: Cookies httpOnly (@supabase/ssr)
    │  - Middleware valida sesión y cuenta   │
    │  - Deriva 'cliente' desde DB (RLS)     │
    └──────────┬─────────────────┬───────────┘
               │                 │
    (Host Loopback)       (HTTPS Saliente)
               │                 │
               ▼                 ▼
    ┌────────────────────┐ ┌──────────────────────────────────────┐
    │ telvy-client-gate  │ │ Supabase Cloud (Telvy: mottolvjcmv...)│
    │ 127.0.0.1:4100     │ │  - auth.users (Autenticación)        │
    │ Header:            │ │  - public.portal_cuenta_usuario (RLS)│
    │ X-Internal-Key     │ └──────────────────────────────────────┘
    │ X-Auth-Client: ID  │
    └────────────────────┘
```

---

## Procedimiento de Despliegue — Bloque Q2

### Paso 1 — Ejecutar Migración SQL en Supabase
El portal utiliza el proyecto oficial de Supabase de Telvy (`mottolvjcmvvcohrvroe.supabase.co`).
NO utilizar el proyecto de Sentinel.

Abrir el **SQL Editor** del dashboard de Supabase (o conectarse vía `psql`) y ejecutar el archivo:
`supabase/migrations/20261111000000_portal_cuenta_usuario.sql`

Contenido a ejecutar:
```sql
-- 1. Tabla de vinculación de usuarios de Auth con clientes del conmutador
CREATE TABLE IF NOT EXISTS public.portal_cuenta_usuario (
    auth_user_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    cliente        TEXT NOT NULL,
    email          TEXT NOT NULL,
    estado         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'activa', 'suspendida')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT portal_cuenta_usuario_cliente_key UNIQUE (cliente)
);

-- 2. Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_portal_cuenta_usuario_cliente ON public.portal_cuenta_usuario(cliente);
CREATE INDEX IF NOT EXISTS idx_portal_cuenta_usuario_email ON public.portal_cuenta_usuario(email);

-- 3. Habilitar y forzar Row Level Security (RLS)
ALTER TABLE public.portal_cuenta_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_cuenta_usuario FORCE ROW LEVEL SECURITY;

-- 4. Política de lectura: El usuario autenticado SOLO puede leer su propia fila
DROP POLICY IF EXISTS "portal_cuenta_usuario_select_own" ON public.portal_cuenta_usuario;
CREATE POLICY "portal_cuenta_usuario_select_own"
    ON public.portal_cuenta_usuario
    FOR SELECT
    TO authenticated
    USING (auth.uid() = auth_user_id);

-- 5. Prohibición de escritura pública: No se crean políticas INSERT/UPDATE para 'authenticated' o 'anon'.
-- La mutación está reservada a 'service_role'.
```

---

### Paso 2 — Vincular el Cliente 1001 con el Script de Operador
En la máquina local o servidor con las credenciales de administración de Supabase:

```bash
cd /opt/portal-telvy # o en local

# Configurar variables temporales de operador
export SUPABASE_URL="https://mottolvjcmvvcohrvroe.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<SERVICE_ROLE_KEY_DE_TELVY>"

# Ejecutar vinculación enviando invitación por correo y creando registro en DB
npx tsx scripts/vincular_cliente.ts \
  --cliente=1001 \
  --email=cliente1001@telvy.net \
  --estado=activa
```
**Resultado esperado:**
```text
✅ Usuario autenticado en auth.users (ID: ...)
✅ Registro insertado en portal_cuenta_usuario: Cliente 1001 -> cliente1001@telvy.net [activa]
```

---

### Paso 3 — Actualizar el Código en `agroupweb`

En `root@agroupweb`:
```bash
cd /opt/portal-telvy
git pull origin main
```

---

### Paso 4 — Configurar Variables de Entorno en `/opt/portal-telvy/.env`

Asegurar que el archivo `.env` contenga la configuración requerida por Astro SSR para conectar con Supabase y la puerta del motor:

```bash
cd /opt/portal-telvy

# 1. Extraer la llave interna desde el .env del motor
GATE_KEY=$(grep '^CLIENT_API_INTERNAL_KEY=' /opt/analisis/telvy-voip-engine/.env | cut -d= -f2- | tr -d '\r"')

# 2. Generar .env
cat << EOF > .env
PORT=3000
HOST=0.0.0.0
CLIENT_API_INTERNAL_KEY=${GATE_KEY}
TELVY_GATE_URL=http://127.0.0.1:4100
SUPABASE_URL=https://mottolvjcmvvcohrvroe.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
EOF

chmod 600 .env
```

---

### Paso 5 — Recompilar y Levantar Contenedores

```bash
cd /opt/portal-telvy
docker compose up -d --build
docker compose ps
```
**Resultado esperado:**
```text
NAME           IMAGE                      STATUS         PORTS
portal-app     portal-telvy-app           Up ...         3000/tcp
portal-caddy   caddy:2-alpine             Up ...         0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

---

## Las Ocho Verificaciones de Aceptación (Bloque Q2)

1. **Redirección anónima:**
   ```bash
   curl -sI https://portal.telvy.net/ | grep -i "location:"
   ```
   *Esperado:* `Location: /login` con código HTTP 302.

2. **Acceso con sesión del cliente 1001:**
   Iniciar sesión con `cliente1001@telvy.net`. La pantalla muestra el cliente 1001 y su saldo real.

3. **Aislamiento de sesiones (cliente 1002):**
   Iniciar sesión con `cliente1002@telvy.net`. La pantalla muestra exclusivamente los datos de 1002 y jamás expone datos de 1001.

4. **Aislamiento RLS en base de datos:**
   Una consulta `SELECT` bajo el token de 1001 solo devuelve su fila; consultar la fila de 1002 devuelve 0 filas.

5. **Cero exposición de la llave interna (`CLIENT_API_INTERNAL_KEY`):**
   ```bash
   GATE_KEY=$(grep '^CLIENT_API_INTERNAL_KEY=' .env | cut -d= -f2-)
   curl -sL https://portal.telvy.net/login | grep "$GATE_KEY" && echo "FALLA" || echo "OK: Sin llave interna en HTML"
   docker compose exec app grep -rn "$GATE_KEY" dist/client/ 2>/dev/null && echo "FALLA" || echo "OK: Sin llave en JS bundle"
   ```

6. **Protección anti-enumeración en `/login`:**
   Intentar login con credenciales inválidas devuelve `Correo o contraseña incorrectos` sin revelar si el usuario existe.

7. **Logout seguro:**
   Pulsar "Cerrar sesión" limpia las cookies de sesión y redirige inmediatamente a `/login`. Los accesos posteriores a `/` rebotan a `/login`.

8. **Compilación limpia de Astro SSR:**
   `npm run build` en `app/` finaliza con código de salida `0`.

---

## Procedimiento de Rollback Inmediato

En caso de cualquier falla de autenticación o bloqueo en producción:

```bash
cd /opt/portal-telvy

# 1. Regresar al commit anterior en git
git checkout HEAD~1

# 2. Reconstruir y levantar versión previa (Bloque Q1 con cliente fijo si fuera necesario)
docker compose up -d --build

# 3. Revertir cambios en Supabase (si es necesario)
# Ejecutar en SQL Editor de Supabase:
# DROP TABLE IF EXISTS public.portal_cuenta_usuario CASCADE;
```
