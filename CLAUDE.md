# Órbita Contadores

SaaS para contadores que administran clientes monotributistas. Trae datos reales de ARCA
(comprobantes emitidos, padrón, deuda CCMA) y los presenta en un panel. Frontend Vite/React +
backend FastAPI. Idioma del proyecto: **español** (código, comentarios, UI, commits).

> El "qué/por qué" acumulado entre sesiones vive en la memoria del proyecto (se carga sola al
> iniciar). Este archivo es el "dónde/cómo" estático del código. No dupliques acá lo que ya está en
> la memoria.

## Regla de producto (OBLIGATORIA)
La copy visible al usuario **NUNCA** menciona el mecanismo de obtención de datos: nada de
"scraping", "ARCA", "navegador", "login", "tarda X minutos", etc. Todo mensaje (UI, estados vacíos,
errores, `motivo` de la API) se redacta en términos del dominio impositivo/contable, como si la app
simplemente *tuviera* el dato. Los comentarios de código (para devs) sí pueden ser técnicos.

## Estructura
- `src/` — frontend Vite/React/TypeScript + Tailwind.
  - `pages/` — una página por ruta (Dashboard, Alertas, Conciliacion, ClienteDetalle, Admin…).
  - `components/layout/` — Sidebar, Topbar, AppLayout. `components/ui/` — design system (Card,
    Button, Table, Tabs, Badge…). `components/shared/` — widgets reutilizables.
  - `context/` — estado global: `ConfigContext`, `CargasContext`, `SyncContext`.
  - `services/` — HTTP al backend. `apiClient.ts` (fetch + token JWT), un service por dominio.
  - `lib/cuenta.ts` — sesión (token + usuario en localStorage), `esAdmin()`, impersonación.
- `backend/app/` — FastAPI.
  - `models.py` — ORM SQLAlchemy 2.0 (Usuario, ClienteARCA, ComprobanteEmitido, Extraccion…).
  - `schemas.py` — Pydantic (in/out). `security.py` — JWT + bcrypt + deps `usuario_actual`/`admin_actual`.
  - `db.py` — engine + `asegurar_columnas()` (migración ligera, ver abajo).
  - `routers/` — un router por dominio (auth, admin, clientes, configuracion, movimientos,
    notificaciones, onboarding). Se registran en `main.py`.
  - `arca/`, `scraping/`, `services/` — integración con ARCA y lógica de negocio.
- `deploy/docker/` — docker-compose + `.env.example` para el VPS.

## Multi-tenant y auth
Cada contador (`Usuario`) ve sólo sus clientes: los endpoints filtran por `usuario_id` y validan
pertenencia con `_cliente_propio()` (404 si no es suyo). Token JWT en `Authorization: Bearer`.
`Usuario.rol` ('contador'|'admin') habilita el panel `/admin`; `Usuario.activo=false` bloquea login
y API (403). Admins sembrados al arrancar: ver `ADMINS_SEMILLA` en `db.py`.

## Migraciones (sin Alembic)
`create_all()` crea tablas nuevas; para columnas nuevas en tablas existentes está
`asegurar_columnas()` en `db.py`, que corre al iniciar la app. La parte de `usuarios`
(`_migrar_usuarios`) es portable SQLite + Postgres; el resto es SQLite-only (sólo para la DB de dev).
Al cambiar el modelo, agregá el `ALTER TABLE ... ADD COLUMN` correspondiente ahí.

## Correr local
```bash
# Frontend (Vite, http://localhost:5173)
npm install
npm run dev

# Backend (FastAPI, http://localhost:8000) — desde backend/
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```
Front apunta al backend con `VITE_API_URL` (`.env.local`; default `http://localhost:8000/api`).
Backend lee secretos de `backend/.env` (ver `.env.example`). DB local = SQLite en `backend/data/`.
Typecheck front: `npx tsc -b`. Compilar backend: `python -m py_compile app/<archivo>.py`.

## Deploy (producción)
- **Novedades (OBLIGATORIO en cada deploy con cambios visibles)**: sumá una entrada al principio
  de `src/data/novedades.ts`, redactada en lenguaje de usuario (misma regla de producto: nada de
  scraping/ARCA/etc.). Se publica con el deploy y aparece en `/novedades` y en el indicador del
  header. Si el deploy es sólo interno (refactor, infra), no hace falta. ⚠️ **Sólo describí
  funciones que el CONTADOR puede usar**: nada admin-only (p. ej. la facturación electrónica hoy
  está restringida a admin → no va como novedad hasta que se habilite a los contadores).
- **Frontend → Vercel**: push a `main` redespliega solo. Dominio
  `contadores.orbitaglobalmarketing.com`. `.vercelignore` excluye `backend/` (no tocar `index.html`).
- **Backend → VPS** (`185.249.227.86`, Docker, Postgres). Subdominio
  `api.contadores.orbitaglobalmarketing.com`. El VPS se opera por el MCP `ssh-vps` (configurado en
  `.mcp.json`, **no commiteado**). Pasos: `git archive HEAD` → subir tarball → extraer sobre
  `/opt/orbita-contadores/repo` (el `.env` no viene en el archive, no se pisa) →
  `cd deploy/docker && docker compose up -d --build backend`. La migración corre al levantar el
  contenedor. Detalle completo en la memoria `deploy-produccion`.

## Backups (Postgres del VPS)
Cron de root `0 3 * * *` corre `/opt/orbita-backups/backup.sh` → `pg_dump` comprimido a
`/opt/orbita-backups/orbita_<fecha>.sql.gz`, retención 14 días, log en `backup.log`.
**Restaurar** un dump:
```bash
gunzip -c /opt/orbita-backups/orbita_<fecha>.sql.gz | \
  docker exec -i orbita_contadores_db psql -U orbita -d orbita_contadores
```
⚠️ Los backups viven en el mismo VPS; falta copia a destino externo. ⚠️ Backupear también la
`FERNET_KEY` del `.env`: sin ella no se descifran los certificados de clientes.
