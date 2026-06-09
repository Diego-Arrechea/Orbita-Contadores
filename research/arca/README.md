# Spike: conectar Órbita con ARCA en Python (sin AfipSDK)

> ⚠️ **Esto es un spike de investigación, NO la integración final.** Vive aparte del
> frontend (Vite/React) a propósito. Sirve para comparar con código en la mano los dos
> caminos de autenticación contra ARCA y decidir cuál usar antes de armar el backend real.

## Los dos caminos

AfipSDK hace **dos autenticaciones distintas** por dentro. Acá replicamos cada una:

| | **Camino A — WSAA + certificado** | **Camino B — Login clave fiscal + scraping** |
|---|---|---|
| Carpeta | [`camino_a_wsaa/`](camino_a_wsaa/) | [`camino_b_scraping/`](camino_b_scraping/) |
| Qué autentica | Web services SOAP oficiales | El portal web de ARCA |
| Credencial | **Certificado X.509 tuyo** (+ delegación del cliente) | **CUIT + clave fiscal del cliente** |
| Listar comprobantes emitidos | Iterar `FECompUltimoAutorizado` + `FECompConsultar` (WSFEv1) | El portal los devuelve listados (endpoint `ajax.do`) |
| Datos del cliente (nombre, categoría…) | Padrón / constancia (`ws_sr_constancia_inscripcion`) | Se scrapean del portal |
| Estabilidad | ✅ API oficial estable | ❌ scraping frágil (se rompe si ARCA cambia el portal) |
| Captcha / 2FA | ✅ no aplica | ❌ reCAPTCHA + posible 2FA (clave nivel 3/4) |
| Claves de terceros | ✅ nunca las tocás (delegación) | ❌ las custodiás vos (riesgo legal) |
| Costo | Gratis (librerías open source) | Gratis, pero alto mantenimiento |

**Recomendación de este spike:** base en **Camino A** (oficial, estable, sin claves ajenas);
**Camino B** solo como último recurso para datos que la API oficial no expone (p. ej. el
listado completo de comprobantes *recibidos*).

## Por qué no se puede correr "tal cual"

- **Camino A** necesita un **certificado digital** emitido por ARCA: generás una clave + CSR,
  subís el CSR al portal (WSASS en homologación / Administrador de Certificados en producción)
  y autorizás el certificado para cada web service. Sin eso, el WSAA rechaza el login.
- **Camino B** necesita un **CUIT + clave fiscal reales** y, casi seguro, **resolver un captcha**
  (y un 2FA si la clave es nivel 3/4). Los selectores del formulario son **ilustrativos**: hay
  que inspeccionar el DOM real, porque ARCA los cambia.

## Cómo correr cada uno

```bash
# Camino A
cd camino_a_wsaa
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -r requirements.txt
python wsaa_auth.py            # genera Token+Sign (necesita cert.crt + clave.key)
python padron.py 20111111112   # datos de un CUIT
python comprobantes_emitidos.py 20111111112

# Camino B
cd camino_b_scraping
pip install -r requirements.txt
playwright install chromium
python mis_comprobantes.py     # pide CUIT + clave fiscal por consola
```

## Entornos de ARCA

- **Homologación (testing):** probás sin riesgo. CUIT de test, certificado de homologación.
- **Producción:** datos reales. Requiere certificado de producción y delegaciones reales.

Cada script tiene una constante `HOMO = True/False` para alternar las URLs.

## Notas de seguridad (leer antes de ir a producción)

- El certificado (`.key`) y las claves fiscales **nunca** van al frontend ni al repo.
  Acá se leen de variables de entorno / archivos locales ignorados por git.
- Si vas por Camino B, sos **custodio legal** de las claves fiscales de tus clientes:
  cifrado en reposo, auditoría de accesos, y revocación cuando termina la relación.
- Camino A con **delegación** evita todo esto: el cliente te delega el servicio en ARCA
  (Administrador de Relaciones) y operás con tu propio certificado.
