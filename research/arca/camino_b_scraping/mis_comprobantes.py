"""
Mis Comprobantes — descarga de comprobantes emitidos/recibidos vía el endpoint interno
del portal, reutilizando la sesión stealth de CloakBrowser (ver login.py).

Endpoints (módulo /mcmp del portal):
    GET .../mcmp/jsp/ajax.do?f=generarConsulta&t=E&fechaEmision=DD/MM/AAAA - DD/MM/AAAA&tiposComprobantes[]=11
        -> {"estado":"ok","datos":{"idConsulta":"..."}}
    GET .../mcmp/jsp/ajax.do?f=listaResultados&id=<idConsulta>&_=<timestamp>
        -> {"estado":"ok","datos":{"data":[[fecha, tipo, _, pv, nro, ..., receptor, ..., total], ...]}}

t = "E" (emitidos) | "R" (recibidos).

⚠️ El orden de columnas de cada fila lo define el portal: confirmarlo con una respuesta
real y ajustar `_fila_a_dict`. El endpoint `serviciosjava2` es el histórico; si ARCA lo
migró, actualizar BASE.

Uso:  python mis_comprobantes.py
"""
from __future__ import annotations

import getpass
import json
import time
from urllib.parse import quote

from login import abrir_sesion, login

BASE = "https://serviciosjava2.afip.gob.ar/mcmp/jsp/ajax.do"
MENU = "https://serviciosjava2.afip.gob.ar/mcmp/jsp/menu.do"


def traer_comprobantes(
    page,
    desde: str,
    hasta: str,
    t: str = "E",
    tipos: tuple[int, ...] = (11, 13),
) -> list[dict]:
    # Abrir el servicio "Mis Comprobantes" establece la sesión del módulo /mcmp.
    page.goto(MENU)
    # ⚠️ Si operás por un tercero, acá ARCA pide elegir el CUIT representado.

    rango = quote(f"{desde} - {hasta}")
    tipos_qs = "".join(f"&tiposComprobantes[]={x}" for x in tipos)
    hdr = {"X-Requested-With": "XMLHttpRequest"}

    # page.request hereda las cookies de la sesión stealth — no hace falta portar nada.
    gen = page.request.get(f"{BASE}?f=generarConsulta&t={t}&fechaEmision={rango}{tipos_qs}", headers=hdr)
    payload = gen.json()
    if payload.get("estado") != "ok":
        raise RuntimeError(f"generarConsulta falló: {payload.get('mensajeError')}")
    id_consulta = payload["datos"]["idConsulta"]

    res = page.request.get(
        f"{BASE}?f=listaResultados&id={id_consulta}&_={int(time.time() * 1000)}", headers=hdr
    )
    filas = res.json()["datos"]["data"]
    return [_fila_a_dict(f) for f in filas]


def _fila_a_dict(f: list) -> dict:
    """Mapea una fila cruda del portal. Ajustar índices con una respuesta real."""
    return {
        "fecha": f[0],
        "tipo": f[1],
        "puntoVenta": f[3],
        "numero": f[4],
        "receptor": f[7] if len(f) > 7 else None,
        "total": f[-1],
    }


if __name__ == "__main__":
    cuit = input("CUIT: ").strip()
    clave = getpass.getpass("Clave fiscal: ")
    ctx = abrir_sesion(headless=False)          # headful: por si aparece captcha/2FA
    try:
        page = login(ctx, cuit, clave)
        comps = traer_comprobantes(page, "01/01/2026", "31/05/2026", t="E")
        print(f"{len(comps)} comprobantes emitidos")
        print(json.dumps(comps[:10], indent=2, ensure_ascii=False))
    finally:
        ctx.close()
