"""
Motor de obtención de datos de ARCA: capa de dispatch http/browser.

Expone las mismas funciones que hoy importan los `services/` desde `scraping/`, y
según `settings.motor_scraping` enruta al motor HTTP nuevo (`afip.py` vía
`motor_http`) o a los scrapers de browser viejos (`scraping/*`, fallback).

Los imports de `scraping/*` (que arrastran patchright/cloakbrowser) son LAZY dentro
de la rama browser, así que el camino HTTP no necesita el navegador instalado.

Flujos migrados a HTTP (respetan el flag): comprobantes, representados, padrón
(monotributo + cuota), deuda CCMA (Cálculo de Deuda oficial P02->P04, capital +
intereses; validado contra prod) y certificado (crear cert + Fase B de asociación al
WS de Facturación Electrónica). Ya no queda nada atado SIEMPRE al browser.
"""
from __future__ import annotations

from ..config import settings


def _http() -> bool:
    return settings.motor_scraping == "http"


# --- Comprobantes (Mis Comprobantes) ------------------------------------------
def descargar(
    cuit_login: str,
    clave: str,
    cuit_cliente: str,
    plan: list[dict],
    headless: bool | None = None,
    on_progress=None,
    guardar_traza: bool | None = None,
) -> tuple[str | None, dict[str, list[dict]]]:
    if _http():
        from . import motor_http

        return motor_http.descargar(cuit_login, clave, cuit_cliente, plan, on_progress=on_progress)
    from ..scraping import miscomprobantes

    return miscomprobantes.descargar(
        cuit_login, clave, cuit_cliente, plan,
        headless=headless, on_progress=on_progress, guardar_traza=guardar_traza,
    )


# --- Padrón / Monotributo -----------------------------------------------------
def datos_monotributo(
    cuit_login: str, clave: str, cuit_objetivo: str | None = None, headless: bool | None = None
) -> dict:
    if _http():
        from . import motor_http

        return motor_http.datos_monotributo(cuit_login, clave, cuit_objetivo)
    from ..scraping import padron

    return padron.datos_monotributo(cuit_login, clave, cuit_objetivo=cuit_objetivo, headless=headless)


# --- Deuda CCMA (Cálculo de Deuda oficial) ------------------------------------
def consultar_deuda(
    cuit_login: str, clave: str, cuit_objetivo: str | None = None, headless: bool | None = None
) -> dict:
    if _http():
        from . import motor_http

        return motor_http.consultar_deuda(cuit_login, clave, cuit_objetivo)
    from ..scraping import ccma

    return ccma.consultar_deuda(cuit_login, clave, cuit_objetivo=cuit_objetivo, headless=headless)


# --- Representados (onboarding) -----------------------------------------------
def listar_representados(cuit: str, clave: str, headless: bool | None = None) -> list[dict]:
    if _http():
        from . import motor_http

        return motor_http.listar_representados(cuit, clave)
    from ..scraping import onboarding as scraping

    return scraping.listar_representados(cuit, clave, headless=headless)


# --- Puntos de venta (ABM pvel) — SÓLO HTTP (afip.py; el browser nunca lo hizo) -
def puntos_venta_pvel(cuit_login: str, clave: str) -> list[dict]:
    from . import motor_http

    return motor_http.puntos_venta_pvel(cuit_login, clave)


def crear_punto_venta(
    cuit_login: str, clave: str, nombre: str = "Órbita", sistema: str = "MAW"
) -> dict:
    from . import motor_http

    return motor_http.crear_punto_venta(cuit_login, clave, nombre=nombre, sistema=sistema)


# --- Certificado de facturación (cert + Fase B) -------------------------------
def bootstrap_cliente(
    cuit_cliente: str, cuit_login: str, clave: str, alias: str | None = None, on_progress=None
) -> tuple[bytes, bytes]:
    if _http():
        from . import motor_http

        return motor_http.bootstrap_cliente(
            cuit_cliente, cuit_login, clave, alias=alias, on_progress=on_progress
        )
    from ..scraping import bootstrap

    return bootstrap.bootstrap_cliente(
        cuit_cliente=cuit_cliente, cuit_login=cuit_login, clave=clave,
        alias=alias, on_progress=on_progress,
    )
