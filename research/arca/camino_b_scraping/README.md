# Camino B — Clave fiscal + scraping con CloakBrowser

Trae los comprobantes de un cliente automatizando el portal de ARCA con su CUIT + clave
fiscal. Usa **[CloakBrowser](https://github.com/CloakHQ/CloakBrowser)** (Chromium stealth)
para el login, en vez de Playwright pelado.

## Por qué CloakBrowser

El portal de ARCA tiene un login JSF con **reCAPTCHA**. Playwright común es detectado y
dispara el captcha. CloakBrowser es un Chromium parcheado a nivel C++ que **pasa como
navegador humano** (reCAPTCHA v3 score ~0.9, Turnstile OK), así que el captcha *aparece
menos*. Es drop-in: misma API de Playwright.

> ⚠️ **Lo que CloakBrowser NO hace:** resolver captchas. Los *previene*. Si ARCA igual
> dispara un challenge interactivo (elegir imágenes) o pide **2FA** (clave nivel 3/4),
> tenés que intervenir a mano. Por eso corremos `headless=False`.

## Instalación

```bash
pip install -r requirements.txt
# El binario stealth (~200 MB) se descarga solo en el primer launch.
```

## Uso

```bash
python mis_comprobantes.py        # pide CUIT + clave fiscal, baja emitidos de ene–may 2026
python login.py                   # solo valida que el CUIT + clave sean correctos
```

## Cómo funciona

```
login.py            abrir_sesion()  → contexto stealth con perfil PERSISTENTE (cookies guardadas)
                    login()         → flujo JSF (CUIT → clave). Si ya hay sesión, no reingresa.
mis_comprobantes.py traer_comprobantes() → GET ajax.do?f=generarConsulta → idConsulta
                                          → GET ajax.do?f=listaResultados → JSON de comprobantes
```

El **perfil persistente** (`.perfil_arca/`) es clave: una vez que pasaste login + captcha
+ 2FA, la cookie de sesión queda guardada y los siguientes runs entran directo.

## Recomendaciones para que el captcha no aparezca

- `headless=False` (algunos sitios detectan headless aunque el fingerprint sea perfecto).
- `humanize=True` (ya activado) → mouse/teclado humano.
- **Proxy residencial argentino**: `abrir_sesion(proxy="http://user:pass@host:port")`.
  Una IP de datacenter es señal de bot; una residencial AR baja muchísimo el captcha.
- Backend `patchright` (instalá `patchright`) para reCAPTCHA v3 Enterprise.

## Límites y advertencias

- **Selectores ILUSTRATIVOS**: los IDs del formulario (`F1:username`, etc.) hay que
  confirmarlos inspeccionando el DOM real; ARCA los cambia.
- **Fragilidad**: es scraping. Si ARCA rediseña el portal o migra `serviciosjava2`, se rompe.
- **Legal**: automatizás con la clave fiscal del cliente → necesitás su **consentimiento
  explícito** (la clave es intransferible según ARCA). Los términos de CloakBrowser también
  prohíben "automatizar sistemas sin autorización": la autorización la da el titular de la clave.
- **Seguridad**: la clave fiscal va al backend, nunca al frontend; cifrada en reposo; nunca en logs.

## Estado

Spike — no integrado al frontend de Órbita. No se pudo ejecutar de punta a punta sin un
CUIT + clave reales. La sintaxis está validada; el flujo está listo para probar.
