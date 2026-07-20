"""
afip.py — Cliente de AFIP / ARCA (Clave Fiscal) con requests.

Un solo archivo, una clase `AFIP` (y `AFIPMulti` para multi-CUIT). Principio de
diseño: SIEMPRE el mínimo de peticiones y cookies indispensables. Cada `requests.
Session` scope-a las cookies por dominio sola, así que a cada host solo viajan las
suyas; lo que minimizamos activamente son las PETICIONES (saltamos GETs de
metadata, páginas intermedias y polls que el navegador hace pero no aportan).

═══════════════════════════════════════════════════════════════════════════════
ARQUITECTURA: LOGIN + SSO
═══════════════════════════════════════════════════════════════════════════════
login() — 4 POST irreductibles (JSF/Mojarra; cada ViewState depende del anterior):
    1. GET  login.xhtml            -> ViewState #1 + JSESSIONID + cookies WAF (TS*)
    2. POST login.xhtml (CUIT)     -> pantalla de clave + ViewState #2
    3. POST loginClave.xhtml       -> HTML con JWT (vida ~10s) que apunta a portalcf
    4. POST portalcf/portal/login  -> 302 + AFIPSID = sesión del portal
    (No requiere captcha. El paso 4 es OBLIGATORIO: canjea el JWT por AFIPSID.)

abrir_servicio(nombre) — patrón SSO común a casi todos los servicios (2 requests):
    a) GET  portal/api/servicios/<cuit>/servicio/<nombre>/autorizacion -> token+sign
    b) POST token+sign al "entry point" del servicio  -> setea las cookies de SU dominio
    Saltamos el GET de metadata (/servicio/<nombre>): solo servía para descubrir el
    entry point, que ya está hardcodeado en SERVICIOS_ENTRY.

Sesiones: AFIPSID (portal) y las de cada servicio son cookies de sesión (sin
expiry propio); mueren cuando el servidor corta. La de `fes` (SESSION_TOKEN) sí
trae exp_time embebido: mcmp dura ~15 min FIJOS, pvel ~2.7 h. Se reabre por
vencimiento, no por prueba-y-error. Cascada de recuperación: reusar -> reabrir con
AFIPSID -> re-login (ver _abrir_o_relogin).

═══════════════════════════════════════════════════════════════════════════════
CATÁLOGO DE SERVICIOS  (qué se puede / qué NO)
═══════════════════════════════════════════════════════════════════════════════
mcmp · Mis Comprobantes            fes.afip.gob.ar (JSF, ajax JSON)
    SE PUEDE: consultar comprobantes emitidos/recibidos por fecha (consultar_
        comprobantes / consultar con periodo mes|anio|historico, ambos tipos).
    NO: rango > 365 días por consulta (se trocea solo en histórico); descargar
        PDF del comprobante (no implementado). WAF bloquea si no se pacea (~1.2s).

pvel · Puntos de Venta             fes.afip.gob.ar (Struts .do, JSON)
    SE PUEDE: listar / crear / eliminar puntos de venta (pventa_*), ver sistemas
        válidos (pventa_sistemas).
    NO: editar un PV existente (solo alta/baja); domicilios (solo se usa el fiscal).

arfe_certificado · Certificados    serviciosweb.afip.gob.ar (ASP.NET WebForms)
    SE PUEDE: listar, ver detalle, descargar (.crt), generar CSR+clave local, y
        crear ciclo completo (certificados_crear). Todo verificado.
    NO: eliminar/revocar certificado (no implementado).

adminrel · Administrador de Relaciones serviciosweb.afip.gob.ar (ASP.NET WebForms)
    SE PUEDE: listar los CUITs que el logueado puede operar = él + representados
        que le delegaron clave (representados(); combo de selectAuthority.aspx).
        Crear una relación delegando un Web Service a un Computador Fiscal/alias
        (adminrel_asociar_computador; ej. ws://wsfe para facturar). Es el paso
        que falta tras certificados_crear para que WSFEv1 acepte el cert.
    NO: baja de relaciones; adhesión de servicios INTERACTIVOS (designan persona
        física, no computador) — todavía no implementado.
    OJO: comparte ASP.NET_SessionId con arfe_certificado pero es OTRO SSO; el
        cliente reabre el que corresponda (ver _serviciosweb_servicio).

e-ventanilla · Notificaciones (DFE) ve.cloud.afip.gob.ar (API REST JSON)
    SE PUEDE: listar comunicaciones por fecha, detalle y eventos (notificaciones_*).
    NO: descargar adjuntos (no probado: ninguna cuenta de prueba tenía); marcar
        leído explícito (se marca solo al pedir el detalle).

admin_mono · Monotributo           monotributo.afip.gob.ar (ASP.NET)
    SE PUEDE: leer el dashboard (categoría, facturómetro, próximo vencimiento,
        topes, monotributo unificado) -> monotributo().
    NO: recategorizar, pagar, generar VEP (solo lectura del panel de inicio).

ccam · CCMA Cuenta Corriente       servicios2.afip.gob.ar (ASP clásico, TLS legacy)
    SE PUEDE: leer la "sábana" de movimientos y saldos por período (cuenta_corriente).
    NO: generar VEP ni operar (solo lectura). Requiere _LegacyTLSAdapter (DH 512-bit).

Convención de salida (estándar del cliente): cada método devuelve dict/lista de
dicts con claves snake_case limpias y un campo `_raw` con el original de AFIP
(no se pierde info). Fechas a `datetime`/strings legibles; importes a float.
"""

from __future__ import annotations

import re
import time
import logging
import html as _html
import datetime as _dt

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.ssl_ import create_urllib3_context

from ..config import settings


class _LegacyTLSAdapter(HTTPAdapter):
    """Adapter TLS para servidores AFIP viejos (servicios2) con DH key de 512 bits.

    OpenSSL 3.x los rechaza con 'DH_KEY_TOO_SMALL'. Bajamos SECLEVEL a 0 SOLO para
    esos dominios (se monta puntual), sin tocar la seguridad del resto.
    """

    def init_poolmanager(self, *a, **k):
        ctx = create_urllib3_context()
        ctx.set_ciphers("DEFAULT@SECLEVEL=0")
        k["ssl_context"] = ctx
        return super().init_poolmanager(*a, **k)

    def proxy_manager_for(self, *a, **k):
        ctx = create_urllib3_context()
        ctx.set_ciphers("DEFAULT@SECLEVEL=0")
        k["ssl_context"] = ctx
        return super().proxy_manager_for(*a, **k)


# --- URLs ---------------------------------------------------------------------
BASE_AUTH = "https://auth.afip.gob.ar"
URL_LOGIN = f"{BASE_AUTH}/contribuyente_/login.xhtml"
URL_LOGIN_CLAVE = f"{BASE_AUTH}/contribuyente_/loginClave.xhtml"
# Endpoint al que se postea la clave cuando ARCA exige captcha (distinto de loginClave.xhtml).
URL_LOGIN_CAPTCHA = f"{BASE_AUTH}/contribuyente_/loginCaptchaAfip.xhtml"
URL_PORTAL_LOGIN = "https://portalcf.cloud.afip.gob.ar/portal/login"
URL_PORTAL_APP = "https://portalcf.cloud.afip.gob.ar/portal/app/"
URL_PORTAL_API_BASE = "https://portalcf.cloud.afip.gob.ar/portal/api"
URL_PORTAL_API = f"{URL_PORTAL_API_BASE}/servicios"

# Mis Comprobantes (mcmp) en fes.afip.gob.ar
FES_BASE = "https://fes.afip.gob.ar/mcmp/jsp"

# Administración de Puntos de Venta y Domicilios (pvel) en fes.afip.gob.ar
# (acciones Struts .do; comparte el dominio fes con mcmp).
PVEL_BASE = "https://fes.afip.gob.ar/pvel/jsp"

# Monotributo (admin_mono) en monotributo.afip.gob.ar (ASP.NET)
MONO_BASE = "https://monotributo.afip.gob.ar/app"
MONO_INICIO = f"{MONO_BASE}/Inicio.aspx"
# Entrada REAL al dashboard: tras el SSO la app pasa por SelecRepresentado.aspx
# (elige contribuyente y arma el contexto). Para el titular auto-selecciona y
# redirige a Inicio.aspx; ir directo a Inicio.aspx sin ese paso cae en Error.aspx.
MONO_SELEC = f"{MONO_BASE}/SelecRepresentado.aspx"

# Administración de Certificados Digitales (arfe_certificado) en serviciosweb
# (ASP.NET WebForms clásico: ASP.NET_SessionId + __VIEWSTATE formato 'dDw...').
CERT_BASE = "https://serviciosweb.afip.gob.ar/clavefiscal/adminrel"

# CCMA - Cuenta Corriente de Monotributistas y Autónomos (ccam) en servicios2
# (ASP clásico: cookies ASPSESSIONID*).
CCAM_BASE = "https://servicios2.afip.gob.ar/tramites_con_clave_fiscal/ccam"

# Domicilio Fiscal Electrónico / e-ventanilla (notificaciones) en ve.cloud.afip
# (API REST JSON; sesión JSESSIONID propia del dominio ve.cloud).
VE_BASE = "https://ve.cloud.afip.gob.ar"

# "Aportes en Línea" (MisAportes) en serviciossegsoc: la remuneración que el empleador declara al
# SIPA (F.931) del empleado en relación de dependencia. ASP.NET WebForms (ASP.NET_SessionId +
# __VIEWSTATE/__EVENTVALIDATION); el entry SSO real es default.aspx. Ver el método mis_aportes().
MISAPORTES_BASE = "https://serviciossegsoc.afip.gob.ar/MisAportes/app"

# Sistema Registral (padron-puc-consulta-internet) en seti.afip.gob.ar (Struts .do). Es de donde
# sale la CONSTANCIA DE INSCRIPCIÓN/OPCIÓN oficial: ConstanciaForwardAction.do redirige a
# ConstanciaDispatcherAction.do (HTML latin-1) con régimen, categoría, impuestos, ACTIVIDADES
# declaradas y el código verificador + vigencia. Ver constancia_html()/actividades().
SETI_PADRON_BASE = "https://seti.afip.gob.ar/padron-puc-consulta-internet"

# Entry point (paso c de abrir_servicio) de servicios conocidos. Tenerlo acá
# permite saltar el GET de metadata (que solo servía para descubrir esta URL).
SERVICIOS_ENTRY = {
    "mcmp": f"{FES_BASE}/index.do",
    "pvel": f"{PVEL_BASE}/index.jsp",
    "admin_mono": f"{MONO_BASE}/default.aspx",
    "arfe_certificado": f"{CERT_BASE}/default.aspx",
    # adminrel = Administrador de Relaciones: misma app/entry que certificados pero
    # OTRO servicio SSO (otro token+sign). El POST a default.aspx redirige a
    # selectAuthority.aspx, que trae el combo de representados.
    "adminrel": f"{CERT_BASE}/default.aspx",
    "ccam": f"{CCAM_BASE}/procesa.asp",
    "e-ventanilla": f"{VE_BASE}/login",
    # Aportes en Línea: el token+sign va a default.aspx (index.aspx cae en ErrorPage→FinSession).
    "mis_aportes": f"{MISAPORTES_BASE}/default.aspx",
    # Sistema Registral (constancia + actividades). Universal: todo CUIT lo tiene (no auto-adherir).
    "padron-puc-consulta-internet": f"{SETI_PADRON_BASE}/AccessPointAction.do",
}

# Comprobantes en Línea (rcel) en fe.afip.gob.ar. NO es mcmp: rcel es el facturador web, y su
# menú principal es el TRAMPOLÍN a las Liquidaciones Electrónicas del sector primario (agro). El
# entry real del SSO es index.jsp (index_bis.jsp da 403); el POST del token+sign va ahí.
RCEL_BASE = "https://fe.afip.gob.ar/rcel/jsp"
# Auth "legacy" (.gov, no .gob) que canjea el token 'request' del forward rcel→sector por el
# token 'granted' del sub-servicio (paso intermedio del doble SSO; ver _lsp_abrir).
AUTH_GOV_FORWARD = "https://auth.afip.gov.ar/contribuyente/"

# Liquidaciones Electrónicas del sector primario: cada sector es un SUB-SERVICIO propio con su
# `data-token` (el botón del menú de rcel) y su web-app. Sólo 'hacienda' (token 'lsp', app
# serviciosjava2/lsp-web = "Liquidación Electrónica - Sector Pecuario") está mapeado end-to-end.
# Los otros 3 usan el MISMO mecanismo de forward pero caen en OTRA app (host/paths sin mapear:
# hay que hacerlo con un cliente que realmente tenga liquidaciones de ese sector).
LSP_SECTORES = {
    "hacienda": {"token": "lsp", "base": "https://serviciosjava2.afip.gob.ar/lsp-web"},
    # "lecheria": {"token": "lum", "base": ...},
    # "tabaco":   {"token": "ltv", "base": ...},
    # "azucar":   {"token": "leu_web_lca", "base": ...},
}

# Servicios interactivos que, si el CUIT NO los tiene adheridos en su Clave Fiscal,
# adherimos solos (Administrador de Relaciones) y reintentamos abrirlos. Mapea el
# nombre SSO -> el servicename del árbol de relaciones (web://<name>). Así el alta /
# motor se autocura en vez de fallar con "El servicio no está disponible":
#   - mcmp: Mis Comprobantes (sin él no se traen comprobantes; rompía altas).
#   - arfe_certificado: Administración de Certificados Digitales (sin él no se crea
#     el cert para facturar). bootstrap_certificado ya lo maneja aparte; acá queda
#     como red de seguridad para cualquier otro camino que abra el servicio.
AUTO_ADHERIR = {
    "mcmp": "web://mcmp",
    "arfe_certificado": "web://arfe_certificado",
}

# Mapeo de las columnas del listaResultados (índice -> nombre). La grilla trae ~50
# columnas; acá van las útiles (los índices 18..47 son los desgloses de IVA, casi
# todos 0). Índices verificados con datos reales (ver muestra_afip).
MCMP_COLS = {
    0: "fecha",                 # 'dd/mm/aaaa'
    1: "tipo_cmp",              # código numérico como string (p.ej. '6')
    3: "punto_venta",
    4: "nro_desde",
    5: "nro_hasta",
    8: "cod_autorizacion",      # CAE/CAI
    10: "tipo_doc_receptor",    # contraparte (receptor en emitidos, emisor en recibidos)
    11: "nro_doc_receptor",
    12: "denominacion_receptor",
}
# moneda y cotización viven en índices DISTINTOS según la dirección: la grilla de
# recibidos intercala 2 columnas extra. (idx_cotizacion, idx_moneda):
MCMP_MONEDA = {"E": (13, 14), "R": (16, 17)}
# imp_total NO tiene índice fijo: el desglose de IVA se expande por comprobante y
# corre la posición del total -> se toma el ÚLTIMO valor no nulo de la fila.

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
)

# --- Regex para parsear el HTML de JSF ---------------------------------------
_RE_VIEWSTATE = re.compile(
    r'name="javax\.faces\.ViewState"[^>]*value="([^"]*)"', re.IGNORECASE
)
_RE_FORM_ACTION = re.compile(r'<form[^>]*\baction="([^"]*)"', re.IGNORECASE)
_RE_JWT = re.compile(r'name="jwt"\s+value="([^"]*)"', re.IGNORECASE)
# __VIEWSTATE de ASP.NET WebForms (serviciosweb / certificados, monotributo)
_RE_ASPNET_VS = re.compile(
    r'name="__VIEWSTATE"\s+value="([^"]*)"', re.IGNORECASE
)
_RE_SCRIPT_STYLE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_RE_TAG = re.compile(r"<[^>]+>")
_RE_WS = re.compile(r"\s+")


def _num_ars(s: str) -> float:
    """Importe en formato AR ('4.694.468,96') -> float 4694468.96. '' / None -> 0.0."""
    s = (s or "").strip().replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _pista_pantalla(html: str, limite: int = 160) -> str:
    """Resumen legible de una pantalla inesperada de ARCA (título + texto visible), para diagnóstico.
    Saca scripts/estilos/tags y colapsa espacios. Se usa en el motivo del fallo y en el log, así ante
    una respuesta desconocida queda registrado QUÉ devolvió ARCA (para saber cómo proceder)."""
    mt = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    titulo = _RE_WS.sub(" ", mt.group(1)).strip() if mt else ""
    cuerpo = _RE_SCRIPT_STYLE.sub(" ", html)
    cuerpo = _RE_WS.sub(" ", _RE_TAG.sub(" ", cuerpo)).strip()
    if titulo and titulo in cuerpo:
        cuerpo = cuerpo.replace(titulo, "", 1).strip()
    texto = (f"{titulo} — {cuerpo}" if titulo else cuerpo).strip()
    return texto[:limite].strip() or "sin contenido legible"


# La imagen del captcha de ARCA viaja EMBEBIDA como data-URI base64 en la pantalla de clave, dentro
# de <div id="captcha">…<img src="data:image/jpeg;base64,…">. NO es una request aparte.
_RE_CAPTCHA_IMG = re.compile(
    r'<div id="captcha"[^>]*>.*?<img[^>]+src="data:image/[^;]+;base64,\s*([^"]+)"', re.S | re.I
)


def _extraer_captcha(html: str) -> str | None:
    """Base64 de la imagen del captcha si la pantalla lo trae, o None si no hay captcha."""
    m = _RE_CAPTCHA_IMG.search(html)
    return m.group(1).strip() if m else None


def _resolver_captcha(imagen_b64: str) -> str | None:
    """Resuelve el captcha de imagen con CapSolver (ImageToTextTask, respuesta sincrónica). Devuelve
    el texto, o None si no hay key configurada o CapSolver falla (el caller decide cómo seguir)."""
    if not settings.capsolver_key:
        return None
    log = logging.getLogger("afip.captcha")
    try:
        r = requests.post(
            settings.capsolver_url,
            json={
                "clientKey": settings.capsolver_key,
                "task": {"type": "ImageToTextTask", "body": imagen_b64, "module": "common"},
            },
            timeout=40,
        )
        j = r.json()
        if j.get("errorId") == 0:
            texto = (j.get("solution") or {}).get("text") or None
            log.info("CapSolver resolvió el captcha (conf %s)", (j.get("solution") or {}).get("confidence"))
            return texto
        log.warning("CapSolver error: %s", j.get("errorDescription") or j.get("errorCode") or j)
    except Exception as e:  # noqa: BLE001 — red/timeout/JSON: tratamos como "no resuelto"
        log.warning("CapSolver falló: %s", e)
    return None


def _registrar_captcha(cuit: str, resuelto: bool, intentos: int) -> None:
    """Registra un evento de captcha visto en el login (métrica: en qué cuentas y con qué frecuencia
    ARCA lo pide). Nunca rompe el login: si la escritura falla, se ignora."""
    try:
        from ..db import SessionLocal
        from .. import models

        db = SessionLocal()
        try:
            db.add(models.CaptchaEvento(cuit=str(cuit), resuelto=bool(resuelto), intentos=int(intentos)))
            db.commit()
        finally:
            db.close()
    except Exception:  # noqa: BLE001 — la métrica jamás debe afectar el login
        logging.getLogger("afip.captcha").debug("no se registró el evento de captcha", exc_info=True)


class AFIPError(Exception):
    """Error en el flujo de AFIP (paso inesperado, login fallido, etc.)."""


class ClaveVencidaError(AFIPError):
    """ARCA forzó al titular a cambiar su Clave Fiscal (campaña de seguridad de AFIP): el login
    devuelve la pantalla `cambioClaveForzado.xhtml` en vez del JWT. NO se puede sincronizar hasta
    que el cliente cambie la clave en el sitio de ARCA — no es un fallo transitorio ni algo que
    resolvamos nosotros. Es una subclase de AFIPError distinta para que el caller la detecte y avise
    al contador en vez de reintentar."""


class ClaveInvalidaError(AFIPError):
    """La Clave Fiscal guardada del cliente NO es válida: ARCA rechazó el login y volvió a mostrar la
    pantalla de clave. A diferencia de ClaveVencidaError (AFIP fuerza el cambio por seguridad), acá la
    clave está mal cargada o el cliente la cambió; se resuelve cargando la clave correcta. Subclase
    propia para que el caller marque el cliente y avise al contador."""


class LoginDesafiadoError(AFIPError):
    """ARCA le pidió a la cuenta una verificación de seguridad adicional (captcha) al ingresar: el
    POST de la clave vuelve a la pantalla de clave con el captcha visible ("El captcha ingresado es
    incorrecto"). Se dispara tras varios accesos seguidos (motor de riesgo anti-automatización de
    ARCA) y NO se puede resolver automáticamente ni sabemos si la clave es correcta. Subclase propia
    para NO marcar la clave como inválida (podría estar bien) y avisar al contador con un motivo claro."""


class LoginSinJWTError(AFIPError):
    """El login envió la clave pero ARCA no devolvió el JWT (ni la pantalla de clave, ni la de cambio
    forzado, ni el captcha): respuesta inesperada (WAF/pantalla intermedia). Puede ser transitorio, así
    que el caller sólo marca la clave a revisar si esto se repite varias veces seguidas. El mensaje
    incluye una pista de lo que ARCA devolvió (para diagnosticar cómo proceder)."""


class ContribuyenteIrregularError(AFIPError):
    """El contribuyente registra irregularidades en el padrón de ARCA. Al fijar el contribuyente
    (setearContribuyente), ARCA devuelve una pantalla de error ("La CUIT ... registra irregularidades.
    Deberá dirigirse a la dependencia a la cual se encuentra inscripto. Err: 002") en vez de habilitar
    la consulta. Sin detectarlo, el flujo seguía hasta generarConsulta y fallaba con el mensaje
    críptico 'Rango de fechas inválido'. NO se puede sincronizar hasta que el cliente regularice su
    situación en la dependencia — no es un fallo transitorio ni algo que resolvamos nosotros. Subclase
    propia para que el caller marque el cliente y le avise al contador con un motivo claro."""


class AFIP:
    """Cliente de Clave Fiscal de AFIP/ARCA.

    Uso:
        afip = AFIP("20123456789", "miClave")
        afip.login()
        # afip.session ya tiene las cookies (AFIPSID, etc.) para seguir navegando
    """

    def __init__(self, cuit: str, password: str, *, verbose: bool = True) -> None:
        self.cuit = str(cuit).replace("-", "").strip()
        self.password = password
        self.logged_in = False

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;q=0.9,"
                    "image/avif,image/webp,image/apng,*/*;q=0.8"
                ),
                "Accept-Language": "es-419,es;q=0.8",
                "Upgrade-Insecure-Requests": "1",
            }
        )
        # servicios2 (ccam) tiene DH key de 512 bits -> TLS relajado solo ahí.
        self.session.mount("https://servicios2.afip.gob.ar", _LegacyTLSAdapter())

        # Throttle anti-bot de fes: gap mínimo entre requests al dominio fes.
        self._min_gap = 1.2
        self._last_fes = 0.0

        # Vigencia de la sesión de fes (mcmp). El SESSION_TOKEN dura 15 min FIJOS
        # (no deslizante); guardamos su exp_time para decidir reusar vs reabrir
        # sin gastar una request condenada a fallar.
        self.fes_exp = 0.0
        self._contribuyente_set = False
        self._fes_servicio = None  # qué servicio de fes está abierto (mcmp/pvel)
        # serviciosweb comparte ASP.NET_SessionId entre arfe_certificado y adminrel,
        # pero cada SSO fija un "modo" distinto en el server -> recordamos cuál es el
        # último abierto para reabrir si cambia (cert <-> relaciones).
        self._serviciosweb_servicio = None
        self._adhiriendo = False  # guard de re-entrada del auto-adherir (ver abrir_servicio)
        # Sector de Liquidaciones del agro (LSP) que ya quedó abierto en esta sesión (o None): así
        # consultar/descargar-PDF del mismo sector no rehace el doble SSO. Ver _lsp_preparar.
        self._lsp_sector = None

        # Logger por CUIT: en multi-tenant los logs distinguen de qué cliente son.
        self.log = logging.getLogger(f"afip.{self.cuit}")
        if verbose:
            if not logging.getLogger().handlers:
                logging.basicConfig(
                    level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                )
            self.log.setLevel(logging.INFO)

    # --- helpers de parseo ---------------------------------------------------
    @staticmethod
    def _viewstate(html: str) -> str:
        m = _RE_VIEWSTATE.search(html)
        if not m:
            raise AFIPError("No se encontró javax.faces.ViewState en la respuesta.")
        return m.group(1)

    @staticmethod
    def _form_action(html: str, default: str) -> str:
        """Devuelve el action del form. JSF lo trae con ;jsessionid= embebido."""
        m = _RE_FORM_ACTION.search(html)
        if not m:
            return default
        action = m.group(1)
        if action.startswith("http"):
            return action
        return BASE_AUTH + action

    # --- pasos del login -----------------------------------------------------
    def _paso1_get_login(self) -> tuple[str, str]:
        """GET inicial. Devuelve (viewstate, action_del_form)."""
        self.log.info("Paso 1: GET login.xhtml")
        r = self.session.get(URL_LOGIN, headers={"Referer": "https://www.arca.gob.ar/"})
        r.raise_for_status()
        vs = self._viewstate(r.text)
        action = self._form_action(r.text, URL_LOGIN)
        self.log.info("  ViewState #1: %s", vs)
        self.log.info("  Cookies: %s", list(self.session.cookies.keys()))
        return vs, action

    def _paso2_post_cuit(self, viewstate: str, action: str) -> str:
        """POST del CUIT. Devuelve el HTML de la pantalla de clave."""
        self.log.info("Paso 2: POST CUIT")
        data = {
            "F1": "F1",
            "F1:username": self.cuit,
            "F1:btnSiguiente": "Siguiente",
            "javax.faces.ViewState": viewstate,
        }
        r = self.session.post(
            action,
            data=data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": BASE_AUTH,
                "Referer": URL_LOGIN,
            },
        )
        r.raise_for_status()
        if "F1:password" not in r.text:
            raise AFIPError(
                "El paso del CUIT no devolvió la pantalla de clave "
                "(¿CUIT inválido o WAF bloqueando?)."
            )
        return r.text

    def _paso3_post_clave(self, html_clave: str) -> str:
        """POST de la clave. Devuelve el JWT para canjear en el portal.

        Si ARCA exige un captcha de imagen (desafío que aparece tras varios accesos seguidos), la
        pantalla trae la imagen embebida: la resolvemos con CapSolver y posteamos a loginCaptchaAfip
        (endpoint distinto de loginClave) con `F1:captchaSolutionInput`. Si CapSolver la erra, ARCA
        devuelve un captcha NUEVO → reintentamos hasta `capsolver_max_reintentos`. Sin key de CapSolver
        (o si se agotan los reintentos), se levanta LoginDesafiadoError."""
        html = html_clave  # pantalla actual (cambia en cada reintento si ARCA sirve un captcha nuevo)
        captcha_intentos = 0   # cuántas imágenes de captcha se resolvieron en este login (métrica)
        captcha_resuelto = False
        try:
            for intento in range(1 + max(0, settings.capsolver_max_reintentos)):
                vs = self._viewstate(html)
                captcha_b64 = _extraer_captcha(html)
                data = {
                    "F1": "F1",
                    "F1:username": self.cuit,
                    "F1:password": self.password,  # SIEMPRE va: un rechazo de captcha borra la clave
                    "F1:btnIngresar": "Ingresar",
                    "javax.faces.ViewState": vs,
                }
                if captcha_b64:
                    captcha_intentos += 1
                    solucion = _resolver_captcha(captcha_b64)
                    if not solucion:
                        # sin key configurada o CapSolver no pudo: no hay forma de pasar el captcha
                        raise LoginDesafiadoError(
                            "No se pudo validar el acceso a los datos de este cliente: ARCA está "
                            "aplicando una verificación de seguridad adicional en esta cuenta (suele "
                            "ocurrir tras varios accesos seguidos). Reintentá más tarde."
                        )
                    data["F1:captchaSolutionInput"] = solucion
                    url = URL_LOGIN_CAPTCHA
                    self.log.info("Paso 3: POST clave + captcha (intento %d)", intento + 1)
                else:
                    data["F1:captcha"] = ""  # campo oculto del flujo sin captcha
                    url = URL_LOGIN_CLAVE
                    self.log.info("Paso 3: POST clave")
                r = self.session.post(
                    url,
                    data=data,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Origin": BASE_AUTH,
                        "Referer": URL_LOGIN,
                    },
                )
                r.raise_for_status()

                m = _RE_JWT.search(r.text)
                if m:
                    captcha_resuelto = captcha_intentos > 0
                    return m.group(1)

                low = r.text.lower()
                # ARCA fuerza el cambio de clave (campaña de seguridad): cambioClaveForzado.xhtml.
                # No se recupera reintentando: el cliente tiene que cambiar la clave en ARCA.
                if "cambioclaveforzado" in low or "cambiar tu contrase" in low:
                    raise ClaveVencidaError(
                        "ARCA le pide al cliente cambiar su Clave Fiscal (por seguridad) antes de continuar."
                    )
                # ¿ARCA (re)sirvió un captcha? Puede ser porque erramos el anterior o porque recién
                # ahora lo exige. Reintentamos con la imagen nueva. OJO: va ANTES del chequeo de
                # F1:password, porque la pantalla del captcha también trae el form de clave.
                if _extraer_captcha(r.text):
                    self.log.warning("ARCA pide/rechaza captcha; reintento con imagen nueva")
                    html = r.text
                    continue
                # Clave incorrecta. ARCA lo señala de dos formas: (a) vuelve a la pantalla de clave
                # (F1:password), o (b) REBOTA a la pantalla del CUIT con el aviso "Clave o usuario
                # incorrecto" (sin F1:password → antes caía en el cajón de sastre). Ambas = clave
                # inválida: el cliente cambió la clave o está mal cargada; el contador debe cargar la
                # correcta. Marca clave_invalida y dispara el aviso en la lista.
                if (
                    "f1:password" in low
                    or "clave o usuario incorrecto" in low
                    or "usuario o clave incorrecto" in low
                    or "clave incorrecta" in low
                ):
                    raise ClaveInvalidaError("Clave incorrecta o login rechazado.")
                # Pantalla desconocida: dejamos rastro de lo que ARCA devolvió, para saber cómo proceder.
                pista = _pista_pantalla(r.text)
                self.log.warning("Login sin JWT — pantalla inesperada de ARCA: %s", pista)
                raise LoginSinJWTError(
                    "No se pudo acceder a los datos de este cliente: ARCA devolvió una respuesta "
                    f"inesperada al validar la Clave Fiscal ({pista})."
                )
            # Se agotaron los reintentos y ARCA seguía pidiendo captcha (CapSolver no acertó a tiempo).
            raise LoginDesafiadoError(
                "No se pudo validar el acceso a los datos de este cliente: la verificación de "
                "seguridad de ARCA no se pudo completar tras varios intentos. Reintentá más tarde."
            )
        finally:
            # Métrica: si en este login se vio al menos un captcha, lo registramos (resuelto o no).
            if captcha_intentos:
                _registrar_captcha(self.cuit, captcha_resuelto, captcha_intentos)

    def _paso4_post_jwt(self, jwt: str) -> None:
        """Canjea el JWT (vida ~10s) por la sesión del portal (AFIPSID)."""
        self.log.info("Paso 4: POST jwt -> portal/login")
        r = self.session.post(
            URL_PORTAL_LOGIN,
            data={"jwt": jwt},
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": BASE_AUTH,
                "Referer": f"{BASE_AUTH}/",
            },
            allow_redirects=True,
        )
        r.raise_for_status()
        if "AFIPSID" not in self.session.cookies.keys():
            raise AFIPError("El portal no devolvió AFIPSID (¿JWT vencido?).")
        self.log.info("  AFIPSID OK. Cookies: %s", list(self.session.cookies.keys()))

    # --- API pública ---------------------------------------------------------
    def login(self) -> requests.Session:
        """Ejecuta el flujo completo de login. Devuelve la Session autenticada.

        Reintenta el flujo ENTERO ante transitorios de red/ARCA (503, timeout, conexión
        cortada) con backoff. Rehace los 4 pasos desde cero (el JWT del paso 3->4 dura
        ~10s, no se puede reintentar suelto). Los errores de credenciales (clave/CUIT)
        son AFIPError, NO RequestException, así que NO se reintentan (fallan al toque)."""
        ultimo: Exception | None = None
        for intento in range(3):
            try:
                viewstate, action = self._paso1_get_login()
                html_clave = self._paso2_post_cuit(viewstate, action)
                jwt = self._paso3_post_clave(html_clave)  # inmediatamente despues:
                self._paso4_post_jwt(jwt)                 # el JWT dura ~10 segundos
                self.logged_in = True
                self.log.info("Login OK para CUIT %s", self.cuit)
                return self.session
            except requests.RequestException as e:
                ultimo = e
                if intento < 2:
                    espera = 5 * (intento + 1)
                    self.log.warning("Login transitorio (%s). Reintento en %ss", str(e)[:80], espera)
                    time.sleep(espera)
        raise ultimo  # type: ignore[misc]

    def abrir_servicio(self, service_name: str, *, entry_url: str | None = None) -> None:
        """Abre un servicio de Clave Fiscal (SSO) y deja la sesión lista para usarlo.

        Mínimo indispensable (2 requests):
            a) GET  /portal/api/servicios/<cuit>/servicio/<name>/autorizacion
               -> {token, sign}  (ticket SSO estilo WSAA, vida ~5 min).
            b) POST token+sign al entry point del servicio.
               ESTE paso es el que genera las cookies del dominio destino:
               SESSION_TOKEN, SESSION_SIGN, JSESSIONID, SRV (y TS* del WAF, no
               indispensables).

        El GET de metadata (/servicio/<name>) se omite: solo servía para
        descubrir el entry point, que para servicios conocidos está en
        SERVICIOS_ENTRY. Para uno desconocido, pasá `entry_url`.
        """
        if not self.logged_in:
            raise AFIPError("Tenés que hacer login() antes de abrir un servicio.")
        entry_url = entry_url or SERVICIOS_ENTRY.get(service_name)
        if not entry_url:
            raise AFIPError(
                f"No conozco el entry point de '{service_name}'. Pasá entry_url."
            )

        ref = {"Accept": "application/json, text/plain, */*", "Referer": URL_PORTAL_APP}
        self.log.info("Servicio %s: autorización (token+sign)", service_name)
        r_aut = self.session.get(
            f"{URL_PORTAL_API}/{self.cuit}/servicio/{service_name}/autorizacion",
            headers=ref,
        )
        try:
            aut = r_aut.json()
        except ValueError:
            # Respuesta no-JSON => la sesión del portal (AFIPSID) murió.
            raise AFIPError("Sesión del portal expirada (autorizacion sin JSON).")
        if not isinstance(aut, dict) or "token" not in aut or "sign" not in aut:
            # La autorización no trajo token+sign: el CUIT no tiene habilitado este
            # servicio. Para los servicios auto-adheribles (Mis Comprobantes, etc.) lo
            # adherimos solos y reintentamos UNA vez (el flag _adhiriendo corta la
            # recursión si la adhesión no alcanzó). El resto se marca limpio en vez de
            # reventar con KeyError aguas abajo (p. ej. CCMA para quien no es
            # monotributista ni autónomo).
            #
            # Contingencia en capas: primero el POST de la propia API del portal (el
            # mismo botón "Agregar" del portal, un JSON limpio); si no queda, caemos al
            # Administrador de Relaciones (wizard HTML) como red de seguridad.
            serv_rel = AUTO_ADHERIR.get(service_name)
            if serv_rel and not self._adhiriendo:
                self.log.info("Servicio %s no adherido; lo adhiero y reintento", service_name)
                self._adhiriendo = True
                try:
                    if not self._portal_adherir_servicio(service_name):
                        self.log.info("  POST del portal no alcanzó; pruebo el wizard (%s)", serv_rel)
                        self.adminrel_adherir_servicio(serv_rel)
                finally:
                    self._adhiriendo = False
                self.abrir_servicio(service_name, entry_url=entry_url)
                return
            raise AFIPError(
                f"El servicio '{service_name}' no está disponible para este CUIT "
                f"(autorizacion sin token)."
            )

        self.log.info("Servicio %s: POST token+sign -> %s", service_name, entry_url)
        self.session.post(
            entry_url,
            data={"token": aut["token"], "sign": aut["sign"]},
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://portalcf.cloud.afip.gob.ar",
                "Referer": "https://portalcf.cloud.afip.gob.ar/",
            },
        )
        # Servicios sobre fes (mcmp/pvel): registrar cuál quedó abierto y el
        # vencimiento del SESSION_TOKEN (comparten dominio y cookie en fes).
        if service_name in ("mcmp", "pvel"):
            self._fes_servicio = service_name
            self._contribuyente_set = False
            self.fes_exp = self._leer_exp_session_token()
            self.log.info(
                "  Sesión fes (%s) vence ~%s",
                service_name,
                time.strftime("%H:%M:%S", time.localtime(self.fes_exp)) if self.fes_exp else "?",
            )
        else:
            # serviciosweb (cert/relaciones): recordar el modo para no cruzarlos.
            if service_name in ("arfe_certificado", "adminrel"):
                self._serviciosweb_servicio = service_name
            self.log.info("  Cookies del servicio OK: %s", service_name)

    # --- Mis Comprobantes (mcmp) --------------------------------------------
    # fes.afip.gob.ar (JSF/Mojarra). Consulta de comprobantes emitidos/recibidos.
    # Flujo mínimo: abrir_servicio + setearContribuyente (1 vez) + 2 ajax por
    # consulta (generarConsulta -> listaResultados; estimarResultados se saltea).
    # Sesión fes ~15 min. SE PUEDE consultar por fecha/periodo; NO descargar PDF.
    def _leer_exp_session_token(self) -> float:
        """Lee el exp_time embebido en el SESSION_TOKEN (epoch). 0 si no está."""
        import base64

        tok = self.session.cookies.get("SESSION_TOKEN", domain=".fes.afip.gob.ar")
        if not tok:
            return 0.0
        try:
            xml = base64.b64decode(tok).decode("utf-8", "replace")
            m = re.search(r'exp_time="(\d+)"', xml)
            return float(m.group(1)) if m else 0.0
        except Exception:
            return 0.0

    def sso_login_info(self) -> tuple[str | None, list[str]]:
        """Del SESSION_TOKEN de mcmp (SSO de ARCA): (uid, [CUITs representados]).

        El token trae `<login ... uid="CUIT"><relations>CUIT</relations>…`: `uid` = el CUIT que se
        logueó; `relations` = a quién representa. Sirve para detectar 'titular que representa a otros'
        de forma confiable, sin scrapear. Devuelve (None, []) si no hay token o no se pudo leer."""
        import base64

        tok = self.session.cookies.get("SESSION_TOKEN", domain=".fes.afip.gob.ar")
        if not tok:
            return None, []
        try:
            xml = base64.b64decode(tok).decode("utf-8", "replace")
            muid = re.search(r'uid="(\d+)"', xml)
            rels = re.findall(r"<relations>(\d+)</relations>", xml)
            return (muid.group(1) if muid else None), rels
        except Exception:  # noqa: BLE001
            return None, []

    @property
    def fes_vigente(self) -> bool:
        """True si la sesión de fes sigue válida (con 30s de margen)."""
        return time.time() < (self.fes_exp - 30)

    def _abrir_o_relogin(self) -> None:
        """Cascada de recuperación: reabrir con el portal; si murió, re-login.

        Nivel 2: usar AFIPSID (portal) para reabrir el servicio (token+sign nuevo).
        Nivel 3: si el portal también expiró, login() completo y reabrir.
        """
        if not self.logged_in:
            self.login()
        try:
            self.abrir_servicio("mcmp")  # nivel 2
        except (AFIPError, requests.RequestException) as e:
            self.log.warning("Reapertura falló (%s). Re-login completo.", e)
            self.logged_in = False
            self.login()                 # nivel 3
            self.abrir_servicio("mcmp")

    def _fes_get(self, url: str, **kw):
        """GET a fes respetando el gap mínimo anti-bot."""
        espera = self._min_gap - (time.time() - self._last_fes)
        if espera > 0:
            time.sleep(espera)
        try:
            return self.session.get(url, **kw)
        finally:
            self._last_fes = time.time()

    def _mcmp_preparar(self, *, forzar: bool = False) -> None:
        """Abre el servicio mcmp (si hace falta) y fija el contribuyente.

        setearContribuyente.do enlaza el CUIT a la sesión del servidor de fes;
        sin esto los ajax.do devuelven 'sesión expirada'. El id es el ÍNDICE de la
        persona a operar (ver _idcontribuyente_objetivo): 0 = uno mismo en cuentas
        sin representados; el índice del titular si la cuenta representa a otros.
        `forzar=True` reabre el servicio (nuevo token+sign), necesario para
        recuperarse de un bloqueo 'BL' que invalida la sesión de fes.

        Decide por vencimiento, no por prueba-y-error: si la sesión de fes ya
        venció (o falta <30s), reabre directo sin gastar una request condenada.
        """
        if forzar or not self.fes_vigente or self._fes_servicio != "mcmp":
            self._abrir_o_relogin()  # resetea _contribuyente_set y fes_exp
        if not self._contribuyente_set:
            idc = self._idcontribuyente_objetivo()
            r = self._fes_get(f"{FES_BASE}/setearContribuyente.do?idContribuyente={idc}")
            self._chequear_irregularidades(r.text)
            self._contribuyente_set = True

    @staticmethod
    def _chequear_irregularidades(html: str) -> None:
        """Levanta ContribuyenteIrregularError si setearContribuyente devolvió la pantalla de error de
        ARCA por irregularidades en el padrón ("La CUIT ... registra irregularidades. Deberá dirigirse
        a la dependencia... Err: 002"). Es lo que hace fallar después a generarConsulta con el mensaje
        críptico 'Rango de fechas inválido': el contribuyente no quedó habilitado para la consulta.
        Las firmas ("registra irregularidades", "Err: 002") no tienen acentos → la búsqueda es inmune
        al encoding (la página viene en iso-8859-1)."""
        if re.search(r"registra\s+irregularidades", html, re.I) or "Err: 002" in html:
            raise ContribuyenteIrregularError(
                "El cliente registra irregularidades en su inscripción fiscal. Debe regularizar su "
                "situación en la dependencia donde se encuentra inscripto para poder consultar su "
                "información."
            )

    def _idcontribuyente_objetivo(self) -> str:
        """Índice de contribuyente para setearContribuyente.do.

        Cuando la clave representa a varias personas, Mis Comprobantes intercala la
        pantalla 'Elegí una persona' y setearContribuyente espera el ÍNDICE de la
        elegida (0,1,…), NO su CUIT. Fijar siempre 0 caía en el PRIMER representado
        (no el titular); al consultar luego los comprobantes del titular, ARCA
        devolvía 'Error DB'. Acá leemos la pantalla y devolvemos el índice de la
        tarjeta cuyo CUIT es el titular (self.cuit).

        Sin pantalla de selección (representación única, el caso normal) no hay
        tarjetas y devolvemos '0' (= uno mismo). Si hay selección pero no ubicamos
        la tarjeta del titular (formatos atípicos, p. ej. sucesiones) también '0':
        la consulta fallará y el motor caerá al navegador, que sí resuelve esos casos.
        """
        try:
            html = self._fes_get(f"{FES_BASE}/seleccionIngreso.do").text
        except (requests.RequestException, AFIPError):
            return "0"
        primary = None
        for m in re.finditer(
            r'<a class="(panel[^"]*)"[^>]*onclick="([^"]+)"[^>]*>(.*?)</a>', html, re.S | re.I
        ):
            clase, onclick, inner = m.group(1), m.group(2), m.group(3)
            val = re.search(r"value='(\d+)'", onclick)
            if not val:
                continue
            if self.cuit in re.sub(r"\D", "", inner):  # la tarjeta del titular
                return val.group(1)
            if primary is None and "border-primary" in clase:  # respaldo: la destacada
                primary = val.group(1)
        return primary or "0"

    @staticmethod
    def _fmt_fecha(f) -> str:
        if isinstance(f, (_dt.date, _dt.datetime)):
            return f.strftime("%d/%m/%Y")
        return str(f)

    def _ajax_json(self, params: dict, referer: str, retries: int = 4) -> dict:
        """GET a ajax.do devolviendo JSON, con recuperación ante fallos transitorios de fes.

        Dos casos se recuperan reabriendo el servicio (nuevo token+sign) y reintentando:
          - Anti-bot: fes responde 'BL<digits>' (no-JSON) y a partir de ahí invalida la sesión.
          - Sesión vencida server-side: la grilla dura ~15 min y ARCA a veces la corta antes de
            lo que cree `fes_vigente`; devuelve {estado:'error', mensajeError:'...sesión ha
            expirado' / 'no está logueado' / 'Error DB'}. Sin esto, una consulta a mitad de un
            sync largo (entre ventanas) fallaba sin recuperarse (era el fallo #1 del motor HTTP).
        Un error JSON que NO sea de sesión se devuelve tal cual (lo interpreta el caller).
        """
        hdr = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": referer,
        }
        last = ""
        for intento in range(retries):
            r = self._fes_get(f"{FES_BASE}/ajax.do", headers=hdr, params=params)
            try:
                data = r.json()
            except ValueError:
                last = r.text[:80]  # no-JSON (bloqueo BL)
            else:
                msg = str(data.get("mensajeError", "")) if isinstance(data, dict) else ""
                if not (isinstance(data, dict) and data.get("estado") == "error"
                        and re.search(r"sesi[oó]n|logueado|expir|Error DB", msg, re.I)):
                    return data  # OK, o un error que NO es de sesión (lo maneja el caller)
                last = msg  # sesión vencida / transitorio de ARCA
            espera = 3 * (intento + 1)
            self.log.warning(
                "ajax.do %s transitorio (%r). Reabro sesión mcmp y reintento en %ss",
                params.get("f"), last, espera,
            )
            time.sleep(espera)
            self._mcmp_preparar(forzar=True)
            self._fes_get(referer)
        raise AFIPError(f"ajax.do {params.get('f')} sin recuperar tras {retries}: {last!r}")

    @staticmethod
    def _parse_fila(row: list, tipo: str = "E") -> dict:
        d = {nombre: row[i] for i, nombre in MCMP_COLS.items() if i < len(row)}
        i_cot, i_mon = MCMP_MONEDA.get(tipo, MCMP_MONEDA["E"])
        d["tipo_cambio"] = row[i_cot] if i_cot < len(row) else None
        d["moneda"] = row[i_mon] if i_mon < len(row) else None
        # el total es el último valor no nulo (la fila termina en total + un None)
        d["imp_total"] = next((v for v in reversed(row) if v not in (None, "")), None)
        d["_raw"] = row
        return d

    def consultar_comprobantes(
        self,
        desde,
        hasta,
        *,
        tipo: str = "E",
        cuit_consultada: str | None = None,
        tipos_comprobantes: str = "",
        timeout: int = 30,
    ) -> list[dict]:
        """Consulta comprobantes en Mis Comprobantes.

        Args:
            desde, hasta: fecha (datetime.date o 'dd/mm/yyyy') del rango de emisión.
            tipo: 'E' = emitidos, 'R' = recibidos.
            cuit_consultada: por defecto el CUIT logueado.
            tipos_comprobantes: filtro opcional de tipos (vacío = todos).
            timeout: segundos máx. esperando que la consulta procese.

        Flujo mínimo (2 ajax.do; sin GET de página ni estimarResultados):
            generarConsulta -> idConsulta  (estado 'PE' = pendiente)
            listaResultados -> filas (formato DataTables). Si la consulta sigue
              'PE' (rangos grandes), se reintenta este mismo endpoint.

        El header Referer alcanza como contexto de pantalla; no hace falta el GET
        de comprobantesEmitidos/Recibidos.do.

        Devuelve lista de dicts (columnas mapeadas + '_raw' con la fila completa).
        """
        self._mcmp_preparar()
        cuit = cuit_consultada or self.cuit
        page = "comprobantesEmitidos.do" if tipo == "E" else "comprobantesRecibidos.do"
        referer = f"{FES_BASE}/{page}"

        rango = f"{self._fmt_fecha(desde)} - {self._fmt_fecha(hasta)}"
        self.log.info("Consulta %s | %s | CUIT %s", tipo, rango, cuit)

        # 1) generar
        gen = self._ajax_json(
            {
                "f": "generarConsulta",
                "t": tipo,
                "fechaEmision": rango,
                "tiposComprobantes": tipos_comprobantes,
                "cuitConsultada": cuit,
            },
            referer,
        )
        if gen.get("estado") != "ok":
            raise AFIPError(f"generarConsulta falló: {gen}")
        qid = gen["datos"]["idConsulta"]

        # 2) listar. La primera llamada ya trae los datos (aunque consulta quede
        #    'PE'). Solo si viene vacía y pendiente, kickeamos con estimarResultados
        #    y reintentamos (rangos grandes con paginado server-side).
        def _listar():
            r = self._ajax_json(
                {"f": "listaResultados", "id": qid, "_": str(int(time.time() * 1000))},
                referer,
            )
            if r.get("estado") != "ok":
                raise AFIPError(f"listaResultados falló: {r}")
            return r

        lista = _listar()
        filas = lista.get("datos", {}).get("data", [])
        if not filas and lista["datos"].get("consulta", {}).get("estado") == "PE":
            deadline = time.time() + timeout
            while time.time() < deadline:
                self._ajax_json({"f": "estimarResultados", "id": qid}, referer)
                lista = _listar()
                filas = lista.get("datos", {}).get("data", [])
                if filas or lista["datos"].get("consulta", {}).get("estado") != "PE":
                    break
                time.sleep(1)

        self.log.info("  %s comprobantes", lista.get("recordsTotal") or len(filas))
        return [self._parse_fila(f, tipo) for f in filas]

    # --- API alta: períodos y ambos tipos -----------------------------------
    @staticmethod
    def _a_fecha(v) -> _dt.date:
        if isinstance(v, _dt.datetime):
            return v.date()
        if isinstance(v, _dt.date):
            return v
        return _dt.datetime.strptime(str(v), "%d/%m/%Y").date()

    def _ventanas(self, periodo, desde, hasta, piso_historico) -> list[tuple]:
        """Resuelve un período en una lista de ventanas (desde, hasta) <=365 días.

        - desde/hasta explícitos -> una sola ventana (asume <=365 días).
        - periodo 'mes'  -> últimos 30 días.
        - periodo 'anio' -> últimos 365 días.
        - periodo 'historico' -> desde `piso_historico` hasta hoy, troceado en
          ventanas de 365 días (el tope que acepta MCMP).
        """
        hoy = _dt.date.today()
        if desde and hasta:
            return [(self._a_fecha(desde), self._a_fecha(hasta))]
        p = (periodo or "mes").lower()
        if p in ("mes", "month"):
            return [(hoy - _dt.timedelta(days=30), hoy)]
        if p in ("anio", "año", "year", "anual"):
            return [(hoy - _dt.timedelta(days=364), hoy)]
        if p in ("historico", "histórico", "all", "todo"):
            piso = self._a_fecha(desde or piso_historico)
            ventanas, h = [], hoy
            while h > piso:
                d = max(piso, h - _dt.timedelta(days=364))
                ventanas.append((d, h))
                h = d - _dt.timedelta(days=1)
            return ventanas
        raise AFIPError(f"Período desconocido: {periodo!r}")

    def _historico(self, tipo, piso, vacias_corte, timeout) -> list:
        """Camina ventanas de 365 días hacia atrás hasta el inicio de la cuenta.

        Como AFIP no expone una 'fecha de inicio', se detecta sola: baja ventana
        por ventana y corta tras `vacias_corte` ventanas vacías consecutivas
        (default 2, para tolerar un año aislado sin comprobantes). El `piso` es
        la red de seguridad por si nunca aparece el vacío.
        """
        hoy = _dt.date.today()
        res, vacias, h = [], 0, hoy
        while h > piso:
            d = max(piso, h - _dt.timedelta(days=364))
            filas = self.consultar_comprobantes(d, h, tipo=tipo, timeout=timeout)
            res.extend(filas)
            if filas:
                vacias = 0
            else:
                vacias += 1
                if vacias >= vacias_corte:
                    self.log.info(
                        "Histórico %s: %d ventanas vacías seguidas, corto en %s",
                        tipo, vacias, d,
                    )
                    break
            h = d - _dt.timedelta(days=1)
        return res

    def consultar(
        self,
        *,
        tipo: str = "ER",
        periodo: str | None = "mes",
        desde=None,
        hasta=None,
        piso_historico: str = "2016-01-01",
        vacias_corte: int = 2,
        timeout: int = 30,
    ) -> dict[str, list]:
        """Consulta de alto nivel: uno o ambos tipos, por período o fechas.

        Args:
            tipo: 'E' (emitidos), 'R' (recibidos) o 'ER' (ambos).
            periodo: 'mes' | 'anio' | 'historico' (ignorado si pasás desde/hasta).
            desde, hasta: fechas explícitas (date o 'dd/mm/yyyy'). Para 'historico'
                podés pasar `desde` como piso en vez de piso_historico.
            piso_historico: fecha mínima absoluta para 'historico' ('YYYY-MM-DD').
            vacias_corte: en 'historico', corta tras N ventanas vacías seguidas
                (auto-detecta el inicio de la cuenta sin llegar al piso).

        Todo es SECUENCIAL y paceado (el WAF de fes bloquea si va en paralelo).
        Las consultas comparten la sesión de fes mientras siga vigente.

        Devuelve {'E': [...], 'R': [...]} solo con los tipos pedidos.
        """
        tipos = [t for t in ("E", "R") if t in tipo.upper()]
        if not tipos:
            raise AFIPError("tipo debe contener 'E', 'R' o ambos ('ER').")

        es_hist = (periodo or "").lower() in ("historico", "histórico", "all", "todo") \
            and not (desde and hasta)

        out: dict[str, list] = {t: [] for t in tipos}
        if es_hist:
            piso = self._a_fecha(desde or piso_historico) if not isinstance(piso_historico, str) \
                else _dt.datetime.strptime(piso_historico, "%Y-%m-%d").date()
            if desde:
                piso = self._a_fecha(desde)
            for t in tipos:
                out[t] = self._historico(t, piso, vacias_corte, timeout)
        else:
            ventanas = self._ventanas(periodo, desde, hasta, None)
            for t in tipos:
                for d, h in ventanas:
                    out[t].extend(self.consultar_comprobantes(d, h, tipo=t, timeout=timeout))
        return out

    # --- Monotributo (admin_mono) -------------------------------------------
    # monotributo.afip.gob.ar (ASP.NET). Flujo mínimo: abrir_servicio (token+sign
    # a default.aspx) + GET Inicio.aspx. Parsea el dashboard del panel de inicio.
    # SE PUEDE leer (categoría, facturómetro, vencimiento, topes); NO operar.
    @staticmethod
    def _money_ar(s: str | None) -> float | None:
        """'8.480.062,55' -> 8480062.55"""
        if not s:
            return None
        s = s.strip().replace(".", "").replace(",", ".")
        try:
            return float(s)
        except ValueError:
            return None

    def _mono_adherido(self) -> bool | None:
        """¿El CUIT tiene adherido el servicio Monotributo? True/False, o None si no
        se pudo determinar. Lee el metadata del portal (NO espera el SSO de mono)."""
        try:
            r = self.session.get(
                f"{URL_PORTAL_API}/{self.cuit}/servicio/admin_mono",
                headers={"Accept": "application/json, text/plain, */*", "Referer": URL_PORTAL_APP},
            )
            return r.json().get("adherido")
        except Exception:  # noqa: BLE001
            return None

    def _facturometro_ajax(self) -> dict:
        """AJAX CalcularFacturacion: el dato AUTORITATIVO del facturómetro (el dashboard
        lo llena por JS; el span estático del HTML es flaky → a veces 0). Devuelve el
        dict 'd' (valor, valorTope, categoria, fechas, montoFacturadoAncho, alertaVisible,
        peligroVisible, fechaActualizacion) o {} si falla. Reintenta si viene 'pendiente'."""
        d: dict = {}
        for _ in range(4):
            try:
                r = self.session.post(
                    f"{MONO_BASE}/Inicio.aspx/CalcularFacturacion",
                    data="{}",
                    headers={
                        "Content-Type": "application/json; charset=utf-8",
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": MONO_SELEC,
                    },
                )
                d = r.json().get("d") or {}
            except Exception:  # noqa: BLE001
                d = {}
            if d and not d.get("pendiente"):
                return d
            time.sleep(1.5)
        return d

    def _mono_elegir_representado(self, html: str) -> tuple[str, str]:
        """Elige el contribuyente propio en la grilla de SelecRepresentado (claves que
        representan a VARIOS). Replica el JS del panel (`#hID = usr; #btnAcceder.click()`)
        con un POST ASP.NET. Devuelve (html, url) del resultado (Inicio.aspx o vRut.aspx);
        si no había grilla o el POST falla, devuelve (html, '')."""
        if "ContentPlaceHolder1$hID" not in html:
            return html, ""
        data: dict = {}
        for m in re.finditer(r'<input\b[^>]*\btype="hidden"[^>]*>', html, re.I):
            nm = re.search(r'\bname="([^"]*)"', m.group(0))
            if nm:
                vl = re.search(r'\bvalue="([^"]*)"', m.group(0))
                data[nm.group(1)] = vl.group(1) if vl else ""
        data["ctl00$ContentPlaceHolder1$hID"] = self.cuit
        data["ctl00$ContentPlaceHolder1$btnAcceder"] = ""
        try:
            r = self.session.post(MONO_SELEC, data=data, headers={"Referer": MONO_SELEC})
            return r.text, r.url
        except requests.RequestException:
            return html, ""

    def monotributo(self) -> dict:
        """Abre el servicio Monotributo y devuelve los datos del panel de inicio.

        El SSO de Monotributo tarda ~30-45s en quedar utilizable tras el login (antes
        de eso SelecRepresentado.aspx cae en Error.aspx). Por eso se reintenta el ciclo
        (reabrir servicio + GET SelecRepresentado) con presupuesto holgado hasta que
        aparece la categoría. Atajo: el metadata del portal dice si el CUIT está
        adherido al Monotributo; si no lo está, corta sin esperar (no es monotributista).

        Devuelve un dict con: categoria (letra A–K), actividad (comercio/servicios),
        prox_recategorizacion, facturómetro (monto/tope/%), proximo_vencimiento,
        debito_automatico, monotributo_unificado, periodo_vencido, cuit_titular y
        es_monotributista (bool):
            True  -> hay categoría real en el panel (es monotributista).
            False -> el panel cargó pero sin categoría: NO es monotributista (no nos
                     importa qué régimen es —RI/exento/etc.—, sólo que no es monotributo).
        Si Inicio.aspx no cargó como tal, levanta AFIPError (fallo transitorio de
        ARCA) para que el caller reintente, en vez de rotular mal el régimen.
        """
        if not self.logged_in:
            self.login()

        # Atajo: ¿adherido al Monotributo? Si NO, no es monotributista y cortamos sin
        # esperar el SSO (evita el wait de abajo para RI/exentos).
        adherido = self._mono_adherido()
        if adherido is False:
            self.log.info("Monotributo: servicio no adherido -> no es monotributista.")
            return {"categoria": None, "actividad": None, "es_monotributista": False}

        # El contexto del SSO de mono tarda ~30-45s en quedar utilizable tras el login.
        # Reintentamos el ciclo COMPLETO (reabrir servicio + GET SelecRepresentado) con
        # presupuesto holgado, hasta que aparece la categoría (marcador de panel cargado).
        html = ""
        cargo = False
        deadline = time.time() + 75
        intento = 0
        while time.time() < deadline:
            html, url = "", ""
            try:
                self.abrir_servicio("admin_mono")
                resp = self.session.get(MONO_SELEC)  # arma contexto -> dashboard
                html, url = resp.text, resp.url
            except (AFIPError, requests.RequestException) as e:
                self.log.debug("Monotributo intento %d: %s", intento, e)
            # Clave que representa a VARIOS contribuyentes: SelecRepresentado muestra una
            # grilla de paneles y NO redirige sola al dashboard -> elegimos el propio
            # (click en su panel = setear hID + btnAcceder), que lleva a Inicio o a vRut.
            if "ContentPlaceHolder1$hID" in html:
                html, url = self._mono_elegir_representado(html)
            # Redirección al Registro Único Tributario (vRut.aspx): NO hay dashboard de
            # Monotributo clásico. Puede ser (a) quien pasó a Responsable Inscripto —ya NO
            # es monotributista— o (b) un monotributista vigente que ARCA migró a la
            # experiencia nueva del RUT. Los desempata `adherido` (metadata del servicio):
            #   - adherido True  -> sigue adherido al Monotributo: ES monotributista, pero
            #     sin panel clásico no leemos categoría/facturómetro (el caller igual trae
            #     la deuda de la CCMA, que sí funciona). No inventamos categoría (queda None).
            #   - adherido False ya cortó arriba (no llega acá); None -> best-effort: no mono.
            if "vRut.aspx" in url or "ARCA | RUT" in html:
                if adherido:
                    self.log.info("Monotributo: RUT (vRut) con servicio adherido -> monotributista sin panel clásico.")
                    return {"categoria": None, "actividad": None, "es_monotributista": True}
                self.log.info("Monotributo: redirige al RUT (vRut) -> no es monotributista.")
                return {"categoria": None, "actividad": None, "es_monotributista": False}
            if "spanFacturometroCategoria" in html or re.search(r"Categor[ií]a\s+[A-K]\s", html):
                cargo = True
                break
            intento += 1
            time.sleep(min(10, 5 + intento * 2))  # 7,9,10,10,... hasta agotar el budget

        if not cargo:
            # Sin categoría tras el presupuesto. Si estaba adherido (es mono), es un
            # fallo transitorio -> AFIPError para que el caller reintente. Si no
            # sabíamos (adherido None), best-effort: no es monotributista.
            if adherido:
                raise AFIPError("Monotributo: el dashboard no cargó tras varios reintentos (transitorio).")
            self.log.info("Monotributo: sin categoría tras el budget -> no es monotributista.")
            return {"categoria": None, "actividad": None, "es_monotributista": False}

        def limpiar(s):
            return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()

        def span(id_):
            m = re.search(rf'id="{id_}"[^>]*>([^<]*)', html)
            return m.group(1).strip() if m else None

        def cuerpo_panel(panel_id):
            """HTML del media-body de un panel (desde su id hasta media-right)."""
            m = re.search(rf'id="{panel_id}"(.*?)<div class="media-right', html, re.S)
            if not m:
                return ""
            mb = re.search(r"media-body[^>]*>(.*)", m.group(1), re.S)
            return mb.group(1) if mb else m.group(1)

        def panel(panel_id):
            cuerpo = cuerpo_panel(panel_id)
            if not cuerpo:
                return None
            tit = re.search(r'id="h3Titulo"[^>]*>(.*?)</h3>', cuerpo, re.S)
            items = [limpiar(li) for li in re.findall(r"<li[^>]*>(.*?)</li>", cuerpo, re.S)]
            # texto sin los <li> (para no duplicar)
            sin_li = re.sub(r"<li[^>]*>.*?</li>", " ", cuerpo, flags=re.S)
            return {
                "titulo": limpiar(tit.group(1)) if tit else None,
                "texto": limpiar(sin_li),
                "items": items or None,
            }

        # facturómetro: el dato AUTORITATIVO sale del AJAX CalcularFacturacion (el
        # dashboard lo llena por JS; el span estático es flaky → a veces 0).
        fac = self._facturometro_ajax()
        mpct = re.search(r"\d+", fac.get("montoFacturadoAncho") or "")
        pct_usado = int(mpct.group()) if mpct else None

        # próximo vencimiento
        venc_fecha = venc_importe = None
        mv = re.search(
            r"vencimiento es el\s*([\d\-a-zA-Z]+)\s*y el importe a pagar es\s*\$([\d.,]+\d)", html
        )
        if mv:
            venc_fecha, venc_importe = mv.group(1), mv.group(2)

        # monotributo unificado (impuestos locales) acotado a su panel
        unif = panel("tRegimenUnificado")
        unificado = unif["items"] if unif else None

        # categoría + actividad: la tarjeta trae "Categoría <X> <desc>" (X = letra
        # A–K). La actividad se deriva de la descripción (comercio si es venta de
        # bienes/muebles; si no, servicios). Es la fuente que el padrón usa como
        # categoría autoritativa.
        cat_letra = actividad = None
        mcat = re.search(r"Categor[ií]a\s+([A-K])\s+([^<]+?)\s*</strong>", html)
        if mcat:
            cat_letra = mcat.group(1).strip()
            act = mcat.group(2).upper()
            actividad = (
                "comercio" if ("VENTA" in act or "BIEN" in act or "MUEBLE" in act)
                else "servicios"
            )

        # próxima recategorización (panel divProxRecategorizacion)
        prox_recat = None
        mrec = re.search(
            r'id="divProxRecategorizacion".*?<strong>\s*(.*?)\s*</strong>', html, re.S | re.I
        )
        if mrec:
            prox_recat = " ".join(mrec.group(1).split())

        # CUIT del titular mostrado en el panel (sanity check de a quién leímos)
        mcuit = re.search(r'id="hidCUITContribuyente"\s+value="(\d+)"', html)
        cuit_titular = mcuit.group(1) if mcuit else None

        # débito automático: la tarjeta #tDebitoAutomatico ofrece "Adherirme" cuando
        # NO está adherido; si ya lo está, no invita a adherirse -> se infiere por
        # ausencia del CTA. Sin tarjeta -> None (desconocido, no pisar).
        debito = None
        mdeb = re.search(
            r'id="tDebitoAutomatico".*?(?=<div id="t[A-Za-z]|</body)', html, re.S | re.I
        )
        if mdeb:
            debito = "adherirme" not in mdeb.group(0).lower()

        # alertas de tope (display:none = no se muestra)
        def alerta(div_id):
            m = re.search(rf'id="{div_id}"[^>]*style="([^"]*)"', html)
            return bool(m) and "display: none" not in (m.group(1) if m else "")

        datos = {
            # la tarjeta de categoría es la fuente autoritativa; el span del
            # facturómetro queda de respaldo por si la tarjeta no parseó.
            "categoria": cat_letra or span("spanFacturometroCategoria"),
            "actividad": actividad,
            "prox_recategorizacion": prox_recat,
            "cuit_titular": cuit_titular,
            "debito_automatico": debito,
            "periodo": fac.get("fechas") or span("spanFacturometroFecha"),
            "monto_facturado": self._money_ar(fac.get("valor")),
            "monto_facturado_raw": fac.get("valor"),
            "tope_categoria": self._money_ar(fac.get("valorTope")),
            "tope_categoria_raw": fac.get("valorTope"),
            "porcentaje_usado": pct_usado,
            "ultima_actualizacion": fac.get("fechaActualizacion"),
            "proximo_vencimiento": {
                "fecha": venc_fecha,
                "importe": self._money_ar(venc_importe),
                "importe_raw": venc_importe,
            },
            "supero_tope_categoria": bool(fac.get("alertaVisible")) if fac else alerta("divFacturometroAlerta"),
            "supero_tope_maximo": bool(fac.get("peligroVisible")) if fac else alerta("divFacturometroPeligro"),
            "monotributo_unificado": unificado,
            "periodo_vencido": panel("tPagoCordoba"),
        }
        # Régimen: con categoría real => monotributista (señal autoritativa del
        # padrón). Si llegamos hasta acá siempre hubo categoría (el caso 'sin
        # categoría' retorna antes), así que es_monotributista es True.
        datos["es_monotributista"] = bool(datos["categoria"])
        self.log.info(
            "Monotributo: cat %s (%s) | facturado %s / tope %s (%s%%) | recat %s | vence %s $%s",
            datos["categoria"], actividad, datos["monto_facturado_raw"],
            datos["tope_categoria_raw"], datos["porcentaje_usado"], prox_recat,
            venc_fecha, venc_importe,
        )
        return datos

    # --- Administración de Certificados Digitales (arfe_certificado) ---------
    # serviciosweb.afip.gob.ar (ASP.NET WebForms, navegación por postback/__VIEWSTATE).
    # SE PUEDE: listar, detalle, descargar .crt, generar CSR local, crear (ciclo
    # completo certificados_crear). NO: revocar/eliminar. (Detalle de páginas más
    # abajo, en el comentario de _cert_preparar.)
    @staticmethod
    def _aspnet_viewstate(html: str) -> str:
        m = _RE_ASPNET_VS.search(html)
        if not m:
            raise AFIPError("No se encontró __VIEWSTATE (ASP.NET).")
        return _html.unescape(m.group(1))

    # Administración de Certificados Digitales (arfe_certificado) en serviciosweb.
    # ASP.NET WebForms: navegación por postback (__EVENTTARGET) y __VIEWSTATE.
    # Mapa de páginas:
    #   verCertificado.aspx   -> listado (cada cert: link "Ver" = __doPostBack('_ctlN'))
    #                            + botón "Agregar" (cmdIngresar) -> agregarCertificado
    #   detalleCertificado    -> info del cert + botón Descargar (_ctlNN imagen)
    #   descargaCertificado   -> el .crt (application/x-x509-ca-cert)
    def _tiene_sesion_serviciosweb(self) -> bool:
        return any(
            c.name == "ASP.NET_SessionId" and "serviciosweb" in (c.domain or "")
            for c in self.session.cookies
        )

    def _cert_preparar(self) -> None:
        """Asegura la sesión de serviciosweb en modo CERTIFICADOS.

        Reabre si no hay cookie o si el último servicio abierto en serviciosweb fue
        otro (p. ej. adminrel): comparten ASP.NET_SessionId pero distinto modo SSO.
        """
        if not self._tiene_sesion_serviciosweb() or self._serviciosweb_servicio != "arfe_certificado":
            self.abrir_servicio("arfe_certificado")

    def _adminrel_preparar(self) -> None:
        """Asegura la sesión de serviciosweb en modo RELACIONES (adminrel).

        Mismo criterio que _cert_preparar pero para el otro servicio que comparte
        el dominio: si venía abierto en modo certificados, reabre como adminrel.
        """
        if not self._tiene_sesion_serviciosweb() or self._serviciosweb_servicio != "adminrel":
            self.abrir_servicio("adminrel")

    def _cert_lista_html(self) -> str:
        self._cert_preparar()
        r = self.session.get(f"{CERT_BASE}/verCertificado.aspx")
        r.raise_for_status()
        return r.text

    def _cert_postback(self, page, viewstate, *, event_target=None, extra=None):
        """POST de postback ASP.NET (urlencoded) a una página del servicio."""
        data = {}
        if event_target is not None:
            data["__EVENTTARGET"] = event_target
            data["__EVENTARGUMENT"] = ""
        data["__VIEWSTATE"] = viewstate
        if extra:
            data.update(extra)
        return self.session.post(
            f"{CERT_BASE}/{page}",
            data=data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://serviciosweb.afip.gob.ar",
                "Referer": f"{CERT_BASE}/{page}",
            },
        )

    @staticmethod
    def _cert_parse_lista(html: str) -> list[dict]:
        """[{'alias','target'}] de la grilla de verCertificado.aspx."""
        out = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
            m = re.search(r"__doPostBack\(['\"](_ctl\d+)['\"]", row)
            if not m:
                continue
            cells = [
                re.sub(r"<[^>]+>", "", c).strip()
                for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S | re.I)
            ]
            alias = cells[0] if cells else ""
            if alias and len(alias) < 60 and "\n" not in alias and "{" not in alias:
                out.append({"alias": alias, "target": m.group(1)})
        return out

    @staticmethod
    def _cert_parse_detalle(html: str) -> dict:
        txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
        def g(pat):
            m = re.search(pat, txt)
            return m.group(1).strip() if m else None
        fechas = re.findall(r"(\d+/\d+/\d+ \d+:\d+:\d+ [AP]M)", txt)
        return {
            "alias": g(r"Alias\s+(\S+)\s+DN"),
            "dn": g(r"DN\s+(.*?)\s+Nro Serie"),
            "serie": g(r"\b([0-9a-fA-F]{8,})\s+\d+/\d+/\d+"),
            "emision": fechas[0] if len(fechas) > 0 else None,
            "vencimiento": fechas[1] if len(fechas) > 1 else None,
            "estado": g(r"\b(VALIDO|REVOCADO|VENCIDO|ANULADO)\b"),
        }

    def certificados_listar(self) -> list[dict]:
        """Lista los certificados de la cuenta: [{'alias','target'}]."""
        certs = self._cert_parse_lista(self._cert_lista_html())
        self.log.info("Certificados: %d en la cuenta", len(certs))
        return certs

    def certificados_detalle(self, alias: str, *, lista_html: str | None = None) -> dict:
        """Info de un certificado (alias, DN, serie, fechas, estado).

        Navega: verCertificado (lista) -> postback del cert -> detalleCertificado.
        Incluye '_html' (detalle) para reutilizar en la descarga sin re-navegar.
        """
        lista_html = lista_html or self._cert_lista_html()
        item = next(
            (c for c in self._cert_parse_lista(lista_html) if c["alias"] == alias), None
        )
        if not item:
            disp = [c["alias"] for c in self._cert_parse_lista(lista_html)]
            raise AFIPError(f"No existe el certificado '{alias}'. Hay: {disp}")
        det = self._cert_postback(
            "verCertificado.aspx",
            self._aspnet_viewstate(lista_html),
            event_target=item["target"],
        )
        det.raise_for_status()
        info = self._cert_parse_detalle(det.text)
        info["_html"] = det.text
        return info

    def certificados_descargar(self, alias: str, *, guardar_en=None, lista_html=None) -> dict:
        """Descarga el .crt de un certificado. Devuelve info + 'cert_pem' (+ 'archivo').

        Navega detalle -> botón Descargar (_ctlNN imagen) -> descargaCertificado.aspx
        (que responde el certificado PEM directo).
        """
        info = self.certificados_detalle(alias, lista_html=lista_html)
        det_html = info.pop("_html")
        m = re.search(r'<input[^>]*type="image"[^>]*name="(_ctl\d+)"', det_html)
        if not m:
            raise AFIPError("No encontré el botón Descargar en el detalle.")
        dl = m.group(1)
        r = self._cert_postback(
            "detalleCertificado.aspx",
            self._aspnet_viewstate(det_html),
            extra={f"{dl}.x": "12", f"{dl}.y": "11"},
        )
        r.raise_for_status()
        if b"BEGIN CERTIFICATE" not in r.content:
            raise AFIPError("La descarga no devolvió un certificado PEM.")
        cd = r.headers.get("Content-Disposition", "")
        fn = re.search(r"filename=([^;]+)", cd)
        info["filename"] = fn.group(1).strip() if fn else f"{alias}.crt"
        info["cert_pem"] = r.content
        if guardar_en:
            import os
            path = (
                os.path.join(guardar_en, info["filename"])
                if os.path.isdir(guardar_en) else guardar_en
            )
            with open(path, "wb") as f:
                f.write(r.content)
            info["archivo"] = path
            self.log.info("Certificado guardado en %s", path)
        return info

    def generar_csr(self, alias: str, organizacion: str, *, key_size: int = 2048):
        """Genera (clave_privada_pem, csr_pem) para pedir un certificado a AFIP.

        El CSR va en formato PKCS#10 con el subject que espera AFIP:
            C=AR, O=<organizacion>, CN=<alias>, serialNumber=CUIT <cuit>.
        GUARDÁ la clave privada: AFIP nunca la ve y la vas a necesitar con el .crt.
        Esto es 100% local, no toca AFIP.
        """
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography import x509
        from cryptography.x509.oid import NameOID

        key = rsa.generate_private_key(public_exponent=65537, key_size=key_size)
        subject = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "AR"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, organizacion),
            x509.NameAttribute(NameOID.COMMON_NAME, alias),
            x509.NameAttribute(NameOID.SERIAL_NUMBER, f"CUIT {self.cuit}"),
        ])
        csr = (
            x509.CertificateSigningRequestBuilder()
            .subject_name(subject)
            .sign(key, hashes.SHA256())
        )
        key_pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
        csr_pem = csr.public_bytes(serialization.Encoding.PEM)
        return key_pem, csr_pem

    def certificados_agregar(self, alias: str, csr_pem) -> str:
        """Sube el CSR (multipart) para dar de alta un certificado. Devuelve la lista.

        ⚠️ Crea un certificado REAL en la cuenta (reversible borrándolo después).

        Navega: lista -> botón Agregar (cmdIngresar) -> agregarCertificado.aspx,
        y postea multipart con __VIEWSTATE, txtAliasCertificado, archivo (.csr) y
        cmdIngresar.x/.y. Devuelve el HTML del listado posterior (con el nuevo cert).
        """
        if isinstance(csr_pem, str):
            csr_pem = csr_pem.encode()
        lista_html = self._cert_lista_html()
        # botón "Agregar" -> agregarCertificado.aspx
        self._cert_postback(
            "verCertificado.aspx",
            self._aspnet_viewstate(lista_html),
            extra={"cmdIngresar.x": "66", "cmdIngresar.y": "16"},
        )
        r = self.session.get(
            f"{CERT_BASE}/agregarCertificado.aspx",
            headers={"Referer": f"{CERT_BASE}/verCertificado.aspx"},
        )
        r.raise_for_status()
        vs = self._aspnet_viewstate(r.text)

        files = {
            "__VIEWSTATE": (None, vs),
            "txtAliasCertificado": (None, alias),
            "archivo": (f"{alias}.csr", csr_pem, "application/octet-stream"),
            "cmdIngresar.x": (None, "66"),
            "cmdIngresar.y": (None, "16"),
        }
        self.log.info("Certificados: subiendo CSR (alias=%s)", alias)
        out = self.session.post(
            f"{CERT_BASE}/agregarCertificado.aspx",
            files=files,
            headers={
                "Origin": "https://serviciosweb.afip.gob.ar",
                "Referer": f"{CERT_BASE}/agregarCertificado.aspx",
            },
            allow_redirects=True,
        )
        out.raise_for_status()
        # La respuesta suele ser ya el listado; si no, lo pedimos.
        if "__doPostBack" not in out.text:
            out = self.session.get(f"{CERT_BASE}/verCertificado.aspx")
        return out.text

    def certificados_crear(self, alias: str, organizacion: str, *, guardar_en=None) -> dict:
        """Ciclo completo: genera CSR -> da de alta -> trae info -> descarga el .crt.

        Devuelve dict con: alias, dn, serie, emision, vencimiento, estado,
        filename, cert_pem y key_pem (¡guardá la clave privada!).
        Si `guardar_en` es un directorio, escribe <alias>.key y el .crt ahí.
        """
        key_pem, csr_pem = self.generar_csr(alias, organizacion)
        lista_html = self.certificados_agregar(alias, csr_pem)  # crea (1 sola vez)
        # Reusa la lista recién devuelta: info + descarga sin re-navegar de más.
        res = self.certificados_descargar(alias, guardar_en=guardar_en, lista_html=lista_html)
        res["key_pem"] = key_pem
        res["csr_pem"] = csr_pem
        if guardar_en:
            import os
            if os.path.isdir(guardar_en):
                kp = os.path.join(guardar_en, f"{alias}.key")
                with open(kp, "wb") as f:
                    f.write(key_pem)
                res["archivo_key"] = kp
                self.log.info("Clave privada guardada en %s", kp)
        return res

    @staticmethod
    def _cert_key_matchean(cert_pem, key_pem) -> bool:
        """¿El cert descargado corresponde a NUESTRA clave? (misma clave pública). Si
        no, el alias ya existía en ARCA con OTRA clave → el cert bajado no sirve para
        firmar (WSAA daría 'firma inválida')."""
        from cryptography import x509
        from cryptography.hazmat.primitives import serialization

        try:
            cb = cert_pem if isinstance(cert_pem, bytes) else (cert_pem or "").encode()
            kb = key_pem if isinstance(key_pem, bytes) else (key_pem or "").encode()
            c = x509.load_pem_x509_certificate(cb)
            k = serialization.load_pem_private_key(kb, password=None)
            return c.public_key().public_numbers() == k.public_key().public_numbers()
        except Exception:  # noqa: BLE001
            return False

    def bootstrap_certificado(
        self, *, organizacion: str = "ORBITA", alias_base: str = "orbita",
        ws: str = "wsfe", max_aliases: int = 8, on_progress=None,
    ) -> dict:
        """Ciclo COMPLETO del certificado para facturar (WSFEv1) en UN método: crea el
        cert y lo asocia al Web Service. Equivale al bootstrap_cliente del scraper viejo
        (Fases A+B+C). Prueba la serie de alias (alias_base, alias_base2, …) hasta bajar
        un cert que CORRESPONDA a la clave generada —un alias ya existente en ARCA con
        otra clave baja un cert que no matchea y se descarta— y luego hace la Fase B
        (asociar el alias al `ws`, por defecto Facturación Electrónica). Devuelve el dict
        de certificados_crear + 'alias'.

        ⚠️ Crea un certificado REAL en la cuenta (reversible borrándolo en ARCA).
        """
        def prog(pct, msg):
            if on_progress:
                on_progress(pct, msg)

        # Aliases ya creados en ARCA: NO los tocamos (subir un CSR a un alias ajeno
        # arriesga pisar/confundir su cert) → creamos en el primero LIBRE de la serie.
        try:
            existentes = {c.get("alias") for c in self.certificados_listar()}
        except AFIPError as e:
            # El CUIT no tiene adherido 'Administración de Certificados Digitales' (sin él no
            # se puede crear el cert). Lo adherimos solos y reintentamos → facturación llave en
            # mano también para esas cuentas. Otros AFIPError (red, etc.) se propagan normal.
            if "arfe_certificado" not in str(e) or "no está disponible" not in str(e):
                raise
            prog(30, "Habilitando la administración de certificados…")
            self.adminrel_adherir_servicio("web://arfe_certificado")
            existentes = {c.get("alias") for c in self.certificados_listar()}
        ultimo = ""
        for i in range(max_aliases):
            alias = alias_base if i == 0 else f"{alias_base}{i + 1}"
            if alias in existentes:
                ultimo = f"{alias}: ya existe en ARCA"
                continue
            prog(40, f"Creando el certificado ({alias})…")
            try:
                res = self.certificados_crear(alias, organizacion)
            except (AFIPError, requests.RequestException) as e:
                ultimo = f"{alias}: {e}"
                self.log.warning("Cert alias %s falló (%s); pruebo el siguiente", alias, e)
                continue
            # Belt-and-suspenders: el cert bajado debe corresponder a la clave generada.
            if not self._cert_key_matchean(res.get("cert_pem", b""), res.get("key_pem", b"")):
                ultimo = f"{alias}: el cert no corresponde a la clave"
                self.log.info("Cert de '%s' no matchea la clave; pruebo el siguiente", alias)
                continue
            prog(80, "Autorizando el servicio…")
            self.adminrel_asociar_computador(alias, ws=ws)  # Fase B
            res["alias"] = alias
            prog(100, "Certificado listo")
            self.log.info("Certificado '%s' creado y asociado a %s", alias, ws)
            return res
        raise AFIPError(
            f"No obtuve un certificado válido para {self.cuit}: los alias '{alias_base}…' "
            f"ya existen en ARCA con otra clave. Último: {ultimo}"
        )

    # --- Administrador de Relaciones: representados -------------------------
    # Servicio adminrel en serviciosweb (misma app que los certificados, pero OTRO
    # SSO). El POST de SSO a default.aspx redirige a selectAuthority.aspx, que trae
    # el combo "Autoridad de Aplicación" (id ...cmbCont) con los CUITs que el
    # logueado puede operar: él mismo + los representados que le delegaron clave.
    @staticmethod
    def _parse_combo_representados(html: str) -> list[dict]:
        """[{'cuit','nombre'}] del combo de Autoridad de Aplicación (id ...cmbCont).

        Acota al <select> correcto para no agarrar <option> de otros combos; toma
        solo values de 11 dígitos (descarta el '-- Seleccione --'). El texto viene
        como 'RAZON SOCIAL[30-12345678-9]'; sacamos el [CUIT] redundante del final.
        """
        combo = re.search(
            r'<select[^>]*id="[^"]*cmbCont"[^>]*>(.*?)</select>', html, re.S | re.I
        )
        if not combo:
            return []
        reps = []
        for val, txt in re.findall(
            r'<option[^>]*value="(\d{11})"[^>]*>(.*?)</option>',
            combo.group(1), re.S | re.I,
        ):
            nombre = re.sub(r"<[^>]+>", "", _html.unescape(txt)).strip()
            nombre = re.sub(r"\s*\[\d{2}-\d{8}-\d\]\s*$", "", nombre)
            reps.append({"cuit": val, "nombre": nombre})
        return reps

    def representados(self) -> list[dict]:
        """CUITs que el usuario logueado puede operar (él + representados).

        Abre el Administrador de Relaciones (adminrel) y lee el combo de Autoridad
        de Aplicación de selectAuthority.aspx. Sin combo (cuenta sin representados)
        -> solo el titular. Devuelve el mismo formato [{'cuit','nombre'}] que el
        onboarding actual, así que es un reemplazo directo de listar_representados().
        """
        if not self.logged_in:
            self.login()
        self._adminrel_preparar()  # SSO en modo relaciones (redirige a selectAuthority)
        r = self.session.get(f"{CERT_BASE}/selectAuthority.aspx")
        r.raise_for_status()
        reps = self._parse_combo_representados(r.text)
        if not reps:
            reps = [{"cuit": self.cuit, "nombre": f"Titular {self.cuit}"}]
        self.log.info("Representados: %d", len(reps))
        return reps

    def _persona(self, cuit: str | None = None) -> dict:
        """Datos crudos del contribuyente: GET /portal/api/persona/{cuit} -> objeto `data`.
        Cachea por CUIT en la instancia (la misma sync pide nombre y domicilio: un solo HTTP).
        Devuelve {} si no se pudo leer."""
        cuit = str(cuit or self.cuit)
        cache = getattr(self, "_persona_cache", None)
        if cache is None:
            cache = self._persona_cache = {}
        if cuit in cache:
            return cache[cuit]
        try:
            r = self.session.get(
                f"{URL_PORTAL_API_BASE}/persona/{cuit}",
                headers={"Accept": "application/json, text/plain, */*", "Referer": URL_PORTAL_APP},
            )
            d = (r.json() or {}).get("data") or {}
        except Exception:  # noqa: BLE001
            d = {}
        cache[cuit] = d
        return d

    def nombre_contribuyente(self, cuit: str | None = None) -> str | None:
        """Nombre/razón social del contribuyente (el 'Está operando como' que el browser
        leía del navbar). Lo trae del portal: GET /portal/api/persona/{cuit}.
        FISICA -> 'APELLIDO NOMBRE' (formato del padrón); JURIDICA -> razón social.
        Devuelve None si no se pudo (el caller conserva el nombre previo, no lo pisa)."""
        d = self._persona(cuit)
        razon = (d.get("razonSocial") or d.get("denominacion") or "").strip()
        if razon:
            return razon
        nombre = f"{(d.get('apellido') or '').strip()} {(d.get('nombre') or '').strip()}".strip()
        return nombre or None

    def datos_fiscales(self, cuit: str | None = None) -> dict:
        """Domicilio fiscal/comercial del contribuyente (para imprimir el comprobante emitido).
        Lee el `domicilioFiscal` del padrón (mismo /persona que el nombre). Parseo defensivo:
        el portal a veces no trae domicilio → devuelve lo que haya (puede ser {}). Nunca lanza."""
        d = self._persona(cuit)
        dom = d.get("domicilioFiscal") or d.get("domicilio") or {}
        if not isinstance(dom, dict):
            dom = {}

        def _campo(*claves: str) -> str | None:
            for k in claves:
                v = dom.get(k)
                if v not in (None, ""):
                    return str(v).strip()
            return None

        return {
            "domicilio": _campo("direccion", "domicilio", "calle"),
            "localidad": _campo("localidad", "descripcionLocalidad"),
            "provincia": _campo("descripcionProvincia", "provincia"),
            "cod_postal": _campo("codPostal", "codigoPostal", "cp"),
        }

    def _abrir_padron_puc(self, *, forzar: bool = False) -> None:
        """Abre el Sistema Registral (padron-puc-consulta-internet) por SSO una sola vez por sesión."""
        if forzar or not getattr(self, "_padron_puc_abierto", False):
            self.abrir_servicio("padron-puc-consulta-internet")
            self._padron_puc_abierto = True

    def constancia_html(self, cuit: str | None = None) -> str | None:
        """HTML de la Constancia de Inscripción/Opción OFICIAL del contribuyente (Sistema Registral):
        régimen, categoría, impuestos, actividades declaradas + código verificador y vigencia. Sale de
        ConstanciaForwardAction.do → ConstanciaDispatcherAction.do (redirect). Devuelve el HTML ya en
        unicode (el server responde latin-1) o None si no se pudo.

        Sólo TITULAR: ConstanciaForwardAction usa el CUIT de la sesión (los representados requieren el
        flujo de representación de seti, no soportado). En prod la sync es 100% titular."""
        objetivo = str(cuit or self.cuit)
        url = f"{SETI_PADRON_BASE}/ConstanciaForwardAction.do"
        headers = {"Referer": f"{SETI_PADRON_BASE}/", "Accept": "text/html,*/*"}
        for intento in (1, 2):
            try:
                self._abrir_padron_puc(forzar=intento == 2)
                r = self.session.get(url, headers=headers, allow_redirects=True)
                r.encoding = "latin-1"  # el Struts responde iso-8859-1
                html = r.text or ""
                if "ACTIVIDAD" in html.upper() or "CONSTANCIA" in html.upper():
                    self.log.info("constancia: OK para %s (%d bytes)", objetivo, len(html))
                    return html
                # No parece la constancia (sesión de seti no tomó): reabrir y reintentar una vez.
                self.log.info("constancia: respuesta inesperada (intento %d), reabro servicio", intento)
            except Exception:  # noqa: BLE001
                self.log.info("constancia: fallo al traer (intento %d)", intento, exc_info=True)
        return None

    def actividades(self, cuit: str | None = None) -> list[dict]:
        """Actividades económicas DECLARADAS del contribuyente (código AFIP + descripción), parseadas
        de la Constancia oficial (Sistema Registral). Devuelve [{codigo, descripcion, periodo}] con la
        actividad principal primero; `periodo` queda None (la constancia no da alta por actividad). []
        si no se pudo. Nota: comparte fuente con constancia_html() (el pedido de actividades + botón de
        constancia salen del mismo lugar)."""
        html = self.constancia_html(cuit)
        if not html:
            return []
        out = self._parsear_actividades(html)
        self.log.info("actividades: %d declarada(s) para %s", len(out), cuit or self.cuit)
        return out

    @staticmethod
    def _parsear_actividades(html: str) -> list[dict]:
        """Extrae las actividades del HTML de la constancia. Cada una viene como
        'F<nomenclador> - <codigo> - <descripcion>' (ej. 'F883 - 750000 - SERVICIOS VETERINARIOS'),
        en el bloque rotulado 'ACTIVIDAD:'. La descripción corre hasta el próximo tag (`<`)."""
        import html as _htmlmod

        m = re.search(r"ACTIVIDAD", html, re.I)
        if not m:
            return []
        # Acotar al bloque de actividades (desde 'ACTIVIDAD' hasta 'Vigencia' o un tramo acotado): así
        # el patrón Fnnn - codigo - desc no matchea algo parecido en otra parte del documento.
        resto = html[m.start():]
        fin = re.search(r"[Vv]igencia", resto)
        bloque = resto[: fin.start()] if fin else resto[:4000]
        out: list[dict] = []
        for am in re.finditer(r"F\s*\d+\s*-\s*(\d+)\s*-\s*([^<\r\n]+)", bloque):
            codigo = am.group(1).strip()
            desc = _htmlmod.unescape(am.group(2))
            desc = re.sub(r"\s+", " ", desc).strip(" - ")
            if desc:
                out.append({"codigo": codigo, "descripcion": desc, "periodo": None})
        return out

    @staticmethod
    def _fecha_iso(f: str | None) -> str | None:
        """'dd/mm/aaaa' -> 'aaaa-mm-dd' (ISO). None / formato inesperado -> None."""
        if not f or "/" not in str(f):
            return None
        try:
            d, m, y = str(f).split("/")
            return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
        except (ValueError, TypeError):
            return None

    def impuestos_padron(self, cuit: str | None = None) -> list[dict]:
        """Impuestos inscriptos del CUIT en el padrón: GET /portal/api/cuit/{cuit}/tipoCuitImpuestos.
        Cada item: {id, periodo, descripcion, estado}. Es la señal AUTORITATIVA del régimen (qué
        tributos tiene activos) SIN abrir el SSO de Monotributo: un único GET sobre la sesión del
        portal ya abierta. Devuelve [] si no se pudo leer."""
        cuit = str(cuit or self.cuit)
        try:
            r = self.session.get(
                f"{URL_PORTAL_API_BASE}/cuit/{cuit}/tipoCuitImpuestos",
                headers={"Accept": "application/json, text/plain, */*", "Referer": URL_PORTAL_APP},
            )
            data = (r.json() or {}).get("data") or {}
            imp = data.get("impuestos")
            return imp if isinstance(imp, list) else []
        except Exception:  # noqa: BLE001
            return []

    def regimen_desde_impuestos(self, cuit: str | None = None) -> dict:
        """Régimen impositivo derivado del padrón de impuestos (impuestos_padron). Devuelve
        {regimen, es_monotributista, activos}:
          - algún impuesto MONOTRIBUTO activo    -> 'monotributo'           (es_monotributista True)
          - si no, algún IVA activo              -> 'responsable_inscripto' (False)
          - si no, hay otros impuestos activos   -> 'no_monotributo'        (False)
          - sin datos / sin impuestos            -> regimen None, es_monotributista None (NO pisar)

        es_monotributista None = "no sé" → el caller cae al camino del panel (comportamiento previo).
        False sólo cuando el padrón CONFIRMA inscripción y ninguna es Monotributo (ahí se puede cortar
        sin esperar el SSO). Lee la inscripción, no la pantalla → inmune al 'migrado al RUT'."""
        imp = self.impuestos_padron(cuit)
        if not imp:
            return {"regimen": None, "es_monotributista": None, "activos": []}
        activos = [i for i in imp if str(i.get("estado") or "").strip().upper() == "ACTIVO"]
        descs = [str(i.get("descripcion") or "").upper() for i in activos]

        def _hay(sub: str) -> bool:
            return any(sub in d for d in descs)

        if not activos:
            regimen, es_mono = "no_monotributo", False  # inscripto pero todo dado de baja
        elif _hay("MONOTRIBUTO"):
            regimen, es_mono = "monotributo", True
        elif _hay("IVA"):
            regimen, es_mono = "responsable_inscripto", False
        else:
            regimen, es_mono = "no_monotributo", False
        self.log.info(
            "Régimen (padrón impuestos) %s: %s | activos: %s",
            cuit or self.cuit, regimen, ", ".join(descs) or "—",
        )
        return {"regimen": regimen, "es_monotributista": es_mono, "activos": descs}

    def debe_recategorizar(self, cuit: str | None = None) -> dict:
        """Ventana de recategorización REAL del monotributo: GET
        /portal/api/monotributista/{cuit}/deberecategorizar. Devuelve {desde, hasta, mostrar_alerta}
        con las fechas OFICIALES de ARCA (ISO aaaa-mm-dd) — para dejar de hardcodear el calendario
        semestral. {} si no se pudo leer o el endpoint no trae la fecha de cierre."""
        cuit = str(cuit or self.cuit)
        try:
            r = self.session.get(
                f"{URL_PORTAL_API_BASE}/monotributista/{cuit}/deberecategorizar",
                headers={"Accept": "application/json, text/plain, */*", "Referer": URL_PORTAL_APP},
            )
            data = (r.json() or {}).get("data") or {}
        except Exception:  # noqa: BLE001
            return {}
        hasta = self._fecha_iso(data.get("fechaHastaRecategorizacion"))
        if not hasta:
            return {}
        return {
            "desde": self._fecha_iso(data.get("fechaDesdeRecategorizacion")),
            "hasta": hasta,
            "mostrar_alerta": bool(data.get("showAlertaRecategorizacion")),
        }

    # --- Administrador de Relaciones: alta de relación (delegar un servicio) -
    # adminrel en serviciosweb (ASP.NET WebForms "clásico", __VIEWSTATE 'dDw...').
    # adminrel_asociar_computador delega un Web Service (por defecto Facturación
    # Electrónica, ws://wsfe) a un Computador Fiscal (el alias de un certificado ya
    # creado). Es el paso que faltaba para que WSFEv1 acepte el cert recién emitido:
    # generar/descargar el cert NO alcanza, ARCA exige además esta relación.
    #
    # Flujo de "Nueva Relación" (replica los postbacks del navegador; cada paso usa
    # el __VIEWSTATE del anterior; los <input type=image> mandan .x/.y). El árbol de
    # servicios (Scriptaculous, lo que obligaba a usar navegador) se saltea: elegir
    # el WS equivale a un GET a relationAdd.aspx?...&servicename=ws://<ws>.
    #   1. GET  main.aspx                                      botón "Nueva relación"
    #   2. POST cmdNuevaRelacion                            -> relationAdd.aspx
    #   3. POST cmdBuscarServicio (+cboRepresentado si aplica) -> serviceSearch2.aspx
    #   4. GET  relationAdd.aspx?...&servicename=ws://<ws>     (atajo: sin árbol)
    #   5. POST cmdBuscarUsuario                            -> userSearch.aspx
    #   6. (busco el alias en cboComputadoresAdministrados; value = base64 cuit:alias)
    #   7. POST __EVENTTARGET=cboComputadoresAdministrados    (autopostback del combo)
    #   8. POST cmdSeleccionarServicio          -> relationAdd?...&representante=<val>
    #   9. POST cmdGenerarRelacion              -> goMain.aspx?...&aceptada=True (OK)
    def _adminrel_get(self, url: str, referer: str):
        r = self.session.get(url, headers={"Referer": referer})
        r.raise_for_status()
        return r

    def _adminrel_post(self, url, viewstate, *, fields=None, event_target=None, referer=None):
        """POST de postback adminrel. event_target=None => no manda __EVENTTARGET
        (botones <input type=image>, que postean .x/.y); event_target='' o un id
        lo incluye (páginas con __doPostBack, p.ej. el combo de userSearch)."""
        data = {}
        if event_target is not None:
            data["__EVENTTARGET"] = event_target
            data["__EVENTARGUMENT"] = ""
        data["__VIEWSTATE"] = viewstate
        if fields:
            data.update(fields)
        r = self.session.post(
            url, data=data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://serviciosweb.afip.gob.ar",
                "Referer": referer or url,
            },
        )
        r.raise_for_status()
        return r

    @staticmethod
    def _buscar_computador(html: str, cuit: str, alias: str) -> str | None:
        """Value del <option> del alias en cboComputadoresAdministrados.

        El value es base64 de '<cuit>:<alias>'. Matchea por el texto del option y,
        de respaldo, decodificando el value. Devuelve el value o None si no está.
        """
        import base64

        combo = re.search(
            r'<select[^>]*id="cboComputadoresAdministrados"[^>]*>(.*?)</select>',
            html, re.S | re.I,
        )
        if not combo:
            return None
        for val, txt in re.findall(
            r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', combo.group(1), re.S | re.I
        ):
            if not val:
                continue
            nombre = re.sub(r"<[^>]+>", "", _html.unescape(txt)).strip()
            if nombre == alias:
                return val
            try:
                if base64.b64decode(val).decode("utf-8", "replace") == f"{cuit}:{alias}":
                    return val
            except Exception:
                pass
        return None

    def adminrel_asociar_computador(
        self, alias: str, *, ws: str = "wsfe", representado=None, dry_run: bool = False
    ) -> dict:
        """Delega un Web Service a un Computador Fiscal (el alias de un certificado).

        Sin este paso WSFEv1 rechaza el certificado recién creado: hay que generar
        la relación 'servicio <- alias' en el Administrador de Relaciones.

        Args:
            alias: alias del certificado/Computador Fiscal (ej. 'orbita').
            ws: web service a delegar (default 'wsfe' -> ws://wsfe; también wsfex…).
            representado: CUIT sobre el que se crea la relación. Default: el propio
                (caso titular, lo normal). Para un representado, pasá su CUIT.
            dry_run: si True, navega hasta ubicar el alias en el combo pero NO crea
                la relación (no toca nada en ARCA). Sirve para validar el flujo.

        Devuelve {'alias','ws','representado','representante'(, 'dry_run')}. Levanta
        AFIPError si ARCA no confirmó el alta (o si el alias no existe).
        """
        if not self.logged_in:
            self.login()
        self._adminrel_preparar()  # SSO en modo relaciones
        rep = str(representado or self.cuit).replace("-", "").strip()
        servicename = f"ws://{ws}"
        MAIN = f"{CERT_BASE}/main.aspx"
        RELADD = f"{CERT_BASE}/relationAdd.aspx"
        self.log.info("Relación %s <- %s (representado %s)", servicename, alias, rep)

        # 1) main.aspx -> botón "Nueva relación"
        r = self._adminrel_get(MAIN, f"{CERT_BASE}/")
        if "cmdNuevaRelacion" not in r.text:
            raise AFIPError(
                "Administrador de Relaciones: no apareció 'Nueva relación' "
                "(¿hay que seleccionar la autoridad de aplicación primero?)."
            )

        # 2) cmdNuevaRelacion -> relationAdd.aspx
        r = self._adminrel_post(
            MAIN, self._aspnet_viewstate(r.text),
            fields={"cmdNuevaRelacion.x": "1", "cmdNuevaRelacion.y": "1"}, referer=MAIN,
        )

        # 3) cmdBuscarServicio -> serviceSearch2.aspx. cboRepresentado solo si
        #    operamos sobre un representado (el titular va de largo, sin seleccionar).
        fields = {"cmdBuscarServicio.x": "1", "cmdBuscarServicio.y": "1"}
        if rep != self.cuit and "cboRepresentado" in r.text:
            fields["cboRepresentado"] = rep
        r = self._adminrel_post(
            RELADD, self._aspnet_viewstate(r.text), fields=fields, referer=RELADD,
        )

        # 4) Atajo: en vez de navegar el árbol, vamos directo a la relación del WS.
        rel_ws = f"{RELADD}?representado={rep}&servicename={servicename}"
        r = self._adminrel_get(rel_ws, r.url)

        # 5) cmdBuscarUsuario -> userSearch.aspx (combo de Computadores Fiscales)
        r = self._adminrel_post(
            rel_ws, self._aspnet_viewstate(r.text),
            fields={"cmdBuscarUsuario.x": "1", "cmdBuscarUsuario.y": "1"}, referer=rel_ws,
        )
        user_url = r.url  # userSearch.aspx?representado=...&serviceName=ws://<ws>

        # 6) Ubicar el alias en el combo (value = base64 'cuit:alias')
        valor = self._buscar_computador(r.text, rep, alias)
        if not valor:
            raise AFIPError(
                f"El alias '{alias}' no figura como Computador Fiscal de {rep}. "
                "¿Está creado el certificado con ese alias?"
            )
        if dry_run:
            self.log.info("dry_run: alias '%s' encontrado, NO se crea la relación", alias)
            return {
                "alias": alias, "ws": servicename, "representado": rep,
                "representante": valor, "dry_run": True,
            }

        # 7) Autopostback del combo (seleccionar el alias)
        r = self._adminrel_post(
            user_url, self._aspnet_viewstate(r.text),
            event_target="cboComputadoresAdministrados",
            fields={"cboComputadoresAdministrados": valor, "txtRepresentante": ""},
            referer=user_url,
        )

        # 8) cmdSeleccionarServicio -> relationAdd?...&representante=<valor> (confirmar)
        r = self._adminrel_post(
            user_url, self._aspnet_viewstate(r.text), event_target="",
            fields={
                "cboComputadoresAdministrados": valor,
                "cmdSeleccionarServicio.x": "1", "cmdSeleccionarServicio.y": "1",
            },
            referer=user_url,
        )
        confirm_url = r.url  # relationAdd.aspx?...&representante=<valor>

        # 9) cmdGenerarRelacion -> goMain.aspx?...&aceptada=True (alta confirmada)
        r = self._adminrel_post(
            confirm_url, self._aspnet_viewstate(r.text),
            fields={"cmdGenerarRelacion.x": "1", "cmdGenerarRelacion.y": "1"},
            referer=confirm_url,
        )
        if "aceptada=true" not in r.url.lower():
            raise AFIPError(
                f"No se confirmó la relación {servicename} <- {alias}: {_pista_pantalla(r.text, 200)}"
            )
        self.log.info("Relación %s <- %s OK", servicename, alias)
        return {"alias": alias, "ws": servicename, "representado": rep, "representante": valor}

    def _portal_adherir_servicio(self, service_name: str) -> bool:
        """Adhiere un servicio auto-adherible con la propia API del portal: el mismo
        POST que dispara el botón "Agregar" cuando entrás a un servicio que no tenés.
        Flujo observado (SPA del portal, ~200ms, todo JSON):
            GET  /servicios/<cuit>/servicio/<name>                 -> metadata
            POST /servicios/<cuit>/servicio/<name>  (body vacío)   -> ADHIERE
            (luego /autorizacionAdherido trae el token+sign; lo resuelve el reintento
             de abrir_servicio vía el /autorizacion normal, ya disponible tras adherir)
        Mucho más simple y estable que el Administrador de Relaciones (sin ASP.NET ni
        viewstate). Devuelve True si el POST fue 2xx.

        ⚠️ Modifica la cuenta del cliente en ARCA (le agrega el servicio; reversible).
        """
        base = f"{URL_PORTAL_API}/{self.cuit}/servicio/{service_name}"
        hdr = {
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://portalcf.cloud.afip.gob.ar",
            "Referer": URL_PORTAL_APP,
        }
        try:
            self.session.get(base, headers=hdr)  # metadata (igual que el portal)
            r = self.session.post(base, headers=hdr)  # body vacío -> adhiere
        except requests.RequestException as e:
            self.log.info("Adhesión de %s por API del portal falló: %s", service_name, e)
            return False
        ok = r.ok
        self.log.info("Adhesión de %s por API del portal: HTTP %s (%s)",
                      service_name, r.status_code, "OK" if ok else "sin efecto")
        return ok

    def adminrel_adherir_servicio(self, servicename: str, *, representado=None) -> bool:
        """Adhiere un servicio INTERACTIVO (web://…) a un representado (default: uno mismo)
        en el Administrador de Relaciones. Necesario para servicios que el CUIT no tiene en
        su menú —p. ej. 'web://arfe_certificado' (Administración de Certificados Digitales),
        sin el cual NO se puede crear el certificado de facturación—.

        Mismo wizard que asociar_computador pero designando una PERSONA (no un computador):
        Nueva relación → Buscar servicio → atajo relationAdd?servicename=web://… → Buscar
        usuario → tipear el CUIT en txtRepresentante (postback onchange que lo designa) →
        Seleccionar servicio → Generar relación. Devuelve True si quedó (aceptada=True).

        ⚠️ Modifica la cuenta del cliente en ARCA (le agrega el servicio; reversible).
        """
        if not self.logged_in:
            self.login()
        self._adminrel_preparar()
        rep = str(representado or self.cuit).replace("-", "").strip()
        MAIN = f"{CERT_BASE}/main.aspx"
        RELADD = f"{CERT_BASE}/relationAdd.aspx"
        self.log.info("Adhiriendo servicio %s a %s", servicename, rep)

        r = self._adminrel_get(MAIN, f"{CERT_BASE}/")
        if "cmdNuevaRelacion" not in r.text:
            raise AFIPError("Administrador de Relaciones: no apareció 'Nueva relación'.")
        r = self._adminrel_post(
            MAIN, self._aspnet_viewstate(r.text),
            fields={"cmdNuevaRelacion.x": "1", "cmdNuevaRelacion.y": "1"}, referer=MAIN,
        )
        r = self._adminrel_post(
            RELADD, self._aspnet_viewstate(r.text),
            fields={"cmdBuscarServicio.x": "1", "cmdBuscarServicio.y": "1"}, referer=RELADD,
        )
        # Atajo al servicio (sin navegar el árbol). El representante se designa después.
        r = self._adminrel_get(f"{RELADD}?representado={rep}&servicename={servicename}", r.url)
        r = self._adminrel_post(
            r.url, self._aspnet_viewstate(r.text),
            fields={"cmdBuscarUsuario.x": "1", "cmdBuscarUsuario.y": "1"}, referer=r.url,
        )
        # Tipear el CUIT del representante (uno mismo): el onchange dispara el postback que lo busca.
        r = self._adminrel_post(
            r.url, self._aspnet_viewstate(r.text),
            event_target="txtRepresentante", fields={"txtRepresentante": rep}, referer=r.url,
        )
        # Seleccionar servicio -> pantalla de confirmación con 'Generar relación'.
        r = self._adminrel_post(
            r.url, self._aspnet_viewstate(r.text),
            fields={
                "txtRepresentante": rep,
                "cmdSeleccionarServicio.x": "1", "cmdSeleccionarServicio.y": "1",
            },
            referer=r.url,
        )
        if "cmdGenerarRelacion" not in r.text:
            raise AFIPError(f"No se pudo preparar la adhesión de {servicename}: {_pista_pantalla(r.text)}")
        r = self._adminrel_post(
            r.url, self._aspnet_viewstate(r.text),
            fields={"cmdGenerarRelacion.x": "1", "cmdGenerarRelacion.y": "1"}, referer=r.url,
        )
        if "aceptada=true" not in r.url.lower():
            raise AFIPError(f"No se confirmó la adhesión de {servicename}: {_pista_pantalla(r.text)}")
        self.log.info("Servicio %s adherido a %s OK", servicename, rep)
        return True

    # --- Administración de Puntos de Venta (pvel) ---------------------------
    # Servicio pvel en fes.afip.gob.ar (acciones Struts .do, respuestas JSON).
    # Operaciones (POST ajax, X-Requested-With, param fijo rt=A):
    #   consultaPuntosVenta.do     -> listado (paginado, con filtros opcionales)
    #   cargarPuntoVentaEdicion.do -> sistemas disponibles + datos de un PV
    #   altaPuntoVenta.do          -> alta (CREATE)
    #   iniciarBajaPuntoVenta.do + eliminarPuntoVenta.do -> baja (DELETE, 2 pasos)
    def _pvel_preparar(self) -> None:
        """Abre pvel (si no está abierto/vigente) y fija el contribuyente."""
        if self._fes_servicio != "pvel" or not self.fes_vigente:
            self.abrir_servicio("pvel")
        if not self._contribuyente_set:
            self._fes_get(f"{PVEL_BASE}/setearContribuyente.do?idContribuyente=0")
            self._contribuyente_set = True

    def _pvel_ajax(self, accion: str, data: dict) -> dict:
        """POST a una acción .do de pvel (paceado), devolviendo JSON."""
        self._pvel_preparar()
        data = {**data, "rt": "A"}  # rt=A constante en todas las acciones
        hdr = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://fes.afip.gob.ar",
            "Referer": f"{PVEL_BASE}/abmPuntosVenta.do",
        }
        espera = self._min_gap - (time.time() - self._last_fes)
        if espera > 0:
            time.sleep(espera)
        try:
            r = self.session.post(f"{PVEL_BASE}/{accion}", data=data, headers=hdr)
        finally:
            self._last_fes = time.time()
        r.raise_for_status()
        try:
            return r.json()
        except ValueError:
            raise AFIPError(f"pvel {accion} no devolvió JSON: {r.text[:100]!r}")

    @staticmethod
    def _pventa_norm(p: dict) -> dict:
        """Normaliza un punto de venta al estándar (claves limpias + _raw)."""
        return {
            "nro": int(p["pveNro"]) if p.get("pveNro") else None,
            "sistema": p.get("sisCodigo"),
            "sistema_desc": p.get("sisDesc"),
            "nombre_fantasia": p.get("nombreFantasia"),
            "domicilio": p.get("domicilio"),
            "baja": p.get("esBaja") == "S",
            "bloqueado": p.get("estaBloqueado") == "S",
            "_raw": p,
        }

    def pventa_listar(self, *, nro=None, incluir_baja: bool = True) -> list[dict]:
        """Lista los puntos de venta. Opcional: filtrar por `nro`.

        Devuelve dicts normalizados: nro (int), sistema, sistema_desc,
        nombre_fantasia, domicilio, baja (bool), bloqueado (bool), _raw.
        """
        data = {"title": "Listado", "page[number]": "1", "page[size]": "100"}
        if nro is not None:
            data["location[0][fieldName]"] = "pveNro"
            data["location[0][value]"] = str(nro)
        j = self._pvel_ajax("consultaPuntosVenta.do", data)
        pvs = [self._pventa_norm(p) for p in j.get("data", {}).get("pageList", [])]
        if not incluir_baja:
            pvs = [p for p in pvs if not p["baja"]]
        self.log.info("Puntos de venta: %d", len(pvs))
        return pvs

    def pventa_sistemas(self, id_pv: int = 1) -> list[dict]:
        """Sistemas disponibles para asignar a un PV: [{'clave','valor'}].

        Son los valores válidos de `sisCodigo` (ej. RLM=Factura en Línea Monot.,
        CF=Controlador Fiscal, MAW=Factura Electrónica Monot. Web Services,
        FEERCEL=Comprobantes de Exportación, ...). Se leen de cargarPuntoVentaEdicion.
        """
        j = self._pvel_ajax("cargarPuntoVentaEdicion.do", {"id": str(id_pv)})
        return j.get("data", {}).get("sistemas", [])

    def pventa_crear(
        self,
        nombre_fantasia: str,
        sis_codigo: str,
        *,
        nro=None,
        cod_tipo_domicilio: str = "1-1",
        dominio: str = "",
    ) -> dict:
        """Da de alta un punto de venta (CREATE).

        ⚠️ Crea un PV REAL (reversible con pventa_eliminar).

        Args:
            nombre_fantasia: nombre del PV.
            sis_codigo: sistema (ver pventa_sistemas; ej. 'MAW', 'RLM', 'CF').
            nro: número de PV; si None, usa el siguiente disponible (máx+1).
            cod_tipo_domicilio: domicilio (default '1-1' = domicilio fiscal).
            dominio: dominio web (normalmente vacío).
        """
        if nro is None:
            existentes = [p["nro"] for p in self.pventa_listar() if p["nro"]]
            nro = (max(existentes) + 1) if existentes else 1
        self.log.info("Alta PV nro=%s sis=%s '%s'", nro, sis_codigo, nombre_fantasia)
        return self._pvel_ajax(
            "altaPuntoVenta.do",
            {
                "pveNro": str(nro),
                "pveNombreFantasia": nombre_fantasia,
                "pveDominio": dominio,
                "sisCodigo": sis_codigo,
                "codTipoDomicilio": cod_tipo_domicilio,
            },
        )

    def pventa_eliminar(self, nro, sis_codigo: str) -> dict:
        """Da de baja un punto de venta (DELETE, 2 pasos: iniciar + eliminar)."""
        self.log.info("Baja PV nro=%s sis=%s", nro, sis_codigo)
        self._pvel_ajax("iniciarBajaPuntoVenta.do", {"id": str(nro), "sis": sis_codigo})
        return self._pvel_ajax("eliminarPuntoVenta.do", {"id": str(nro), "sis": sis_codigo})

    # --- CCMA: Cuenta Corriente Monotributistas y Autónomos (ccam) ----------
    def _ccam_preparar(self) -> None:
        """Abre el servicio solo si no hay sesión de servicios2 (ASPSESSIONID*)."""
        tiene = any(
            c.name.startswith("ASPSESSIONID") and "servicios2" in (c.domain or "")
            for c in self.session.cookies
        )
        if not tiene:
            self.abrir_servicio("ccam")

    def _ccam_seleccionar_cuit(self) -> None:
        """Elige self.cuit en seleccionaCuit.asp (para claves multi-CUIT). El botón
        'Elegir CUIT' hace `accion='s'; form1.submit()`. Sin selector, no hace nada."""
        url = f"{CCAM_BASE}/seleccionaCuit.asp"
        try:
            r = self.session.get(url, headers={"Referer": f"{CCAM_BASE}/"})
            if 'name="selectCuit"' not in r.text:
                return  # clave de un solo CUIT: no hay que elegir
            self.session.post(
                url,
                data={"selectCuit": self.cuit, "accion": "s"},
                headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": url},
            )
            self.log.info("CCMA: contribuyente %s seleccionado (clave multi-CUIT)", self.cuit)
        except requests.RequestException:
            pass  # best-effort; si falla, el flujo de P02 reintenta/avisa

    @staticmethod
    def _ccam_per(v) -> str:
        """Normaliza un período a 'MM/YYYY' (acepta date/datetime o str)."""
        if isinstance(v, (_dt.date, _dt.datetime)):
            return v.strftime("%m/%Y")
        return str(v)

    @staticmethod
    def _ccam_num(s: str):
        """'4,780.46' -> 4780.46 ; '(4,789.22)' -> -4789.22 (negativo)."""
        s = s.strip()
        neg = s.startswith("(") and s.endswith(")")
        s = s.strip("()").replace(",", "")
        try:
            v = float(s)
        except ValueError:
            return None
        return -v if neg else v

    @classmethod
    def _ccam_parse(cls, html: str) -> list[dict]:
        """Parsea la sábana a movimientos y saldos.

        Cada fila de movimiento trae: período, código, subcódigo, concepto,
        descripción, fecha, importe. Las filas 'Saldo' traen período/fecha/saldo.
        """
        out = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
            cells = [
                _html.unescape(re.sub(r"<[^>]+>", "", c)).replace("\xa0", " ").strip()
                for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S | re.I)
            ]
            cells = [c for c in cells if c and c != "-"]
            if not cells:
                continue
            periodo = next((c for c in cells if re.fullmatch(r"\d{2}/\d{4}", c)), None)
            fecha = next((c for c in cells if re.fullmatch(r"\d{2}/\d{2}/\d{4}", c)), None)
            if not periodo:
                continue
            if "Saldo" in cells:
                out.append({
                    "tipo": "saldo", "periodo": periodo, "fecha": fecha,
                    "importe": cls._ccam_num(cells[-1]),
                })
            elif fecha:
                desc = next(
                    (c for c in cells if re.search(r"[A-Za-z]{4}", c) and c != "Saldo"),
                    None,
                )
                codigo = next(
                    (c for c in cells[1:] if re.fullmatch(r"\d{3}", c)), None
                )
                out.append({
                    "tipo": "movimiento", "periodo": periodo, "codigo": codigo,
                    "descripcion": desc, "fecha": fecha,
                    "importe": cls._ccam_num(cells[-1]), "_raw": cells,
                })
        return out

    def cuenta_corriente(self, *, desde="01/2023", hasta=None) -> list[dict]:
        """Cuenta corriente CCMA (monotributistas/autónomos): pagos, obligaciones, saldos.

        Mínimo: abrir_servicio + 1 GET (la sábana ajax es autocontenida; NO hace
        falta P02/P04). `desde`/`hasta` en 'MM/YYYY' (o date); hasta = período actual
        por defecto. Devuelve lista de dicts {tipo, periodo, descripcion, fecha,
        importe, ...} (tipo 'movimiento' o 'saldo').
        """
        self._ccam_preparar()
        desde = self._ccam_per(desde)
        hasta = self._ccam_per(hasta or _dt.date.today())
        aj = self.session.get(
            f"{CCAM_BASE}/ajax/ConsDeuFecSabana.asp",
            params={
                "periodo": "", "rango": "12", "monoAut": "Todos", "tipoMov": "Todos",
                "perDesde1": desde, "perHasta1": hasta,
                "periodoMinimo": desde, "periodoMaximo": hasta, "ingreso": "sabana",
            },
            headers={"Referer": f"{CCAM_BASE}/P04_ctacte.asp"},
        )
        aj.raise_for_status()
        movs = self._ccam_parse(aj.text)
        self.log.info("CCMA: %d filas (%s - %s)", len(movs), desde, hasta)
        return movs

    @staticmethod
    def _campos_form(html: str, form_name: str | None = None) -> dict:
        """Inputs (name->value) de un form (acotado por name si se pasa). Toma el
        primer valor NO vacío por nombre (los forms de la CCMA traen duplicados vacíos)."""
        blk = html
        if form_name:
            m = re.search(rf'<form name="{form_name}".*?</form>', html, re.S | re.I)
            blk = m.group(0) if m else ""
        out: dict[str, str] = {}
        for t in re.findall(r"<input[^>]*>", blk, re.I):
            nm = re.search(r'name="([^"]*)"', t)
            tp = re.search(r'type="([^"]*)"', t)
            if not nm or (tp and tp.group(1).lower() == "button"):
                continue
            vm = re.search(r'value="([^"]*)"', t)
            v = vm.group(1) if vm else ""
            if nm.group(1) not in out or (not out[nm.group(1)] and v):
                out[nm.group(1)] = v
        return out

    def calcular_deuda(self, *, desde=None, hasta=None) -> dict:
        """Cálculo de Deuda OFICIAL (P02) de la CCMA: la deuda REAL con intereses.

        Distinto de cuenta_corriente() (la sábana de movimientos): acá ARCA computa el
        Total Saldo Deudor = Obligación Mensual (capital) + Accesorios (intereses) a una
        fecha. La sábana NO trae los intereses, así que para la cuota va ESTE método.

        Flujo: abrir ccam -> GET P02_ctacte.asp (form 'frm' con períodos+fecha ya
        cargados) -> POST con calcula='S' (lo que setea el onClick de "CÁLCULO DE
        DEUDA"; su valida_fecha_calculo() está comentado). Períodos por defecto los del
        form (desde 01/2023 a hoy); `desde`/`hasta` los pisan.

        Devuelve {deudor, acreedor, capital, intereses, fecha_calculo, periodo_desde,
        periodo_hasta, movimientos, por_periodo}. `deudor` es None si la pantalla no
        trae la tabla de totales (p. ej. cuenta al día / con bonificación).
        """
        P02 = f"{CCAM_BASE}/P02_ctacte.asp"
        P04 = f"{CCAM_BASE}/P04_ctacte.asp"
        hdr = {"Content-Type": "application/x-www-form-urlencoded", "Referer": P02}
        for intento in range(3):
            self._ccam_preparar()
            # 1) GET P02 (form 'frm' con períodos/fecha) + POST calcula='S' (dispara el cálculo).
            r = self.session.get(P02, headers={"Referer": f"{CCAM_BASE}/"})
            r.raise_for_status()
            campos = self._campos_form(r.text, "frm")
            if desde:
                campos["perdesde2"] = self._ccam_per(desde)
            if hasta:
                campos["perhasta2"] = self._ccam_per(hasta)
            campos["calcula"] = "S"
            p1 = self.session.post(P02, data=campos, headers=hdr)
            p1.raise_for_status()
            # 2) La respuesta auto-submitea 'frm_p04' a P04_ctacte.asp (ahí está la tabla
            #    "Total Saldo Deudor"). Si no hay frm_p04, parseamos la propia respuesta.
            if 'name="frm_p04"' in p1.text:
                p2 = self.session.post(P04, data=self._campos_form(p1.text, "frm_p04"), headers=hdr)
                p2.raise_for_status()
                det = self._parse_deuda_p02(p2.text)
            else:
                det = self._parse_deuda_p02(p1.text)
            if det.get("fecha_calculo"):  # pantalla válida (la sesión ccam no caducó)
                return det
            # Sesión ccam caducada/denegada. Causa típica: clave MULTI-CUIT que no eligió
            # contribuyente -> elegimos self.cuit en seleccionaCuit y reintentamos (sin eso
            # ARCA da 'caducada'). Reabrimos por si además murió la sesión. NO devolvemos un
            # detalle vacío (sería 'sin deuda' falso -> alerta perdida): si no se recupera,
            # levantamos para que el caller lo trate como fallo y NO pise la cuota previa.
            self.log.warning("CCMA: deuda sin resultado (intento %d); reabro + elijo contribuyente", intento + 1)
            self.abrir_servicio("ccam")
            self._ccam_seleccionar_cuit()
            time.sleep(2 * (intento + 1))
        raise AFIPError("CCMA: no se pudo calcular la deuda (sesión caducada/denegada).")

    @classmethod
    def _parse_deuda_p02(cls, html: str) -> dict:
        """Parsea P02_ctacte.asp tras el cálculo: totales (deudor/acreedor) + desglose
        (capital/intereses) + ledger por período. Montos en formato US ('14,625.46')."""
        out: dict = {
            "fecha_calculo": None, "periodo_desde": None, "periodo_hasta": None,
            "deudor": None, "acreedor": None, "capital": None, "intereses": None,
            "movimientos": [], "por_periodo": [],
        }
        # Los labels traen entidades (Obligaci&oacute;n) -> desescapamos para los regex.
        txt = _html.unescape(html)
        m = re.search(r'name="feccalculo"\s+value="([\d/]+)"', txt)
        out["fecha_calculo"] = m.group(1) if m else None
        m = re.search(r'id="periodoMinimo"\s+value="([\d/]+)"', txt)
        out["periodo_desde"] = m.group(1) if m else None
        m = re.search(r'id="periodoMaximo"\s+value="([\d/]+)"', txt)
        out["periodo_hasta"] = m.group(1) if m else None
        md = re.search(r"Total Saldo Deudor:.*?CeldaTitularResaltado[^>]*>\s*([\d.,]+)", txt, re.S | re.I)
        ma = re.search(r"Total Saldo Acreedor:.*?CeldaTitularResaltado[^>]*>\s*([\d.,]+)", txt, re.S | re.I)
        out["deudor"] = cls._ccam_num(md.group(1)) if md else None
        out["acreedor"] = cls._ccam_num(ma.group(1)) if ma else None
        mc = re.search(r"Obligaci[oó]n Mensual:\s*</td>.*?Celda[^>]*>\s*([\d.,]+)", txt, re.S | re.I)
        mi = re.search(r"Accesorios:\s*</td>.*?Celda[^>]*>\s*([\d.,]+)", txt, re.S | re.I)
        out["capital"] = cls._ccam_num(mc.group(1)) if mc else None
        out["intereses"] = cls._ccam_num(mi.group(1)) if mi else None
        # Ledger: filas con CeldaBorde_ConsDeuFec (col 2=período, 3=impuesto, 4=concepto,
        # 6=descripción, 7=venc, 8=debe, 9=haber). Subtotales 'Saldo' sin monto se descartan.
        try:
            import lxml.html
            doc = lxml.html.fromstring(html)
        except Exception:  # noqa: BLE001 — sin lxml o HTML roto: devolvemos al menos los totales
            return out
        acum: dict = {}
        for tr in doc.xpath('//tr[td[contains(@class,"CeldaBorde_ConsDeuFec")]]'):
            tds = tr.xpath("./td")
            if len(tds) < 10:
                continue
            cel = [" ".join((td.text_content() or "").split()) for td in tds[:10]]
            periodo = cel[2]
            debe, haber = cls._ccam_num(cel[8]) or 0.0, cls._ccam_num(cel[9]) or 0.0
            if (debe == 0 and haber == 0) or not re.match(r"\d{2}/\d{4}", periodo):
                continue
            out["movimientos"].append({
                "periodo": periodo, "impuesto": cel[3], "concepto": cel[4],
                "descripcion": cel[6], "vencimiento": cel[7], "debe": debe, "haber": haber,
            })
            acc = acum.setdefault(periodo, {"debe": 0.0, "haber": 0.0})
            acc["debe"] += debe
            acc["haber"] += haber
        out["por_periodo"] = [
            {"periodo": p, "debe": round(v["debe"], 2), "haber": round(v["haber"], 2),
             "saldo": round(v["debe"] - v["haber"], 2)}
            for p, v in acum.items()
        ]
        return out

    # --- CCMA: Consulta de Saldos (P05) -> meses seguidos que adeuda ---------
    # P05 da, YA RESUELTO por ARCA, el estado por período (DEUDOR/SALDADO/ACREEDOR) y el tipo
    # (MONOTRIBUTO/AUTONOMO). No hay que derivar obligación/pago (el ledger de P04 viene flaky).
    # Requiere que ANTES se haya hecho el Cálculo de Deuda (P02->P04) en la MISMA sesión: sin eso
    # P05 responde "Sesión caducada". Reabrir ccam borra ese estado, así que no se reabre acá.
    @classmethod
    def _parse_saldos_p05(cls, html: str) -> list[dict]:
        """Filas de 'Consulta de Saldos' (P05): [{periodo, saldo, tipo, estado}], más nuevo primero.
        `estado` ∈ {'DEUDOR','SALDADO','ACREEDOR'}; `saldo` en pesos (negativo = deuda)."""
        try:
            import lxml.html
            doc = lxml.html.fromstring(html)
        except Exception:  # noqa: BLE001 — sin lxml o HTML roto
            return []
        filas: list[dict] = []
        for tr in doc.xpath("//tr[td]"):
            cel = [" ".join((td.text_content() or "").split()) for td in tr.xpath("./td")]
            if len(cel) != 4:
                continue
            periodo, saldo, tipo, estado = cel
            if not re.fullmatch(r"\d{2}/\d{4}", periodo):
                continue
            estado = estado.upper()
            if estado not in ("DEUDOR", "SALDADO", "ACREEDOR"):
                continue
            filas.append({"periodo": periodo, "saldo": cls._ccam_num(saldo),
                          "tipo": tipo.upper(), "estado": estado})
        # Más reciente primero (año, mes) desc, para contar la racha desde hoy hacia atrás.
        filas.sort(key=lambda f: (int(f["periodo"][3:]), int(f["periodo"][:2])), reverse=True)
        return filas

    @staticmethod
    def _contar_meses_deudor(filas: list[dict]) -> int:
        """Meses de MONOTRIBUTO en estado DEUDOR SEGUIDOS desde el período más reciente. Corta en el
        primer mes SALDADO/ACREEDOR. 0 si el más reciente no es deudor (hoy el cliente no adeuda)."""
        racha = 0
        for f in (x for x in filas if x["tipo"] == "MONOTRIBUTO"):  # sólo deudas de monotributo
            if f["estado"] == "DEUDOR":
                racha += 1
            else:
                break
        return racha

    def saldos_ccma(self, *, asegurar_calculo: bool = True) -> list[dict]:
        """Tabla 'Consulta de Saldos' (P05) de la CCMA (estado por período). `asegurar_calculo`
        dispara antes el Cálculo de Deuda (P02->P04) que P05 requiere; pasá False si ya lo hiciste
        en esta sesión (así es +1 request, no +4). Levanta AFIPError si la sesión caducó."""
        if asegurar_calculo:
            self.calcular_deuda()
        r = self.session.post(
            f"{CCAM_BASE}/P05_ctacte.asp",
            data="",
            headers={"Content-Type": "application/x-www-form-urlencoded",
                     "Referer": f"{CCAM_BASE}/P08_ctacte.asp"},
        )
        r.raise_for_status()
        if "caducada" in r.text.lower():
            raise AFIPError("CCMA: Consulta de Saldos (P05) sin resultado (sesión caducada).")
        return self._parse_saldos_p05(r.text)

    def meses_adeudados(self, *, asegurar_calculo: bool = True) -> int:
        """Cuántos meses SEGUIDOS de monotributo adeuda el cliente hoy (de la Consulta de Saldos P05).
        0 si hoy no adeuda. Ver saldos_ccma() para el costo/estado de sesión."""
        return self._contar_meses_deudor(self.saldos_ccma(asegurar_calculo=asegurar_calculo))

    # --- Domicilio Fiscal Electrónico / e-ventanilla (notificaciones) -------
    # Servicio e-ventanilla en ve.cloud.afip.gob.ar (API REST JSON).
    #   GET /api/v1/communications?cuit=&fechaPublicacionSince=&fechaPublicacionTo=
    #   GET /api/v1/communications/<id>?id=&cuit=          -> detalle
    #   GET /api/v1/communications/<id>/eventos?id=&cuit=  -> eventos (leído, etc.)
    def _ve_preparar(self) -> None:
        """Abre e-ventanilla si no hay sesión del dominio ve.cloud (JSESSIONID)."""
        tiene = any(
            c.name == "JSESSIONID" and "ve.cloud" in (c.domain or "")
            for c in self.session.cookies
        )
        if not tiene:
            self.abrir_servicio("e-ventanilla")

    def _ve_get(self, path: str, params: dict) -> dict:
        self._ve_preparar()
        r = self.session.get(
            f"{VE_BASE}{path}",
            params=params,
            headers={"Accept": "application/json, text/plain, */*",
                     "Referer": f"{VE_BASE}/index.html"},
        )
        r.raise_for_status()
        try:
            return r.json()
        except ValueError:
            raise AFIPError(f"e-ventanilla {path} no devolvió JSON: {r.text[:100]!r}")

    # estado de una comunicación (códigos vistos de la API)
    _NOTIF_ESTADO = {1: "no_leida", 2: "leida"}

    @staticmethod
    def _a_dt(v):
        """Normaliza fecha de e-ventanilla a datetime. Acepta epoch-ms (lista)
        o ISO con offset (detalle). Devuelve el valor crudo si no parsea."""
        if v in (None, ""):
            return None
        if isinstance(v, (int, float)):
            return _dt.datetime.fromtimestamp(v / 1000)
        try:
            return _dt.datetime.fromisoformat(str(v))
        except ValueError:
            return v

    def _notif_norm(self, c: dict) -> dict:
        """Normaliza una comunicación al estándar del cliente (claves limpias + _raw)."""
        estado = c.get("estado")
        return {
            "id": c.get("idComunicacion"),
            "fecha_publicacion": self._a_dt(c.get("fechaPublicacion")),
            "fecha_vencimiento": self._a_dt(c.get("fechaVencimiento")),
            "sistema": c.get("nombreSistema") or c.get("sistemaPublicadorDesc"),
            "organismo": c.get("organismoDesc"),
            "estado": self._NOTIF_ESTADO.get(estado, estado),
            "leida": estado == 2,
            "prioridad": c.get("prioridad"),
            "tiene_adjunto": c.get("tieneAdjunto"),
            "adjuntos": c.get("adjuntos", []),
            "mensaje": c.get("mensaje"),
            "_raw": c,
        }

    def notificaciones_listar(self, desde=None, hasta=None, cuit=None) -> list[dict]:
        """Lista las comunicaciones del Domicilio Fiscal Electrónico.

        desde/hasta: fecha (date o 'dd/mm/yyyy'); default = último año.
        cuit: CUIT objetivo de la consulta. Por defecto el logueado (titular). Para un
            REPRESENTADO se pasa su CUIT: ARCA lo autoriza según las delegaciones de la
            sesión (el logueado tiene que tener el DFE delegado por ese CUIT). Si no está
            delegado, ARCA devuelve la lista vacía (no rompe).
        Devuelve dicts normalizados (id, fecha_publicacion/vencimiento como
        datetime, sistema, estado, leida, prioridad, tiene_adjunto, mensaje, _raw).
        El `mensaje` acá viene resumido; el completo está en notificacion_detalle.
        """
        hoy = _dt.date.today()
        d = self._a_fecha(desde) if desde else hoy - _dt.timedelta(days=365)
        h = self._a_fecha(hasta) if hasta else hoy
        j = self._ve_get(
            "/api/v1/communications",
            {
                "cuit": str(cuit or self.cuit),
                "fechaPublicacionSince": d.strftime("%Y-%m-%d"),
                "fechaPublicacionTo": h.strftime("%Y-%m-%d"),
            },
        )
        coms = j.get("comunicaciones", [])
        self.log.info("Notificaciones (%s): %d", cuit or self.cuit, len(coms))
        return [self._notif_norm(c) for c in coms]

    def notificacion_detalle(self, id_com, cuit=None) -> dict:
        """Detalle completo de una comunicación (mensaje entero, adjuntos, fechas).
        `cuit`: el CUIT dueño de la comunicación (el representado si aplica; default = logueado)."""
        j = self._ve_get(
            f"/api/v1/communications/{id_com}",
            {"id": str(id_com), "cuit": str(cuit or self.cuit)},
        )
        return self._notif_norm(j.get("comunicacion", j))

    def notificacion_eventos(self, id_com, cuit=None) -> list[dict]:
        """Eventos de una comunicación. Dicts: evento, fecha (datetime), cuit, _raw.
        `cuit`: el CUIT dueño de la comunicación (el representado si aplica; default = logueado)."""
        j = self._ve_get(
            f"/api/v1/communications/{id_com}/eventos",
            {"id": str(id_com), "cuit": str(cuit or self.cuit)},
        )
        return [
            {
                "evento": e.get("tipoEvento", {}).get("descripcion"),
                "fecha": self._a_dt(e.get("fechaIngreso")),
                "cuit": e.get("usuarioCuit"),
                "_raw": e,
            }
            for e in j.get("eventos", [])
        ]

    # --- Liquidaciones Electrónicas del sector primario (LSP / agro) ---------
    # Flujo (validado end-to-end contra prod): el portal NO autoriza el sub-servicio
    # directo, hay que entrar por rcel (Comprobantes en línea) y desde su menú saltar
    # al sector con un DOBLE SSO (forward → auth .gov → app del sector). Ver LSP_SECTORES
    # y la memoria `facturacion-agropecuaria`. Cada liquidación se consulta en grilla
    # (sin importe) y el importe sale del PDF (getPdf). Sync SEMANAL (aparecen rara vez).
    @staticmethod
    def _lsp_form(html_txt: str) -> tuple[str, dict]:
        """Parsea un form de SSO (forward): (action, {campos ocultos})."""
        m = re.search(r"""action=['"]([^'"]+)['"]""", html_txt, re.I)
        if not m:
            raise AFIPError("No se encontró el form de SSO de liquidaciones.")
        campos = {
            k: _html.unescape(v)
            for k, v in re.findall(r"""name="([^"]+)"[^>]*value=['"]([^'"]*)['"]""", html_txt)
        }
        return m.group(1), campos

    @staticmethod
    def _lsp_split_numero(txt: str) -> tuple[int, int]:
        """'00001 - 00000132' -> (punto_venta, numero) = (1, 132)."""
        nums = re.findall(r"\d+", txt or "")
        if len(nums) >= 2:
            return int(nums[0]), int(nums[1])
        return 0, int(nums[0]) if nums else 0

    def _abrir_rcel(self) -> None:
        """Abre 'Comprobantes en línea' (rcel) y deja el menú principal listo (trampolín)."""
        if not self.logged_in:
            self.login()
        r = self.session.get(
            f"{URL_PORTAL_API}/{self.cuit}/servicio/rcel/autorizacion",
            headers={"Accept": "application/json, text/plain, */*", "Referer": URL_PORTAL_APP},
        )
        try:
            aut = r.json()
        except ValueError:
            raise AFIPError("Sesión del portal expirada (rcel autorizacion sin JSON).")
        if not isinstance(aut, dict) or "token" not in aut:
            raise AFIPError("El servicio 'Comprobantes en línea' no está disponible para este CUIT.")
        # Entry REAL = index.jsp (index_bis.jsp da 403). Setea SESSION_TOKEN/SIGN + JSESSIONID en fe.
        self.session.post(
            f"{RCEL_BASE}/index.jsp",
            data={"token": aut["token"], "sign": aut["sign"]},
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://portalcf.cloud.afip.gob.ar",
                "Referer": "https://portalcf.cloud.afip.gob.ar/",
            },
        )
        # El ORDEN importa: setearContribuyente + menu_ppal (ir directo a menu_ppal da 403 del WAF).
        ref = {"Referer": f"{RCEL_BASE}/index_bis.jsp"}
        self.session.get(f"{RCEL_BASE}/setearContribuyente.do?idContribuyente=0", headers=ref)
        self.session.get(f"{RCEL_BASE}/menu_ppal.jsp", headers=ref)

    def _lsp_preparar(self, sector: str) -> str:
        """Abre el sub-servicio del `sector` (doble SSO) si no está abierto. Devuelve su base URL.

        Reusa la sesión: si ya se abrió ESTE sector en esta instancia, no rehace el SSO.
        """
        conf = LSP_SECTORES.get(sector)
        if not conf:
            raise AFIPError(f"Sector de liquidaciones no soportado: {sector!r}")
        base = conf["base"]
        if self._lsp_sector == sector:
            return base
        self.log.info("LSP: abriendo sector %s (%s)", sector, conf["token"])
        self._abrir_rcel()
        # forwardToken → form1 (token 'request') que se postea al auth .gov
        r = self.session.get(
            f"{RCEL_BASE}/forwardToken.do?serviceDST={conf['token']}",
            headers={"X-Requested-With": "XMLHttpRequest", "Referer": f"{RCEL_BASE}/menu_ppal.jsp"},
        )
        a1, f1 = self._lsp_form(r.text)
        # auth .gov → servicio.xhtml con form2 (token 'granted' del sector)
        r = self.session.post(
            a1, data=f1, allow_redirects=True,
            headers={"Content-Type": "application/x-www-form-urlencoded",
                     "Origin": "https://auth.afip.gov.ar", "Referer": "https://auth.afip.gov.ar/"},
        )
        a2, f2 = self._lsp_form(r.text)
        # PRIME: iniciar sesión en la app del sector ANTES de entregar el granted. Sin este GET, el
        # POST del granted devuelve "Error General del Sistema" (arranca JSESSIONID + cookies WAF).
        self.session.get(f"{base}/inicioPerfil.htm", headers={"Referer": "https://auth.afip.gov.ar/"})
        self.session.post(
            a2, data=f2, allow_redirects=True,
            headers={"Content-Type": "application/x-www-form-urlencoded",
                     "Origin": "https://auth.afip.gov.ar", "Referer": "https://auth.afip.gov.ar/"},
        )
        # Fijar el contribuyente (0 = titular; los clientes del agro entran con su propia clave).
        self.session.get(f"{base}/jsp/setearContribuyente.htm?idContribuyente=0",
                         headers={"Referer": f"{base}/index.jsp"})
        self.session.get(f"{base}/inicioPerfil.htm", headers={"Referer": f"{base}/index.jsp"})
        self._lsp_sector = sector
        return base

    # --- Aportes en Línea (MisAportes): remuneración del empleado en relación de dependencia -----
    def mis_aportes(self, *, desde: str | None = None, hasta: str | None = None) -> dict:
        """Trae la remuneración declarada al SIPA (servicio "Aportes en Línea"/MisAportes) del
        contribuyente logueado. Es el F.931 que informa el empleador: sirve para justificar gastos
        (el haber percibido respalda compras a consumidor final) y como señal AUTORITATIVA de que el
        cliente está en relación de dependencia.

        `desde`/`hasta` = 'YYYYMM' (default: últimos 12 meses hasta el mes anterior completo).
        Devuelve:
            {es_relacion_dependencia: bool | None,   # True=rel.dep · False=sin nómina · None=no determinable
             periodo_desde, periodo_hasta: 'YYYYMM',
             empleadores: [{razon_social, cuit}],
             remuneraciones: [{periodo: 'YYYYMM', bruto: float, incluye_sac: bool}],
             total_bruto: float}
        Sólo aplica al TITULAR de la clave (el servicio es personal; no cubre representados).
        Flujo validado end-to-end; ver la memoria `aportes-en-linea-misaportes`.
        """
        if not self.logged_in:
            self.login()

        # Ventana por defecto: 12 meses hasta el mes anterior completo.
        if not (desde and hasta):
            fin = _dt.date.today().replace(day=1) - _dt.timedelta(days=1)   # último día del mes previo
            ini = (fin.replace(day=1) - _dt.timedelta(days=330)).replace(day=1)
            desde = desde or f"{ini.year}{ini.month:02d}"
            hasta = hasta or f"{fin.year}{fin.month:02d}"

        B = MISAPORTES_BASE

        def hidden(html):
            out = {}
            for tag in re.findall(r'<input[^>]*type="hidden"[^>]*>', html, re.I):
                n = re.search(r'name="([^"]+)"', tag)
                v = re.search(r'value="([^"]*)"', tag)
                if n:
                    out[n.group(1)] = v.group(1) if v else ""
            return out

        def postback(url, html, target, extra=None, referer=None):
            data = hidden(html)
            data["__EVENTTARGET"] = target
            data["__EVENTARGUMENT"] = ""
            if extra:
                data.update(extra)
            return self.session.post(
                url, data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded",
                         "Origin": "https://serviciossegsoc.afip.gob.ar",
                         "Referer": referer or url},
            )

        # SSO (token+sign -> default.aspx) y GET del index real.
        self.abrir_servicio("mis_aportes")
        r = self.session.get(f"{B}/index.aspx",
                             headers={"Referer": "https://portalcf.cloud.afip.gob.ar/"})
        if "BtnIngresar" not in r.text and "InputPeriodoDesde" not in r.text:
            raise AFIPError(f"Aportes en Línea: no cargó el index ({_pista_pantalla(r.text)}).")

        # index -> "Ingresar" -> pantalla de período -> elegir 12m y "Continuar".
        r_sel = postback(f"{B}/index.aspx", r.text, "ctl00$ContentPlaceHolder1$BtnIngresar",
                         referer=f"{B}/index.aspx")
        extra = {
            "ctl00$ContentPlaceHolder1$InputPeriodoDesde$txtMes": desde[4:6],
            "ctl00$ContentPlaceHolder1$InputPeriodoDesde$txtAño": desde[0:4],
            "ctl00$ContentPlaceHolder1$InputPeriodoHasta$txtMes": hasta[4:6],
            "ctl00$ContentPlaceHolder1$InputPeriodoHasta$txtAño": hasta[0:4],
        }
        r_full = postback(f"{B}/consulta/seleccion.aspx", r_sel.text,
                          "ctl00$ContentPlaceHolder1$BtnContinuar", extra=extra,
                          referer=f"{B}/consulta/seleccion.aspx")
        html = r_full.text

        def parse_full(h):
            """De una pantalla MuestraFull.aspx: ([{razon_social,cuit}], [{periodo,bruto,incluye_sac}]).
            Los períodos (hidden `...ctlNN$Periodo`) y las celdas `TDConRemBruta` van 1:1 y en el mismo
            orden de documento, así que se extraen como dos listas y se combinan (evita ventanear entre
            los ~9 hidden intermedios de cada fila). El '(*)' del bruto = incluye SAC/aguinaldo."""
            emps = []
            mrs = re.search(r'id="ctl00_lblEmpleadorRazonSocial"[^>]*>([^<]*)', h)
            mcu = re.search(r'id="ctl00_lblEmpleadorCuil"[^>]*>([^<]*)', h)
            if mrs and mrs.group(1).strip():
                emps.append({
                    "razon_social": _html.unescape(mrs.group(1).strip()),
                    "cuit": (mcu.group(1).strip() if mcu else "").replace("-", ""),
                })
            per = re.findall(r'rptPeriodoConsFull\$ctl\d+\$Periodo"[^>]*value="(\d{6})"', h)
            bru = re.findall(r"TDConRemBruta'[^>]*>\s*(\(\*\))?\s*([\d.]+,\d{2})", h)
            rem = [
                {"periodo": p, "bruto": _num_ars(b), "incluye_sac": bool(s)}
                for p, (s, b) in zip(per, bru)
            ]
            return emps, rem

        pagina = (r_full.url or "").rsplit("/", 1)[-1].split("?")[0].lower()
        low = html.lower()
        # Cartel de ARCA cuando el contribuyente NO está en ninguna nómina del período (cae en
        # seleccionempleador.aspx con ese mensaje) = NO tiene relación de dependencia.
        sin_nomina = (
            "ninguna nómina" in low or "ninguna nomina" in low or "no se encuentra inclu" in low
        )

        empleadores, remuneraciones = [], []
        multi_sin_detalle = False
        if "ctl00_lblEmpleadorRazonSocial" in html:
            # Cayó directo en MuestraFull → 1 solo empleador.
            empleadores, remuneraciones = parse_full(html)
        elif pagina == "seleccionempleador.aspx" and not sin_nomina:
            # VARIOS empleadores: la grilla `rptEmpleadores` lista uno por fila con un botón-imagen
            # `BtnVerEmpleador` que abre su MuestraFull. Se itera cada uno y se acumula. El POST del
            # <input type=image> manda name.x/name.y; reusamos el VIEWSTATE de la grilla en cada click.
            botones = re.findall(
                r'name="(ctl00\$ContentPlaceHolder1\$rptEmpleadores\$ctl\d+\$BtnVerEmpleador)"', html
            )
            for btn in botones:
                data = hidden(html)
                data[f"{btn}.x"] = "8"
                data[f"{btn}.y"] = "8"
                rr = self.session.post(
                    f"{B}/consulta/seleccionempleador.aspx", data=data,
                    headers={"Content-Type": "application/x-www-form-urlencoded",
                             "Origin": "https://serviciossegsoc.afip.gob.ar",
                             "Referer": f"{B}/consulta/seleccionempleador.aspx"},
                )
                emps_i, rem_i = parse_full(rr.text)
                empleadores += emps_i
                remuneraciones += rem_i
            multi_sin_detalle = bool(botones) and not remuneraciones

        # Combinar por período (sumar entre empleadores) → serie de ingreso total mensual, cronológica.
        if remuneraciones:
            acum, con_sac = {}, {}
            for r in remuneraciones:
                acum[r["periodo"]] = acum.get(r["periodo"], 0.0) + r["bruto"]
                con_sac[r["periodo"]] = con_sac.get(r["periodo"], False) or r["incluye_sac"]
            remuneraciones = [
                {"periodo": p, "bruto": round(acum[p], 2), "incluye_sac": con_sac[p]}
                for p in sorted(acum)
            ]
        # Dedup de empleadores por CUIT (por si alguno se repite).
        vistos, emps_unicos = set(), []
        for e in empleadores:
            if e["cuit"] not in vistos:
                vistos.add(e["cuit"])
                emps_unicos.append(e)
        empleadores = emps_unicos
        total = round(sum(x["bruto"] for x in remuneraciones), 2)

        # es_rd: True (rel. dep.), False (sin nómina), None (no determinable → no afirmar ni pisar).
        if remuneraciones:
            es_rd = True
        elif sin_nomina:
            es_rd = False
        elif multi_sin_detalle or pagina == "seleccionempleador.aspx":
            # Hay empleadores (está en una nómina) aunque no hayamos podido leer el detalle.
            es_rd = True
            self.log.warning("Aportes %s: varios empleadores pero sin detalle leído (parcial).", self.cuit)
        else:
            # Pantalla inesperada (re-render de seleccion.aspx, 'Ha ocurrido un error', ErrorPage):
            # None = no tocamos el estado guardado.
            es_rd = None
            self.log.info("Aportes %s: sin datos determinables (%s: %s)",
                          self.cuit, pagina, _pista_pantalla(html))
        self.log.info("Aportes %s: rel_dep=%s empleadores=%d periodos=%d total=%.2f",
                      self.cuit, es_rd, len(empleadores), len(remuneraciones), total)
        return {
            "es_relacion_dependencia": es_rd,  # True | False | None (no determinable)
            "periodo_desde": desde,
            "periodo_hasta": hasta,
            "empleadores": empleadores,
            "remuneraciones": remuneraciones,
            "total_bruto": total,
        }

    def lsp_consultar(
        self, direccion: str = "receptor", *, sector: str = "hacienda", desde=None, hasta=None,
        _reintento: bool = True,
    ) -> list[dict]:
        """Lista las liquidaciones electrónicas del `sector` (grilla, SIN importe).

        Args:
            direccion: 'receptor' (le compran al cliente; el ~95%) o 'emisor'.
            sector: clave de LSP_SECTORES (por ahora sólo 'hacienda').
            desde, hasta: fecha (date o 'dd/mm/aaaa'); default 2000-01-01 → hoy.

        Devuelve dicts: cuit_contraparte, tipo_liq, cbte_tipo, punto_venta, numero,
        fecha_comprobante, fecha_emision, sistema, liq_id (el id de AFIP para el PDF).
        """
        base = self._lsp_preparar(sector)
        if direccion == "receptor":
            cpage, action = "consultaLiquidacionReceptor", "filtarLiquidacionesReceptor"
        elif direccion == "emisor":
            cpage, action = "consultaLiquidacionEmisor", "filtarLiquidacionesEmisor"
        else:
            raise AFIPError(f"direccion inválida: {direccion!r} (usar 'receptor'|'emisor').")
        self.session.get(f"{base}/{cpage}", headers={"Referer": f"{base}/inicioPerfil.htm"})
        params = {
            "sortDirections": "desc", "sortFields": "fechaCreacion",
            "displayLength": "500", "currentPage": "1",
            "cuitEmisor": "", "nroComprobante": "", "sistemaIngreso": "-1", "tipoDeComprobante": "-1",
            "fechaDesde": self._fmt_fecha(desde or _dt.date(2000, 1, 1)),
            "fechaHasta": self._fmt_fecha(hasta or _dt.date.today()),
        }
        r = self.session.get(f"{base}/{action}", params=params, headers={"Referer": f"{base}/{cpage}"})
        html_txt = r.text
        # La grilla SIEMPRE trae un <tbody> (con filas o con "No resultados de busqueda"). Si NO está,
        # la sesión LSP no quedó establecida (cayó en final.htm/error, p.ej. por una colisión con otra
        # sesión del mismo CUIT): NO es "sin liquidaciones". Reabrimos el doble SSO y reintentamos UNA
        # vez (auto-sanación); si sigue sin grilla, lo levantamos → el caller lo marca reintentable en
        # vez de registrar un falso "sin liquidaciones".
        if "<tbody" not in html_txt:
            self._lsp_sector = None
            if _reintento:
                self.log.warning("LSP %s/%s sin grilla (%s); reabro SSO y reintento", sector, direccion, r.url)
                time.sleep(2)
                return self.lsp_consultar(
                    direccion, sector=sector, desde=desde, hasta=hasta, _reintento=False
                )
            raise AFIPError(
                f"Liquidaciones {sector}/{direccion}: la grilla no cargó (sesión no establecida)."
            )
        tb = html_txt[html_txt.find("<tbody>"): html_txt.find("</tbody>")]
        filas = []
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S):
            did = re.search(r'data-id="(\d+)"', tr)
            tds = [
                re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", td)).strip()
                for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
            ]
            if len(tds) < 7 or not did:
                continue
            pv, nro = self._lsp_split_numero(tds[3])
            filas.append({
                "cuit_contraparte": tds[0], "tipo_liq": tds[1], "cbte_tipo": int(tds[2] or 0),
                "punto_venta": pv, "numero": nro,
                "fecha_comprobante": tds[4], "fecha_emision": tds[5], "sistema": tds[6],
                "liq_id": did.group(1),
            })
        self.log.info("LSP %s/%s: %s liquidaciones", sector, direccion, len(filas))
        return filas

    def lsp_pdf(self, liq_id, *, sector: str = "hacienda") -> bytes:
        """Descarga el PDF de una liquidación (de ahí sale el Importe Bruto)."""
        base = self._lsp_preparar(sector)
        r = self.session.get(
            f"{base}/consultaLiquidacion/getPdf?id={liq_id}",
            headers={"Referer": f"{base}/consultaLiquidacionReceptor"},
        )
        if not r.content.startswith(b"%PDF"):
            raise AFIPError(f"getPdf {liq_id} no devolvió un PDF (¿sesión caída?).")
        return r.content

    def verificar(self) -> bool:
        """Comprueba que la sesión esté viva cargando el portal."""
        r = self.session.get(URL_PORTAL_APP)
        ok = r.status_code == 200 and "Portal de Clave Fiscal" in r.text
        self.log.info("Verificación de sesión: %s", "OK" if ok else "FALLÓ")
        return ok

    @property
    def cookies(self) -> dict:
        return self.session.cookies.get_dict()


class AFIPMulti:
    """Maneja varios clientes AFIP, una sesión aislada por CUIT (multi-tenant).

    Cada CUIT tiene su propia instancia AFIP (Session/cookies/estado propios), así
    que los clientes nunca se pisan. El login es lazy: los métodos de AFIP
    (consultar, monotributo, ...) se loguean solos la primera vez.

    Uso:
        m = AFIPMulti()
        m.set("20111111111", "claveA")     # registrar credenciales
        m.set("20222222222", "claveB")
        comps = m["20111111111"].consultar(tipo="ER", periodo="mes")
        mono  = m["20222222222"].monotributo()
    """

    def __init__(self, *, verbose: bool = True) -> None:
        self.verbose = verbose
        self._claves: dict[str, str] = {}
        self._clientes: dict[str, AFIP] = {}

    @staticmethod
    def _norm(cuit) -> str:
        return str(cuit).replace("-", "").strip()

    def set(self, cuit, password: str) -> None:
        """Registra (o actualiza) la clave de un CUIT. No se loguea todavía."""
        cuit = self._norm(cuit)
        self._claves[cuit] = password
        # Si ya había instancia con otra clave, descartarla.
        if cuit in self._clientes and self._clientes[cuit].password != password:
            self._clientes.pop(cuit, None)

    def get(self, cuit, password: str | None = None) -> AFIP:
        """Devuelve la instancia AFIP del CUIT, creándola si hace falta."""
        cuit = self._norm(cuit)
        if password:
            self.set(cuit, password)
        if cuit not in self._clientes:
            clave = self._claves.get(cuit)
            if not clave:
                raise AFIPError(f"No hay clave registrada para {cuit}. Usá set().")
            self._clientes[cuit] = AFIP(cuit, clave, verbose=self.verbose)
        return self._clientes[cuit]

    __getitem__ = get

    def remove(self, cuit) -> None:
        """Olvida un cliente (cierra su sesión en memoria)."""
        cuit = self._norm(cuit)
        self._clientes.pop(cuit, None)
        self._claves.pop(cuit, None)

    def cuits(self) -> list[str]:
        return list(self._claves)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Uso: python -m app.arca.afip <cuit> <clave>")
        raise SystemExit(2)
    cuit, clave = sys.argv[1], sys.argv[2]

    afip = AFIP(cuit, clave)
    afip.login()
    afip.verificar()
    print("\nCookies finales:")
    for k, v in afip.cookies.items():
        print(f"  {k} = {v}")
