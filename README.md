# Portal de Cliente Telvy — Prototipo Q1

Prototipo de infraestructura y diseño del portal de clientes para Telvy VoIP Platform.
- Modo de operación: Solo lectura.
- Cliente fijado en servidor: `TELVY_CLIENT=1001`.
- Caddy como reverse proxy TLS con Cloudflare Origin Certificate.
- Consulta de datos exclusivamente mediante la puerta de cliente en loopback (`telvy-client-gate`).
- Cero consultas directas a Supabase o al conmutador desde el frontend.

Consulte [DEPLOY.md](DEPLOY.md) para el procedimiento operativo de despliegue en `agroupweb`.
