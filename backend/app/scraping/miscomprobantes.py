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
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from patchright.sync_api import sync_playwright

from ..config import settings
from . import _comun

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


def _abrir_mis_comprobantes(page, ctx):
    """Desde el portal abre 'Mis Comprobantes' y queda en el menú (Emitidos/Recibidos)."""
    page.goto(_comun.PORTAL)
    page.wait_for_load_state("networkidle")
    b = page.locator("#buscadorInput")
    b.wait_for(state="visible", timeout=20000)
    b.click()
    b.fill("")
    b.press_sequentially("Mis Comprobantes", delay=80)
    page.wait_for_timeout(2500)
    page.locator('li[role="option"]').filter(
        has_text=re.compile("Mis Comprobantes", re.I)
    ).first.click()
    page.wait_for_timeout(6000)
    _comun.click_continuar_si_aparece(ctx)
    page.wait_for_timeout(2000)
    mcmp = _mcmp_tab(ctx)
    if mcmp is None:
        raise RuntimeError("No se abrió Mis Comprobantes.")
    return mcmp


def _volver_menu(ctx, mcmp):
    mcmp = _mcmp_tab(ctx) or mcmp
    try:
        mcmp.locator('a[href*="menuPrincipal"]').first.click()
        mcmp.wait_for_timeout(2500)
    except Exception:  # noqa: BLE001
        pass
    return _mcmp_tab(ctx) or mcmp


def _entrar_seccion(ctx, mcmp, boton: str):
    mcmp = _mcmp_tab(ctx) or mcmp
    mcmp.wait_for_selector(boton, timeout=15000)
    mcmp.locator(boton).first.click()
    mcmp.wait_for_timeout(6000)
    mcmp = _mcmp_tab(ctx) or mcmp
    mcmp.wait_for_selector("#fechaEmision", state="attached", timeout=15000)
    return mcmp


def _exportar_rango(ctx, mcmp, desde: str, hasta: str) -> bytes:
    """Setea el rango, busca y exporta el CSV (zip). Devuelve los bytes del zip."""
    mcmp = _mcmp_tab(ctx) or mcmp
    # Solapa "Consulta" activa (tras una búsqueda previa quedamos en "Resultados").
    try:
        mcmp.locator('a[href="#tabConsulta"]').first.click()
        mcmp.wait_for_timeout(800)
    except Exception:  # noqa: BLE001
        pass
    mcmp.wait_for_selector("#fechaEmision", state="attached", timeout=15000)
    mcmp.evaluate("(v)=>{document.getElementById('fechaEmision').value=v;}", f"{desde} - {hasta}")
    mcmp.wait_for_timeout(500)
    mcmp.get_by_role("button", name=re.compile("buscar", re.I)).first.click()
    mcmp = _mcmp_tab(ctx) or mcmp
    try:
        mcmp.get_by_text(re.compile("total de", re.I)).first.wait_for(timeout=90000)
    except Exception:  # noqa: BLE001
        mcmp.wait_for_timeout(8000)
    btn = mcmp.get_by_text("CSV", exact=True).first
    btn.wait_for(state="visible", timeout=30000)
    mcmp.wait_for_timeout(1000)
    with mcmp.expect_download(timeout=60000) as dl:
        btn.click()
    return Path(dl.value.path()).read_bytes()


def descargar(
    cuit_login: str,
    clave: str,
    cuit_cliente: str,
    plan: list[dict],
    headless: bool | None = None,
    on_progress=None,
) -> tuple[str | None, dict[str, list[dict]]]:
    """Login con la clave del contador y, en UNA sesión, descarga cada sección del `plan`
    (cada item: {boton, direccion, contraparte, rangos}). Devuelve (nombre_contribuyente,
    {direccion: [dicts]}); el nombre sale del navbar de Mis Comprobantes (el 'Representando a:')."""
    if headless is None:
        headless = settings.scraping_headless
    total = sum(len(p["rangos"]) for p in plan)
    paso = 0
    perfil = tempfile.mkdtemp(prefix="orbita_mc_")
    try:
        with sync_playwright() as pw:
            ctx = _comun.crear_contexto(pw, headless=headless, user_data_dir=perfil)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            try:
                _comun.login(page, cuit_login, clave)
                mcmp = _abrir_mis_comprobantes(page, ctx)
                # Nombre real del contribuyente de los comprobantes (el "Representando a:" del navbar).
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
                    mcmp = _entrar_seccion(ctx, mcmp, p["boton"])
                    vistos: set[tuple] = set()
                    comps: list[dict] = []
                    for desde, hasta in p["rangos"]:
                        if on_progress:
                            paso += 1
                            on_progress(paso, total, f"{p['direccion']}s {desde} a {hasta}")
                        for c in parsear_csv_zip(_exportar_rango(ctx, mcmp, desde, hasta), p["contraparte"]):
                            k = (c["punto_venta"], c["cbte_tipo"], c["numero"])
                            if k not in vistos:
                                vistos.add(k)
                                comps.append(c)
                    out[p["direccion"]] = comps
                return nombre, out
            finally:
                ctx.close()
    finally:
        shutil.rmtree(perfil, ignore_errors=True)
