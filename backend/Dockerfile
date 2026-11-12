# Imagen del backend de Órbita (FastAPI + scraping con Chromium).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    CLOAKBROWSER_CACHE_DIR=/opt/cloakbrowser \
    TZ=America/Argentina/Buenos_Aires

WORKDIR /app

# Utilidades base (tzdata para que SYNC_HOUR use la hora AR; ca-certificates para HTTPS).
# Las libs propias de Chromium las instala "playwright install-deps" más abajo.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates tzdata curl \
    && rm -rf /var/lib/apt/lists/*

# 1) Dependencias Python
COPY requirements.txt .
RUN pip install -r requirements.txt

# 2) Chromium para el scraping:
#    - libs de sistema (apt) que necesita cualquier Chromium headless
#    - Chromium de patchright (Mis Comprobantes / padrón)
#    - fingerprint-chromium de cloakbrowser (bootstrap del cert), pre-bajado a la imagen
RUN playwright install-deps chromium \
    && patchright install chromium \
    && python -c "from cloakbrowser import ensure_binary; ensure_binary()" \
    && rm -rf /var/lib/apt/lists/*

# 3) Código de la app
COPY . .

# 4) Bundle de CA = certifi + intermedias que algunos servidores de ARCA no mandan en el handshake.
#    Desde el 11-nov-2026 portalcf.cloud.afip.gob.ar sirve sólo el certificado hoja (sin la
#    intermedia «Sectigo Public Server Authentication CA OV R36»): el navegador la completa solo,
#    requests no → CERTIFICATE_VERIFY_FAILED en todas las sincronizaciones. Las intermedias van en
#    certs/ (son públicas). Se arma al buildear, así que sigue a certifi cuando se actualiza.
RUN cat "$(python -m certifi)" certs/*.pem > /opt/ca-orbita.pem
ENV REQUESTS_CA_BUNDLE=/opt/ca-orbita.pem

EXPOSE 8000
# 1 solo worker: el scheduler (APScheduler) del sync diario vive dentro del proceso;
# con varios workers el sync se dispararía N veces.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
