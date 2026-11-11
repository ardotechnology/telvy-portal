# Guía Operativa de Despliegue — Portal de Cliente Telvy (Bloque Q1)

Esta guía documenta los pasos exactos y numerados para desplegar el prototipo del **Portal de Cliente de Telvy** en el servidor de producción `agroupweb` (`140.84.180.77`), utilizando Docker Compose y Caddy como reverse proxy TLS con certificados de origen de Cloudflare.

---

## Arquitectura de Red y Puertos

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
    │ App Astro (portal-app)                 │
    │  - Puerto interno: 3000 (sin exponer)  │
    │  - Cliente fijo: TELVY_CLIENT=1001     │
    │  - Conexión a Gate: host-gateway:4100  │
    └──────────────────┬─────────────────────┘
                       │ extra_hosts: host.docker.internal:host-gateway
                       ▼
    ┌────────────────────────────────────────┐
    │ Host Loopback 127.0.0.1                │
    │  - telvy-client-gate.service (:4100)   │
    │  - Postgres / pg-test (:5432)          │
    └────────────────────────────────────────┘
```

### Justificación de Conectividad con la Puerta (`host.docker.internal:host-gateway`)
- **Por qué `extra_hosts`:** Caddy requiere resolver `app:3000` mediante el DNS interno de Docker, lo cual exige que tanto Caddy como la aplicación compartan una red bridge gestionada por Compose. Para que `app` pueda consultar `telvy-client-gate` en el host sin exponer el puerto 3000 al exterior, se define `extra_hosts: ["host.docker.internal:host-gateway"]`.
- **Compatibilidad con bind `127.0.0.1` del host:** Si el kernel de Linux rechaza tráfico hacia `127.0.0.1:4100` proveniente de la interfaz bridge de Docker, se incluye la regla estándar de DNAT en el Paso 3.

---

## Rutas en la Puerta de Cliente (`telvy-client-gate`)

| Bloque en Pantalla | Endpoint Consultado | Estado en Motor de Producción | Manejo en la Aplicación |
|---|---|---|---|
| **1. Saldo disponible** | `GET /v1/cliente/saldo` | **Existente (200)** | Se calcula `saldo_base - saldo_reservado` o crédito del switch. |
| **2. Extensiones** | `GET /v1/cliente/extensiones` | **Existente (200)** | Muestra nombre, host y estado en línea (`online`). |
| **3. Troncales** | `GET /v1/cliente/troncales` | **Existente (200)** | Muestra troncales SIP, canales y conectividad. |
| **4. DIDs asignados** | `GET /v1/cliente/dids` | **Existente (200)** | Muestra números E.164, región y destino de timbrado. |
| **5. Avisos outbox** | `GET /v1/cliente/avisos/pendientes` | **Falta ruta de solo lectura en puerta** *(solo existe la administrativa)* | **Estado vacío explícito:** Se muestra un mensaje limpio indicando que no hay avisos pendientes, sin inventar datos ni consultar Supabase. |

---

## Procedimiento de Despliegue (Paso a Paso)

Ejecutar en la consola de `root@agroupweb`:

### Paso 1 — Clonar o Actualizar el Repositorio en `/opt/portal-telvy`

```bash
cd /opt
if [ -d "/opt/portal-telvy/.git" ]; then
    cd /opt/portal-telvy && git pull origin main
else
    git clone https://github.com/ardogroup/portal-telvy.git /opt/portal-telvy
    cd /opt/portal-telvy
fi
```
**Resultado esperado:** Directorio `/opt/portal-telvy` con `docker-compose.yml`, `Caddyfile` y carpeta `app/`.

---

### Paso 2 — Colocar Certificados Cloudflare Origin en `certs/`

Crear el directorio y colocar el certificado (`origin.pem`) y la llave privada (`origin-key.pem`):

```bash
cd /opt/portal-telvy
mkdir -p certs
chmod 700 certs

# Copiar o pegar los certificados generados desde Cloudflare:
# /opt/portal-telvy/certs/origin.pem
# /opt/portal-telvy/certs/origin-key.pem

# Asignar permisos estrictos (solo root lectura/escritura)
chmod 644 certs/origin.pem
chmod 600 certs/origin-key.pem
ls -la certs/
```
**Resultado esperado:**
```text
-rw-r--r-- 1 root root ... origin.pem
-rw------- 1 root root ... origin-key.pem
```

---

### Paso 3 — Crear `.env` del Portal con la Llave Interna

La llave se extrae directamente del archivo oficial `/opt/analisis/telvy-voip-engine/.env` para evitar transcripciones manuales o errores tipográficos:

```bash
cd /opt/portal-telvy

# 1. Extraer la llave interna desde el .env del motor
GATE_KEY=$(grep '^CLIENT_API_INTERNAL_KEY=' /opt/analisis/telvy-voip-engine/.env | cut -d= -f2- | tr -d '\r"')

if [ -z "$GATE_KEY" ]; then
    echo "ERROR: No se encontró CLIENT_API_INTERNAL_KEY en /opt/analisis/telvy-voip-engine/.env"
    exit 1
fi

# 2. Escribir .env local para Compose
cat << EOF > .env
CLIENT_API_INTERNAL_KEY=${GATE_KEY}
EOF

chmod 600 .env
echo "Archivo .env creado con permisos 600."

# 3. Habilitar ruteo local en el kernel para que bridge alcance 127.0.0.1 si es necesario:
sysctl -w net.ipv4.conf.all.route_localnet=1 >/dev/null
DOCKER_GW=$(docker network inspect bridge --format='{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo "172.17.0.1")
iptables -t nat -C PREROUTING -p tcp -d "$DOCKER_GW" --dport 4100 -j DNAT --to-destination 127.0.0.1:4100 2>/dev/null || \
iptables -t nat -A PREROUTING -p tcp -d "$DOCKER_GW" --dport 4100 -j DNAT --to-destination 127.0.0.1:4100
```
**Resultado esperado:** `.env` generado con permisos `600` conteniendo `CLIENT_API_INTERNAL_KEY`.

---

### Paso 4 — Levantar Contenedores con Docker Compose

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

### Paso 5 — Las Cinco Verificaciones de Aceptación

#### Verificación 1: La página carga vía HTTPS con datos reales del cliente 1001
```bash
curl -sL https://portal.telvy.net | grep -i "saldo"
```
**Resultado esperado:**
Líneas HTML conteniendo `Saldo Disponible`, `$10.00 MXN` y desglose de saldo de la cuenta 1001.

#### Verificación 2: Ausencia absoluta de la llave interna en el navegador
Buscar el valor exacto de `CLIENT_API_INTERNAL_KEY` en el HTML y en los recursos estáticos servidos:
```bash
GATE_KEY=$(grep '^CLIENT_API_INTERNAL_KEY=' .env | cut -d= -f2-)

# Comprobar HTML servido
curl -sL https://portal.telvy.net | grep "$GATE_KEY" && echo "FALLA: Llave encontrada en HTML" || echo "OK: Llave ausente en HTML"

# Comprobar en todos los archivos del bundle dentro del contenedor
docker compose exec app grep -rn "$GATE_KEY" dist/client/ 2>/dev/null && echo "FALLA: Llave encontrada en bundle" || echo "OK: Llave ausente en bundle JS/CSS"
```
**Resultado esperado:**
```text
OK: Llave ausente en HTML
OK: Llave ausente en bundle JS/CSS
```

#### Verificación 3: Validación del Certificado TLS
```bash
# Cabeceras HTTP
curl -sI https://portal.telvy.net | head -3

# Emisor y vigencia del certificado
openssl s_client -connect portal.telvy.net:443 -servername portal.telvy.net </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates
```
**Resultado esperado:**
- HTTP/2 200 (o HTTP/1.1 200).
- Emisor: Cloudflare Origin Certificate Authority (o Cloudflare Inc).
- Fechas de validez vigentes.

#### Verificación 4: Integridad de las unidades de telvy y salud del motor en loopback
```bash
# 1. Estados de systemd
systemctl is-active telvy-client-gate telvy-provisioning-worker telvy-reconciler

# 2. Prueba directa al endpoint del motor
GATE_KEY=$(grep '^CLIENT_API_INTERNAL_KEY=' /opt/analisis/telvy-voip-engine/.env | cut -d= -f2-)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-Internal-Key: $GATE_KEY" \
  -H "X-Authenticated-Client: 1001" \
  http://127.0.0.1:4100/v1/cliente/saldo
```
**Resultado esperado:**
```text
active
active
active
200
```

#### Verificación 5: Suite completa de pruebas de telvy-voip-engine
```bash
cd /opt/analisis/telvy-voip-engine
npm test
```
**Resultado esperado:**
Salida cruda en verde finalizando con `129 / 129 criterios aprobados (exit 0)` sin ninguna regresión en el motor VoIP.

---

## Procedimiento de Rollback Exacto

En caso de requerir revertir inmediatamente el prototipo:

```bash
cd /opt/portal-telvy

# 1. Detener y eliminar los contenedores y volúmenes asociados
docker compose down -v

# 2. Eliminar la regla iptables de ruteo bridge (si se aplicó)
DOCKER_GW=$(docker network inspect bridge --format='{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || echo "172.17.0.1")
iptables -t nat -D PREROUTING -p tcp -d "$DOCKER_GW" --dport 4100 -j DNAT --to-destination 127.0.0.1:4100 2>/dev/null || true

# 3. Eliminar archivos temporales de configuración del portal
rm -f Caddyfile .env

# 4. Verificar que los puertos 80 y 443 vuelven a quedar libres
ss -tlnp | grep -E ':80 |:443 '
# (La salida debe ser estrictamente vacía)

# 5. Confirmar que el motor sigue respondiendo normalmente
GATE_KEY=$(grep '^CLIENT_API_INTERNAL_KEY=' /opt/analisis/telvy-voip-engine/.env | cut -d= -f2-)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-Internal-Key: $GATE_KEY" \
  -H "X-Authenticated-Client: 1001" \
  http://127.0.0.1:4100/v1/cliente/saldo
# (Salida: 200)
```
