"""
Mis Comprobantes — descarga los comprobantes EMITIDOS (ventas) y RECIBIDOS (compras) desde
fes.afip.gob.ar/mcmp. Es la fuente COMPLETA (incluye facturador web, webservice y controlador
fiscal). Se loguea con la clave fiscal del contador, actúa en representación del cliente, exporta
el CSV (viene en un ZIP) y lo parsea.

- Emitidos: la contraparte es el RECEPTOR (cliente). Sirven para el tope/categoría.
- Recibidos: la contraparte es el EMISOR (proveedor). Sirven para la causal de exclusión por gastos.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from patchright.sync_api import sync_playwright

from ..config import BASE_DIR, settings
from . import _comun
from ._traza import Traza

# Cada sección de "Mis Comprobantes": botón del menú, dirección y de qué columna sale la contraparte.
PLAN_EMITIDOS = {"boton": "#btnEmitidos", "direccion": "emitido", "contraparte": "receptor"}
PLAN_RECIBIDOS = {"boton": "#btnRecibidos", "direccion": "recibido", "contraparte": "emisor"}


def _num(s: str) -> float:
    """'1.068.078,81' o '397299,75' -> float (formato AR: coma decimal, punto de miles)."""
    s = (s or "").strip()
    if not s:
        return 0.0
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0


def _moneda(s: str) -> str:
    """Normaliza la columna 'Moneda' del CSV. El peso viene como '$' (a veces 'PES'); el resto
    (USD, EUR, …) se deja con su código tal cual. Vacío -> 'ARS' (asumimos pesos)."""
    s = (s or "").strip().upper()
    return "ARS" if s in ("", "$", "PES", "PESOS", "ARS") else s


def parsear_csv_zip(zip_bytes: bytes, contraparte: str = "receptor") -> list[dict]:
    """Descomprime el ZIP de Mis Comprobantes y parsea el CSV (sep ';', UTF-8) a dicts. La
    contraparte sale de 'receptor' (emitidos) o 'emisor' (recibidos)."""
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    csvs = [n for n in z.namelist() if n.lower().endswith(".csv")] or z.namelist()
    texto = z.read(csvs[0]).decode("utf-8-sig")
    filas = list(csv.reader(texto.splitlines(), delimiter=";", quotechar='"'))
    if not filas:
        return []
    idx = {c.strip().lower(): i for i, c in enumerate(filas[0])}

    def col(fila: list[str], *nombres: str) -> str:
        for n in nombres:
            i = idx.get(n.lower())
            if i is not None and i < len(fila):
                return fila[i].strip()
        return ""

    out: list[dict] = []
    for fila in filas[1:]:
        if not fila or len(fila) < 5:
            continue
        fecha = col(fila, "fecha de emisión", "fecha de emision")
        out.append(
            {
                "cbte_tipo": int(col(fila, "tipo de comprobante") or 0),
                "punto_venta": int(col(fila, "punto de venta") or 0),
                "numero": int(col(fila, "número desde", "numero desde") or 0),
                "fecha": fecha.replace("-", ""),  # -> yyyymmdd
                # OJO: 'imp. total' viene en la MONEDA DE ORIGEN del comprobante (p.ej. USD para
                # exportación). La conversión a pesos (imp_total_origen × cotizacion) la hace el
                # upsert; ver services/sincronizacion.py.
                "imp_total": _num(col(fila, "imp. total")),
                "moneda": _moneda(col(fila, "moneda")),
                "cotizacion": _num(col(fila, "tipo cambio")) or 1.0,
                "doc_nro": col(fila, f"nro. doc. {contraparte}"),
                "cae": col(fila, "cód. autorización", "cod. autorizacion", "cód. autorizacion"),
                "contraparte_nombre": col(
                    fila, f"denominación {contraparte}", f"denominacion {contraparte}"
                ),
            }
        )
    return out


def ventanas(desde: dt.date, hasta: dt.date) -> list[tuple[str, str]]:
    """Parte el intervalo [desde, hasta] en ventanas de <=365 días (tope de Mis Comprobantes),
    en formato 'dd/mm/aaaa'."""
    out: list[tuple[str, str]] = []
    ini = desde
    while ini <= hasta:
        fin = min(ini + dt.timedelta(days=364), hasta)
        out.append((ini.strftime("%d/%m/%Y"), fin.strftime("%d/%m/%Y")))
        ini = fin + dt.timedelta(days=1)
    return out


def _mcmp_tab(ctx):
    return next((pg for pg in ctx.pages if "mcmp" in pg.url), None)


def _diagnostico(ctx, cuit: str, traza: Traza) -> str:
    """Al fallar: vuelca la traza de pasos + screenshot + HTML + texto visible de la(s) pestaña(s)
    de ARCA a data/diag/ (ahí suele estar el mensaje real del error), y devuelve un resumen corto
    para incluir en el `motivo` del fallo. Nombres por-CUIT (se pisan): queda SIEMPRE el último
    fallo de cada cliente, así el disco no crece. El HTML sirve para ajustar selectores si ARCA
    rediseña una pantalla."""
    diag = BASE_DIR / "data" / "diag"
    diag.mkdir(parents=True, exist_ok=True)
    try:
        (diag / f"traza_{cuit}.json").write_text(
            json.dumps(
                {"fase": traza.fase, "pasos": traza.pasos}, ensure_ascii=False, indent=2
            ),
            encoding="utf-8",
        )
    except Exception:  # noqa: BLE001
        pass
    partes: list[str] = []
    for i, pg in enumerate(ctx.pages):
        try:
            if "afip" not in pg.url:
                continue
            pg.screenshot(path=str(diag / f"fallo_{cuit}_{i}.png"), full_page=True)
            try:
                (diag / f"fallo_{cuit}_{i}.html").write_text(pg.content(), encoding="utf-8")
            except Exception:  # noqa: BLE001
                pass
            partes.append(" ".join(pg.inner_text("body").split())[:200])
        except Exception:  # noqa: BLE001
            pass
    cuerpo = " | ".join(partes) if partes else "(sin pestaña de ARCA)"
    return f" | {cuerpo} [diag: {diag}]"


def _cuit_formateado(cuit: str) -> str:
    """11 dígitos -> 'XX-XXXXXXXX-X' (como lo muestra ARCA en las tarjetas)."""
    return f"{cuit[:2]}-{cuit[2:10]}-{cuit[10:]}" if len(cuit) == 11 else cuit


def _elegir_contribuyente(ctx, mcmp, cuit_objetivo: str, traza: Traza):
    """Cuando la clave representa a VARIAS personas, Mis Comprobantes mete una pantalla intermedia
    'Elegí una persona para ingresar' (cada persona es un `<a class="panel ...">` con su CUIT).
    Elige la tarjeta del CUIT objetivo y entra. Idempotente: si esa pantalla no aparece
    (representación única, el caso normal), no hace nada."""
    cuit_fmt = _cuit_formateado(cuit_objetivo)
    try:
        aviso = mcmp.get_by_text(re.compile(r"eleg[ií] una persona", re.I)).first
        if aviso.count() == 0 or not aviso.is_visible():
            return mcmp  # representación única: no hay pantalla de selección
    except Exception:  # noqa: BLE001
        return mcmp
    traza.paso(f"elegir contribuyente {cuit_fmt}", mcmp)
    tarjeta = mcmp.locator("a.panel").filter(has_text=cuit_fmt).first
    tarjeta.wait_for(state="visible", timeout=10000)
    tarjeta.click()
    mcmp.wait_for_timeout(4000)  # el form submitea y carga el menú Emitidos/Recibidos
    return _mcmp_tab(ctx) or mcmp


def _abrir_mis_comprobantes(page, ctx, cuit_objetivo: str, traza: Traza):
    """Desde el portal abre 'Mis Comprobantes' y queda en el menú (Emitidos/Recibidos). Si la clave
    representa a varias personas, primero elige al `cuit_objetivo` en la pantalla de selección."""
    traza.paso("portal: abrir 'Mis Comprobantes'", page)
    page.goto(_comun.PORTAL)
    # esperar_idle TOLERANTE (no `wait_for_load_state('networkidle')` a secas): ARCA mantiene
    # conexiones abiertas y nunca queda 'idle', así que el networkidle colgaba hasta su timeout
    # de 30s y tiraba un "Timeout 30000ms exceeded." genérico (sin pista de dónde).
    _comun.esperar_idle(page)
    b = page.locator("#buscadorInput")
    b.wait_for(state="visible", timeout=20000)
    b.click()
    b.fill("")
    b.press_sequentially("Mis Comprobantes", delay=80)
    page.wait_for_timeout(2500)
    traza.paso("portal: click opción 'Mis Comprobantes'", page)
    page.locator('li[role="option"]').filter(
        has_text=re.compile("Mis Comprobantes", re.I)
    ).first.click()
    page.wait_for_timeout(6000)
    _comun.click_continuar_si_aparece(ctx)
    page.wait_for_timeout(2000)
    traza.paso("esperar pestaña Mis Comprobantes", page)
    mcmp = _mcmp_tab(ctx)
    if mcmp is None:
        raise RuntimeError("No se abrió Mis Comprobantes.")
    # Clave con varias representaciones → elegir al contribuyente objetivo antes del menú.
    mcmp = _elegir_contribuyente(ctx, mcmp, cuit_objetivo, traza)
    return mcmp


def _volver_menu(ctx, mcmp):
    mcmp = _mcmp_tab(ctx) or mcmp
    try:
        mcmp.locator('a[href*="menuPrincipal"]').first.click()
        mcmp.wait_for_timeout(2500)
    except Exception:  # noqa: BLE001
        pass
    return _mcmp_tab(ctx) or mcmp


# Reintentos de la búsqueda de un rango: ARCA falla la consulta de forma transitoria (su "Error de
# conexión") y deja la pantalla en Consulta sin grilla → sin botón CSV. VERIFICADO: un período
# realmente vacío IGUAL exporta un CSV vacío, así que "no aparece el CSV" SIEMPRE es ARCA fallando,
# nunca "no hay comprobantes". Por eso reintentamos la búsqueda (no salteamos: saltear perdería
# comprobantes reales). Tras agotar los intentos, se propaga el error (la sync se marca fallida).
MAX_INTENTOS_BUSQUEDA = 3


def _entrar_seccion(ctx, mcmp, boton: str, direccion: str, traza: Traza):
    mcmp = _mcmp_tab(ctx) or mcmp
    traza.paso(f"sección {direccion}s ({boton}): click", mcmp)
    mcmp.wait_for_selector(boton, timeout=15000)
    mcmp.locator(boton).first.click()
    mcmp.wait_for_timeout(6000)
    mcmp = _mcmp_tab(ctx) or mcmp
    traza.paso(f"sección {direccion}s ({boton}): esperar #fechaEmision", mcmp)
    mcmp.wait_for_selector("#fechaEmision", state="attached", timeout=15000)
    return mcmp


def _exportar_rango(ctx, mcmp, desde: str, hasta: str, direccion: str, traza: Traza) -> bytes:
    """Setea el rango, busca y exporta el CSV (zip). Devuelve los bytes del zip.

    Reintenta la búsqueda si ARCA no devuelve la grilla de resultados (botón CSV nunca visible):
    es su fallo transitorio de conexión, no un período vacío (ver MAX_INTENTOS_BUSQUEDA). Backoff
    incremental entre intentos. Si tras todos los intentos no aparece el CSV, propaga el error."""
    ultimo_error: Exception | None = None
    for intento in range(1, MAX_INTENTOS_BUSQUEDA + 1):
        suf = f" (intento {intento}/{MAX_INTENTOS_BUSQUEDA})" if intento > 1 else ""
        mcmp = _mcmp_tab(ctx) or mcmp
        try:
            # Solapa "Consulta" activa (tras una búsqueda previa quedamos en "Resultados"; tras un
            # fallo de ARCA ya estamos en Consulta, pero el click es idempotente).
            try:
                mcmp.locator('a[href="#tabConsulta"]').first.click()
                mcmp.wait_for_timeout(800)
            except Exception:  # noqa: BLE001
                pass
            traza.paso(f"{direccion} {desde}-{hasta}: setear fechas{suf}", mcmp)
            mcmp.wait_for_selector("#fechaEmision", state="attached", timeout=15000)
            mcmp.evaluate(
                "(v)=>{document.getElementById('fechaEmision').value=v;}", f"{desde} - {hasta}"
            )
            mcmp.wait_for_timeout(500)
            traza.paso(f"{direccion} {desde}-{hasta}: buscar{suf}", mcmp)
            mcmp.get_by_role("button", name=re.compile("buscar", re.I)).first.click()
            mcmp = _mcmp_tab(ctx) or mcmp
            try:
                mcmp.get_by_text(re.compile("total de", re.I)).first.wait_for(timeout=90000)
            except Exception:  # noqa: BLE001
                mcmp.wait_for_timeout(8000)
            traza.paso(f"{direccion} {desde}-{hasta}: esperar botón CSV{suf}", mcmp)
            btn = mcmp.get_by_text("CSV", exact=True).first
            btn.wait_for(state="visible", timeout=30000)
            mcmp.wait_for_timeout(1000)
            traza.paso(f"{direccion} {desde}-{hasta}: descargar CSV{suf}", mcmp)
            with mcmp.expect_download(timeout=60000) as dl:
                btn.click()
            return Path(dl.value.path()).read_bytes()
        except Exception as e:  # noqa: BLE001 — ARCA no respondió la búsqueda; reintentamos
            ultimo_error = e
            if intento < MAX_INTENTOS_BUSQUEDA:
                traza.paso(f"{direccion} {desde}-{hasta}: ARCA no respondió, reintentando", mcmp)
                try:
                    mcmp = _mcmp_tab(ctx) or mcmp
                    mcmp.wait_for_timeout(3000 * intento)  # backoff incremental: 3s, 6s
                except Exception:  # noqa: BLE001
                    pass
    raise RuntimeError(
        f"ARCA no devolvió resultados para {direccion} {desde}-{hasta} "
        f"tras {MAX_INTENTOS_BUSQUEDA} intentos: {ultimo_error}"
    )


def descargar(
    cuit_login: str,
    clave: str,
    cuit_cliente: str,
    plan: list[dict],
    headless: bool | None = None,
    on_progress=None,
    guardar_traza: bool | None = None,
) -> tuple[str | None, dict[str, list[dict]]]:
    """Login con la clave del contador y, en UNA sesión, descarga cada sección del `plan`
    (cada item: {boton, direccion, contraparte, rangos}). Devuelve (nombre_contribuyente,
    {direccion: [dicts]}); el nombre sale del navbar de Mis Comprobantes (el 'Representando a:').

    Trazabilidad (`guardar_traza`, default `settings.scraping_trazas`): registra cada paso y, si
    falla, deja en data/diag/ la traza + screenshot/HTML + el trace.zip de Patchright, y enriquece
    la excepción con la FASE donde cayó (eso es lo que termina en el `motivo` del panel)."""
    if headless is None:
        headless = settings.scraping_headless
    if guardar_traza is None:
        guardar_traza = settings.scraping_trazas
    total = sum(len(p["rangos"]) for p in plan)
    paso = 0
    traza = Traza(cuit_cliente)
    diag_dir = BASE_DIR / "data" / "diag"
    perfil = tempfile.mkdtemp(prefix="orbita_mc_")
    try:
        with sync_playwright() as pw:
            ctx = _comun.crear_contexto(pw, headless=headless, user_data_dir=perfil)
            if guardar_traza:
                try:
                    diag_dir.mkdir(parents=True, exist_ok=True)
                    # screenshot + DOM por acción + fuente: el visor (playwright show-trace) muestra
                    # cada paso con su captura, para "ver dónde fue entrando".
                    ctx.tracing.start(screenshots=True, snapshots=True, sources=True)
                except Exception:  # noqa: BLE001 — tracing es best-effort, no debe frenar la sync
                    guardar_traza = False
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            try:
                traza.paso("login ARCA", page)
                _comun.login(page, cuit_login, clave)
                mcmp = _abrir_mis_comprobantes(page, ctx, cuit_cliente, traza)
                # Nombre real del contribuyente de los comprobantes (el "Representando a:" del navbar).
                traza.paso("leer nombre del contribuyente", mcmp)
                nombre = _comun.leer_nombre_navbar(mcmp, "text-success") or _comun.leer_nombre_navbar(
                    mcmp, "text-primary"
                )
                out: dict[str, list[dict]] = {}
                primera = True
                for p in plan:
                    if not p["rangos"]:
                        out[p["direccion"]] = []
                        continue
                    if not primera:
                        mcmp = _volver_menu(ctx, mcmp)
                    primera = False
                    mcmp = _entrar_seccion(ctx, mcmp, p["boton"], p["direccion"], traza)
                    vistos: set[tuple] = set()
                    comps: list[dict] = []
                    for desde, hasta in p["rangos"]:
                        if on_progress:
                            paso += 1
                            on_progress(paso, total, f"{p['direccion']}s {desde} a {hasta}")
                        for c in parsear_csv_zip(
                            _exportar_rango(ctx, mcmp, desde, hasta, p["direccion"], traza),
                            p["contraparte"],
                        ):
                            k = (c["punto_venta"], c["cbte_tipo"], c["numero"])
                            if k not in vistos:
                                vistos.add(k)
                                comps.append(c)
                    out[p["direccion"]] = comps
                return nombre, out
            except Exception as e:  # noqa: BLE001 — enriquece con la FASE y deja diagnóstico
                detalle = _diagnostico(ctx, cuit_cliente, traza) if guardar_traza else ""
                raise RuntimeError(f"{traza.fase}: {e}{detalle}") from e
            finally:
                if guardar_traza:
                    try:
                        ctx.tracing.stop(path=str(diag_dir / f"trace_{cuit_cliente}.zip"))
                    except Exception:  # noqa: BLE001
                        pass
                ctx.close()
    finally:
        shutil.rmtree(perfil, ignore_errors=True)
