# Despliegue de Órbita (Frontend en Vercel + Backend en VPS Ubuntu)

Guía para producción. El backend NO puede ir a Vercel (necesita Chromium para scrapear ARCA,
APScheduler para el sync diario, y SQLite persistente — nada de eso corre en serverless).
Solución: frontend a Vercel, backend al VPS.

**Arquitectura**

```
   Vercel (CDN global, HTTPS)              VPS Ubuntu (HTTPS via Caddy)
   app.tudominio.com                       api.tudominio.com
   └── dist/ (build de Vite)               └── Caddy → uvicorn (FastAPI, systemd)
       redeploy en cada git push                       └── SQLite + Chromium (scraping)
```

El frontend de Vercel llama al backend del VPS por URL absoluta (cross-origin), así que el
backend tiene CORS abierto para `https://app.tudominio.com` vía `CORS_ORIGINS` en el `.env`.

Reemplazá `tudominio.com` por tu dominio real en todos los pasos.

---

## 0) DNS (antes de empezar)

Dos registros en tu proveedor de DNS:

```
CNAME  app.tudominio.com  →  cname.vercel-dns.com   (te lo da Vercel al agregar el dominio)
A      api.tudominio.com  →  <IP_DEL_VPS>
```

Esperá a que `api.tudominio.com` resuelva a la IP del VPS (`ping api.tudominio.com`) — Caddy
necesita eso para emitir el HTTPS. El CNAME de `app.` lo configurás cuando agregás el dominio
en Vercel (paso A).

---

## A) Frontend a Vercel (5 minutos, sin tocar el VPS)

1. Entrá a [vercel.com](https://vercel.com) e iniciá sesión con tu cuenta de GitHub.
2. **Add New → Project** → importá `Diego-Arrechea/Orbita-Contadores`.
3. Vercel detecta Vite. Confirmá:
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Root Directory: `./` (raíz)
4. **Environment Variables** → agregá:
   ```
   VITE_API_URL = https://api.tudominio.com/api
   ```
5. **Deploy**. En ~2 min te da una URL `xxx.vercel.app` funcionando (la API todavía no responde
   porque falta levantarla en el VPS — pero el sitio carga).
6. **Settings → Domains** → agregá `app.tudominio.com`. Vercel te muestra el CNAME que tenés
   que poner en el DNS (paso 0). En cuanto propague, queda con HTTPS automático.

A partir de ahora **cada `git push` a `main` redeployea el frontend solo**.

---

## 1) Preparar el servidor (como root o con sudo)

```bash
apt update && apt upgrade -y

# Git + Python (no hace falta Node: el frontend lo compila Vercel)
apt install -y git python3 python3-venv python3-pip

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
git clone https://github.com/Diego-Arrechea/Orbita-Contadores repo
ln -s /srv/orbita/repo/backend /srv/orbita/backend
```

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

## 4) Frontend

Lo maneja **Vercel** (paso A). Nada que hacer en el VPS. Cada `git push` a `main` redeploya solo.

---

## 5) Caddy (HTTPS para la API)

Instalá Caddy y configurá el subdominio de la API:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

cp /srv/orbita/repo/deploy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile        # cambiá api.tudominio.com por tu subdominio real
systemctl reload caddy
journalctl -u caddy -f           # debería emitir el certificado de Let's Encrypt
```

Probá: `curl https://api.tudominio.com/` debe devolver `{"ok":true,...}`.
Después abrí `https://app.tudominio.com` (Vercel) y la app entera debería funcionar. 🎉

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
| Actualizar frontend | Automático: `git push` → Vercel redeploya solo |

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
