-- ==============================================================================
-- TELVY CLIENT PORTAL - MIGRACIÓN BLOQUE Q2
-- Tabla portal_cuenta_usuario y Políticas de Row Level Security (RLS)
-- Proyecto Supabase: Telvy (mottolvjcmvvcohrvroe.supabase.co)
-- ==============================================================================

-- 1. Crear tabla de vinculación de usuarios de Auth con clientes de conmutador
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

-- 2. Índices de rendimiento para búsquedas por cliente y por correo
CREATE INDEX IF NOT EXISTS idx_portal_cuenta_usuario_cliente ON public.portal_cuenta_usuario(cliente);
CREATE INDEX IF NOT EXISTS idx_portal_cuenta_usuario_email ON public.portal_cuenta_usuario(email);

-- 3. Habilitar Row Level Security (RLS)
ALTER TABLE public.portal_cuenta_usuario ENABLE ROW LEVEL SECURITY;

-- 4. Política RLS: El usuario autenticado SOLO puede leer su propia fila
DROP POLICY IF EXISTS "portal_cuenta_usuario_select_own" ON public.portal_cuenta_usuario;
CREATE POLICY "portal_cuenta_usuario_select_own"
    ON public.portal_cuenta_usuario
    FOR SELECT
    TO authenticated
    USING (auth.uid() = auth_user_id);

-- 5. Prohibición de escritura para el cliente:
-- No existen políticas de INSERT, UPDATE ni DELETE para los roles 'anon' ni 'authenticated'.
-- La inserción y modificación de cuentas está reservada exclusivamente al rol 'service_role' (back office).

