# Despliegue de Órbita en un VPS (Ubuntu 22.04/24.04)

Guía para correr todo el proyecto (frontend + backend) en un VPS propio, con HTTPS.

**Arquitectura**

```
Internet → Caddy (HTTPS, Let's Encrypt) en el VPS
            ├── /        → frontend estático (build de Vite)
            └── /api/*   → uvicorn (FastAPI, systemd) → SQLite + Chromium (scraping)
```

Como el frontend y la API quedan en el **mismo dominio**, el frontend llama a `/api` (ruta
relativa) y no hay problemas de CORS.

Reemplazá `app.tudominio.com` por tu dominio real en todos los pasos.

---

## 0) DNS (antes de empezar)

En el panel de tu dominio creá un registro **A** apuntando a la IP del VPS:

```
A   app.tudominio.com   →   <IP_DEL_VPS>
```

Esperá a que propague (`ping app.tudominio.com` debe devolver la IP del VPS). Caddy necesita
esto resuelto para emitir el certificado HTTPS.

---

## 1) Preparar el servidor (como root o con sudo)

```bash
apt update && apt upgrade -y

# Node 20 (para compilar el frontend) + git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git python3 python3-venv python3-pip

# Caddy (servidor web con HTTPS automático)
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Usuario dedicado para correr la app (sin login)
adduser --system --group --home /srv/orbita orbita
```

---

## 2) Traer el código

```bash
mkdir -p /srv/orbita && cd /srv/orbita
# Opción A: clonar desde tu repo git
git clone <URL_DE_TU_REPO> repo
# (Opción B: subirlo por scp/rsync desde tu Windows si el repo no está en remoto)

# Estructura esperada: /srv/orbita/repo  con backend/ y la raíz del frontend
ln -s /srv/orbita/repo/backend /srv/orbita/backend
ln -s /srv/orbita/repo        /srv/orbita/frontend
```

> Si preferís, copiá las carpetas en vez de symlinks. Lo importante es que existan
> `/srv/orbita/backend` y `/srv/orbita/frontend/dist` (este último lo generamos en el paso 4).

---

## 3) Backend (FastAPI + Chromium)

```bash
cd /srv/orbita/backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# Descargar Chromium para el scraping + sus dependencias de sistema.
# patchright es un fork de Playwright, usa los mismos comandos.
export PLAYWRIGHT_BROWSERS_PATH=/srv/orbita/.cache/ms-playwright
.venv/bin/patchright install --with-deps chromium
# Si 'patchright' no expone el CLI, usá el de playwright (viene como dependencia):
#   .venv/bin/playwright install --with-deps chromium

# --- Configurar secretos ---
cp .env.example .env
# Generá la clave de cifrado (¡guardala en lugar seguro, es irrecuperable!):
.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
nano .env
#   - pegá el valor en FERNET_KEY
#   - poné CORS_ORIGINS=["https://app.tudominio.com"]
#   - SCRAPING_HEADLESS=true
#   - (opcional) Crisp / Twilio
```

> **Migración de datos**: si querés llevar los clientes/certs que ya tenés cargados en tu
> máquina local, copiá el archivo `backend/data/orbita.db` de Windows al VPS
> (`/srv/orbita/backend/data/orbita.db`). Lleva los certs cifrados con tu FERNET_KEY actual,
> así que **usá la misma FERNET_KEY** en el `.env` del VPS. Si arrancás de cero, las tablas
> se crean solas al primer arranque.

Dejá los archivos como dueño del usuario `orbita`:

```bash
chown -R orbita:orbita /srv/orbita
```

Instalá el servicio systemd:

```bash
cp /srv/orbita/repo/deploy/orbita-backend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now orbita-backend
systemctl status orbita-backend          # debe figurar "active (running)"
curl localhost:8000/                     # {"ok":true,"servicio":"orbita-backend"}
journalctl -u orbita-backend -f          # ver logs en vivo
```

---

## 4) Frontend (build estático)

```bash
cd /srv/orbita/frontend
npm ci

# La API queda en el mismo dominio bajo /api → ruta relativa, sin CORS:
echo 'VITE_API_URL=/api' > .env.production

npm run build      # genera /srv/orbita/frontend/dist
chown -R orbita:orbita /srv/orbita/frontend/dist
```

Cada vez que actualices el frontend: `git pull && npm ci && npm run build`.

---

## 5) Caddy (HTTPS + servir todo)

```bash
cp /srv/orbita/repo/deploy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile        # cambiá app.tudominio.com por tu dominio real
systemctl reload caddy
journalctl -u caddy -f           # debería emitir el certificado de Let's Encrypt
```

Abrí `https://app.tudominio.com` en el navegador. Listo. 🎉

---

## 6) Firewall (recomendado)

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
# El puerto 8000 NO se expone: uvicorn escucha en 127.0.0.1 y solo Caddy lo alcanza.
```

---

## Operación diaria

| Acción | Comando |
|---|---|
| Ver logs backend | `journalctl -u orbita-backend -f` |
| Reiniciar backend | `systemctl restart orbita-backend` |
| Actualizar backend | `cd /srv/orbita/repo && git pull && /srv/orbita/backend/.venv/bin/pip install -r backend/requirements.txt && systemctl restart orbita-backend` |
| Actualizar frontend | `cd /srv/orbita/frontend && git pull && npm ci && npm run build` |

### Backups (importante)

La base `backend/data/orbita.db` tiene **los certificados cifrados de tus clientes**. Hacé
backup diario:

```bash
# Ejemplo simple con cron (crontab -e):
0 4 * * *  cp /srv/orbita/backend/data/orbita.db /srv/orbita/backups/orbita-$(date +\%F).db
```

Guardá también la **FERNET_KEY** en un gestor de contraseñas: sin ella, el backup de la DB
es inútil (no se pueden descifrar los certs).

---

## Notas

- **Un solo worker** de uvicorn (ya configurado en el `.service`): el scheduler del sync
  diario vive dentro del proceso; con varios workers se dispararía varias veces.
- **RAM**: cada scrape abre un Chromium. Con 48 GB no hay problema aunque corran varios
  clientes a la vez.
- **Zona horaria del VPS**: poné `timedatectl set-timezone America/Argentina/Buenos_Aires`
  para que `SYNC_HOUR` (hora del sync diario) coincida con la hora local.
