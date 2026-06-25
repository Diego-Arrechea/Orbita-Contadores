"""
Adaptadores del motor HTTP (afip.py) a las formas que ya consume el backend.

Cada función replica la firma/salida del scraper de browser equivalente, pero por
HTTP. El dispatch http/browser lo decide `motor.py` según `settings.motor_scraping`.

NOTA multi-tenant: en producción cada cliente es TITULAR de su propia clave
(`cuit_login == cuit_cliente`, verificado: 0 representados). afip.py opera como
titular (idContribuyente=0), así que con `AFIP(cuit_login, clave)` alcanza.
"""
from __future__ import annotations

import functools
import threading
import time as _time

from .afip import AFIP, AFIPError

# Mensaje (en términos del dominio, sin exponer el mecanismo) cuando el cliente no
# tiene cuenta corriente CCMA (no es monotributista ni autónomo). Espeja scraping/ccma.
MSG_NO_CCMA = (
    "El estado de cuenta solo aplica a monotributistas y autónomos, "
    "y este cliente no es ninguno de los dos."
)


# --- Sesión AFIP reutilizable por CUIT ----------------------------------------
# El login (4 POST JSF) es lo más caro del ciclo. El motor corre 2-3 flujos seguidos
# por cliente (comprobantes + padrón + deuda); con una sola sesión por cliente se
# loguea UNA vez en vez de 2-3 → ~3-5s menos por cliente (× cartera = minutos/ciclo).
# La caché es por-proceso (worker y API tienen la suya); el lock por CUIT serializa
# los flujos de un mismo cliente sobre su sesión (requests.Session no es thread-safe).
_TTL_SESION = 300.0  # s: reusar mientras siga fresca (los flujos van back-to-back)
_sesiones: dict[str, tuple] = {}            # cuit -> (afip, expira_en)
_locks_cuit: dict[str, threading.Lock] = {}
_glob = threading.Lock()


def _lock_cuit(cuit: str) -> threading.Lock:
    """Lock por CUIT (se toma alrededor de CADA operación que usa la sesión cacheada)."""
    with _glob:
        lk = _locks_cuit.get(cuit)
        if lk is None:
            lk = _locks_cuit[cuit] = threading.Lock()
        return lk


def _sesion(cuit_login: str, clave: str) -> AFIP:
    """AFIP logueado para el CUIT, reusando la sesión vigente (un login compartido por
    todos sus flujos). Llamar SIEMPRE bajo `with _lock_cuit(cuit_login):`."""
    ahora = _time.time()
    cerrar = []
    with _glob:
        ent = _sesiones.get(cuit_login)
        if ent and ent[1] > ahora and ent[0].logged_in and ent[0].password == clave:
            return ent[0]
        # ausente/vencida/clave cambiada: la sacamos. De paso barremos las vencidas.
        for c, (af, exp) in list(_sesiones.items()):
            if c == cuit_login or exp <= ahora:
                cerrar.append(af)
                _sesiones.pop(c, None)
    for af in cerrar:  # cerrar conexiones fuera del lock
        try:
            af.session.close()
        except Exception:  # noqa: BLE001
            pass
    afip = AFIP(cuit_login, clave, verbose=False)
    afip.login()
    with _glob:
        _sesiones[cuit_login] = (afip, ahora + _TTL_SESION)
    return afip


def _con_sesion(fn):
    """Decorador para los adaptadores: inyecta `afip` (logueado, sesión REUTILIZADA)
    como 1er argumento, todo bajo el lock del CUIT. El 1er arg posicional del adaptador
    es el CUIT con cuya clave se loguea; el 2do es la clave."""
    @functools.wraps(fn)
    def wrap(cuit: str, clave: str, *a, **k):
        with _lock_cuit(cuit):
            return fn(_sesion(cuit, clave), cuit, clave, *a, **k)

    return wrap


# --- helpers de normalización (espejo de scraping/miscomprobantes) -------------
def _num(s) -> float:
    """Importe/cotización de la grilla AJAX de mcmp: punto decimal, sin separador
    de miles ('19946.79', '230000', '1391.5'). '' / None -> 0.0."""
    s = (str(s) if s is not None else "").strip()
    if not s:
        return 0.0
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return 0.0


def _moneda(s) -> str:
    """'$' -> 'ARS'; el resto (USD, EUR…) tal cual. Vacío -> 'ARS'."""
    s = (str(s) if s is not None else "").strip().upper()
    return "ARS" if s in ("", "$", "PES", "PESOS", "ARS") else s


def _fecha_yyyymmdd(f: str | None) -> str | None:
    """'dd/mm/aaaa' -> 'yyyymmdd' (el formato que espera el upsert)."""
    if not f or "/" not in f:
        return None
    d, m, y = f.split("/")
    return f"{y}{m.zfill(2)}{d.zfill(2)}"


def _map_comprobante(c: dict) -> dict | None:
    """dict crudo de afip.py (mcmp) -> dict que espera services/sincronizacion._upsert.

    Mismas claves/tipos que scraping.miscomprobantes.parsear_csv_zip:
    cbte_tipo/punto_venta/numero (int), fecha ('yyyymmdd'), imp_total (float en la
    moneda de origen), moneda, cotizacion, doc_nro, contraparte_nombre, cae.
    """
    fecha = _fecha_yyyymmdd(c.get("fecha"))
    numero = int(c.get("nro_desde") or 0)
    if not fecha or not numero:
        return None
    return {
        "cbte_tipo": int(c.get("tipo_cmp") or 0),
        "punto_venta": int(c.get("punto_venta") or 0),
        "numero": numero,
        "fecha": fecha,
        "imp_total": _num(c.get("imp_total")),
        "moneda": _moneda(c.get("moneda")),
        "cotizacion": _num(c.get("tipo_cambio")) or 1.0,
        "doc_nro": str(c.get("nro_doc_receptor") or ""),
        "contraparte_nombre": str(c.get("denominacion_receptor") or ""),
        "cae": str(c.get("cod_autorizacion") or ""),
    }


# --- Comprobantes (reemplaza miscomprobantes.descargar) ------------------------
@_con_sesion
def descargar(
    afip: AFIP,
    cuit_login: str,
    clave: str,
    cuit_cliente: str,
    plan: list[dict],
    on_progress=None,
) -> tuple[str | None, dict[str, list[dict]]]:
    """Trae las secciones del `plan` por HTTP. Devuelve (nombre, {direccion: [dicts]}).

    `nombre` = nombre/razón social del contribuyente (del portal, /api/persona); None si
    no se pudo leer (el upsert sólo pisa `cliente.nombre` si viene truthy, así lo conserva).
    """
    total = sum(len(p.get("rangos") or []) for p in plan)
    paso = 0
    out: dict[str, list[dict]] = {}
    for p in plan:
        direccion = p["direccion"]
        tipo = "E" if direccion == "emitido" else "R"
        rangos = p.get("rangos") or []
        vistos: set[tuple] = set()
        comps: list[dict] = []
        for desde, hasta in rangos:
            if on_progress:
                paso += 1
                on_progress(paso, total, f"{direccion}s {desde} a {hasta}")
            for crudo in afip.consultar_comprobantes(desde, hasta, tipo=tipo):
                m = _map_comprobante(crudo)
                if not m:
                    continue
                k = (m["punto_venta"], m["cbte_tipo"], m["numero"])
                if k not in vistos:
                    vistos.add(k)
                    comps.append(m)
        out[direccion] = comps
    # Nombre real del contribuyente (lo que el browser leía del navbar de Mis Comprobantes).
    return afip.nombre_contribuyente(cuit_cliente), out


def _cuota_desde_deuda(det: dict) -> dict:
    """Detalle de `calcular_deuda()` -> {cuota_estado, cuota_deuda, cuota_saldo_favor,
    deuda_detalle}. Si `deudor` es None (pantalla sin tabla, p. ej. bonificado/al día
    especial) devuelve {} para NO pisar la cuota previa — mismo criterio que el scraper
    viejo (`ccma._resumen_cuota`). Validado vs prod: deudor/capital/intereses coinciden."""
    deudor = det.get("deudor")
    if deudor is None:
        return {}
    return {
        "cuota_estado": "con-deuda" if deudor > 0 else "al-dia",
        "cuota_deuda": round(deudor, 2),
        "cuota_saldo_favor": round(det.get("acreedor") or 0.0, 2),
        "deuda_detalle": det,
    }


# --- Deuda CCMA (reemplaza ccma.consultar_deuda) -------------------------------
@_con_sesion
def consultar_deuda(afip: AFIP, cuit_login: str, clave: str, cuit_objetivo: str | None = None) -> dict:
    """Detalle de deuda CCMA por HTTP (Cálculo de Deuda oficial, P02->P04). Devuelve
    {cuota_estado, cuota_deuda, cuota_saldo_favor, deuda_detalle}, o {no_aplica, motivo}
    si el CUIT no tiene cuenta corriente (no es monotributista ni autónomo)."""
    try:
        det = afip.calcular_deuda()
    except AFIPError:
        return {"no_aplica": True, "motivo": MSG_NO_CCMA}
    return _cuota_desde_deuda(det)


# --- Padrón / Monotributo (reemplaza padron.datos_monotributo) -----------------
@_con_sesion
def datos_monotributo(afip: AFIP, cuit_login: str, clave: str, cuit_objetivo: str | None = None) -> dict:
    """Datos del padrón de Monotributo por HTTP. Mismas claves que el scraper viejo.

    Prod es 100% titular: `cuit_objetivo == cuit_login`. Trae categoría/actividad/
    recategorización/facturómetro/vencimiento/débito del panel + la cuota
    (cuota_estado/deuda/saldo_favor + deuda_detalle) del Cálculo de Deuda oficial
    (P02->P04, validado vs prod). Espeja al padrón viejo que bundleaba estado_cuota.
    """
    m = afip.monotributo()
    if not m.get("es_monotributista"):
        # no monotributista (o sin determinar): mismo contrato que el scraper viejo
        return {"es_monotributista": m.get("es_monotributista", False)}
    pv = m.get("proximo_vencimiento") or {}
    out = {
        "es_monotributista": True,
        "categoria": m.get("categoria"),
        "actividad": m.get("actividad"),
        "prox_recategorizacion": m.get("prox_recategorizacion"),
        "prox_venc_fecha": pv.get("fecha"),
        "prox_venc_importe": pv.get("importe"),
        "debito_automatico": m.get("debito_automatico"),
    }
    # Facturómetro: SELF-HEAL — sólo persistir si el monto es > 0. Un 0 transitorio
    # (AJAX a medio cargar) pisaría el último valor bueno → la ficha mostraría $0
    # sobre un cliente que sí facturó. Mismo criterio que el padrón viejo (padron.extraer).
    monto = m.get("monto_facturado")
    if monto and monto > 0:
        out["facturacion_12m"] = monto
        tope = m.get("tope_categoria")
        if tope and tope > 0:
            out["tope_categoria"] = tope
        out["facturometro_actualizado"] = m.get("ultima_actualizacion")
    # Cuota desde el Cálculo de Deuda oficial (capital + intereses). best-effort: si
    # el CUIT no tiene CCMA o falla, seguimos sin cuota (no se pisa el valor previo).
    try:
        out.update(_cuota_desde_deuda(afip.calcular_deuda()))
    except Exception:  # noqa: BLE001
        pass
    return out


# --- Representados (reemplaza scraping.onboarding.listar_representados) ---------
@_con_sesion
def listar_representados(afip: AFIP, cuit: str, clave: str) -> list[dict]:
    """[{cuit, nombre}] del logueado + sus representados (mismo formato que el scraper)."""
    return afip.representados()


# --- Puntos de venta (ABM pvel) — sólo HTTP (afip.py; el browser nunca lo hizo) -
@_con_sesion
def puntos_venta_pvel(afip: AFIP, cuit_login: str, clave: str) -> list[dict]:
    """Lista los PV del cliente desde el ABM (pvel): [{nro, sistema, baja, bloqueado, …}].
    Distinto de wsfev1.listar_puntos_venta (que sólo trae los habilitados para WS)."""
    return afip.pventa_listar(incluir_baja=False)


@_con_sesion
def crear_punto_venta(
    afip: AFIP, cuit_login: str, clave: str, nombre: str = "Órbita", sistema: str = "MAW"
) -> dict:
    """Crea un punto de venta (default MAW = Factura Electrónica Monotributo Web Services;
    el sistema que se factura por WSFEv1). Nro auto (máx+1). Devuelve la respuesta del alta."""
    return afip.pventa_crear(nombre, sistema)


# --- Certificado (reemplaza scraping.bootstrap.bootstrap_cliente) --------------
def bootstrap_cliente(
    cuit_cliente: str, cuit_login: str, clave: str, alias: str | None = None, on_progress=None
) -> tuple[bytes, bytes]:
    """Genera el certificado del cliente por HTTP (crea el cert + lo asocia al WS de
    Facturación Electrónica) y devuelve (cert_pem, key_pem). Firma compatible con
    scraping.bootstrap.bootstrap_cliente. Prod es titular: cuit_cliente == cuit_login.

    No usa el decorador `@_con_sesion` porque el CUIT del login es el 2º arg (cuit_login),
    no el 1º; pero igual reusa la sesión por CUIT."""
    with _lock_cuit(cuit_login):
        afip = _sesion(cuit_login, clave)
        res = afip.bootstrap_certificado(alias_base=alias or "orbita", on_progress=on_progress)
        return res["cert_pem"], res["key_pem"]
