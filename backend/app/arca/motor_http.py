"""
Adaptadores del motor HTTP (afip.py) a las formas que ya consume el backend.

Cada función replica la firma/salida del scraper de browser equivalente, pero por
HTTP. El dispatch http/browser lo decide `motor.py` según `settings.motor_scraping`.

NOTA multi-tenant: en producción cada cliente es TITULAR de su propia clave
(`cuit_login == cuit_cliente`), así que con `AFIP(cuit_login, clave)` alcanza.
OJO: algunos titulares ADEMÁS representan a otra persona/empresa; ahí Mis
Comprobantes exige elegir contribuyente y afip.py fija el índice del titular
(ver _idcontribuyente_objetivo) — no se asume idContribuyente=0.
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


def _adjuntar_saldos_p05(afip: AFIP, cuota: dict, *, solo_si_deuda: bool) -> dict:
    """Enriquece el dict de cuota (`_cuota_desde_deuda`) con la Consulta de Saldos (P05): setea
    `meses_adeudados` (racha de meses DEUDOR de monotributo) y guarda los saldos por período limpios
    en `deuda_detalle["saldos_periodo"]` — P05 da el estado por período YA RESUELTO (DEUDOR/SALDADO/
    ACREEDOR), a diferencia del ledger de P04 que viene flaky.

    Reusa el estado del Cálculo de Deuda ya hecho (asegurar_calculo=False) → +1 request. Con
    `solo_si_deuda=True` (sync masiva) SALTA P05 en los al-día: no aportan racha y así ahorramos el
    request en la mayor parte de la cartera (racha = 0). best-effort: si falla, no pisa nada previo."""
    estado = cuota.get("cuota_estado")
    if solo_si_deuda and estado != "con-deuda":
        if estado == "al-dia":
            cuota["meses_adeudados"] = 0  # al día → racha 0 (self-heal si venía debiendo)
        return cuota
    try:
        filas = afip.saldos_ccma(asegurar_calculo=False)
        cuota["meses_adeudados"] = afip._contar_meses_deudor(filas)  # la racha está arriba (más nuevo)
        if isinstance(cuota.get("deuda_detalle"), dict):
            # P05 puede traer toda la vida de la cuenta (cientos de meses): guardamos sólo los últimos
            # 24 (más reciente primero) — alcanza para la racha y para el detalle del Estado de cuenta.
            cuota["deuda_detalle"]["saldos_periodo"] = filas[:24]
    except Exception:  # noqa: BLE001
        pass
    return cuota


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
    # On-demand ("Consultar deuda"): SIEMPRE traemos P05 (meses adeudados + saldos por período para
    # el detalle del Estado de cuenta), el contador abrió el estado de cuenta a propósito.
    return _adjuntar_saldos_p05(afip, _cuota_desde_deuda(det), solo_si_deuda=False)


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
    # el CUIT no tiene CCMA o falla, seguimos sin cuota (no se pisa el valor previo). Los meses
    # adeudados (P05) sólo se piden si el cliente está con deuda (solo_si_deuda=True): así la sync
    # masiva NO gasta el request de P05 en los al-día (la mayoría), que quedan en racha 0.
    try:
        out.update(_adjuntar_saldos_p05(afip, _cuota_desde_deuda(afip.calcular_deuda()), solo_si_deuda=True))
    except Exception:  # noqa: BLE001
        pass
    # Snapshot del domicilio fiscal del EMISOR (para imprimir el comprobante emitido). best-effort:
    # si no hay domicilio, se omite y el snapshot previo no se pisa (ver sincronizar_padron).
    try:
        fiscal = afip.datos_fiscales(cuit_objetivo or cuit_login)
        if fiscal.get("domicilio"):
            out["emisor_fiscal"] = fiscal
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


# --- Domicilio Fiscal Electrónico / e-ventanilla (comunicaciones) --------------
@_con_sesion
def comunicaciones(
    afip: AFIP, cuit_login: str, clave: str, cuit_objetivo: str | None = None, desde=None, hasta=None
) -> list[dict]:
    """Comunicaciones del DFE (dicts normalizados de afip.notificaciones_listar: id,
    fecha_publicacion/vencimiento como datetime, sistema, organismo, leida, prioridad,
    tiene_adjunto, mensaje resumido).

    `cuit_objetivo`: a quién le consultamos. Titular → == cuit_login (default). REPRESENTADO →
    el CUIT del representado; ARCA lo autoriza si el logueado tiene el DFE delegado por ese CUIT."""
    return afip.notificaciones_listar(desde, hasta, cuit=cuit_objetivo or cuit_login)


@_con_sesion
def comunicacion_detalle(
    afip: AFIP, cuit_login: str, clave: str, id_com, cuit_objetivo: str | None = None
) -> dict:
    """Detalle completo de una comunicación (mensaje entero). El GET del detalle es lo que hace que
    ARCA la marque como leída (no hay endpoint de 'marcar leído' explícito). `cuit_objetivo` = dueño
    de la comunicación (el representado si aplica; default = logueado)."""
    return afip.notificacion_detalle(id_com, cuit=cuit_objetivo or cuit_login)


# --- Liquidaciones Electrónicas del sector primario (agro) — SÓLO HTTP ---------
def _map_liquidacion(r: dict, direccion: str, sector: str, importe_bruto: float | None) -> dict:
    """Fila de afip.lsp_consultar (+ importe del PDF) -> dict que espera services/agro._upsert."""
    return {
        "liq_id": str(r["liq_id"]),
        "sector": sector,
        "direccion": direccion,
        "cbte_tipo": int(r.get("cbte_tipo") or 0),
        "tipo_liq": (r.get("tipo_liq") or "")[:80],
        "punto_venta": int(r.get("punto_venta") or 0),
        "numero": int(r.get("numero") or 0),
        "cuit_contraparte": str(r.get("cuit_contraparte") or ""),
        "fecha_comprobante": r.get("fecha_comprobante"),  # 'dd/mm/aaaa'
        "fecha_emision": r.get("fecha_emision"),           # 'dd/mm/aaaa'
        "sistema": (r.get("sistema") or "")[:4],
        "importe_bruto": importe_bruto,                     # del PDF; None = no se pudo leer
    }


_PAUSA_PDF = 1.5  # s entre descargas de PDF (anti rate-limit del WAF de serviciosjava2)


@_con_sesion
def liquidaciones_agro(
    afip: AFIP,
    cuit_login: str,
    clave: str,
    cuit_cliente: str,
    sector: str = "hacienda",
    desde=None,
    hasta=None,
    con_importe: bool = True,
    on_progress=None,
) -> list[dict]:
    """Trae las Liquidaciones Electrónicas del `sector` (receptor + emisor).

    `con_importe=True`: por cada liquidación baja el PDF y parsea el Importe Bruto (más pesado; se
    pacea entre PDF para no gatillar el WAF de serviciosjava2). `con_importe=False` (modo DETECCIÓN):
    sólo la grilla, sin PDFs → mucho más liviano; el importe queda en None (se llena después). La
    grilla ya alcanza para saber si el cliente ES agropecuario. Devuelve dicts para agro._upsert."""
    out: list[dict] = []
    liq_pdf = None
    if con_importe:
        from ..services import liquidacion_pdf as liq_pdf
    for direccion in ("receptor", "emisor"):
        filas = afip.lsp_consultar(direccion, sector=sector, desde=desde, hasta=hasta)
        for i, r in enumerate(filas):
            if on_progress:
                on_progress(f"{direccion} {i + 1}/{len(filas)}")
            bruto = None
            if con_importe:
                try:
                    bruto = liq_pdf.importe_bruto(afip.lsp_pdf(r["liq_id"], sector=sector))
                except Exception:  # noqa: BLE001  (un PDF ilegible no debe cortar toda la sync)
                    bruto = None
                _time.sleep(_PAUSA_PDF)
            out.append(_map_liquidacion(r, direccion, sector, bruto))
    return out


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
