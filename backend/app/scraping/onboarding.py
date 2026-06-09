"""
Onboarding — listar los representados del contador.

Usa los helpers de navegación de `_comun.py` (Patchright headless), con un perfil de navegador
LIMPIO por llamada (evita arrastrar el contexto 'actuando en representación de ...'). La clave
NO se persiste.
"""
from __future__ import annotations

import shutil
import tempfile

from patchright.sync_api import sync_playwright

from ..config import settings
from . import _comun


def listar_representados(cuit: str, clave: str, headless: bool | None = None) -> list[dict]:
    """Loguea como el contador y devuelve los CUITs que puede operar (él + representados)."""
    if headless is None:
        headless = settings.scraping_headless
    perfil = tempfile.mkdtemp(prefix="orbita_list_")
    try:
        with sync_playwright() as pw:
            ctx = _comun.crear_contexto(pw, headless, perfil)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            try:
                _comun.login(page, cuit, clave)
                pr = _comun.ir_a_relaciones(ctx, page)
                return _comun.leer_representados(pr, cuit)
            finally:
                ctx.close()
    finally:
        shutil.rmtree(perfil, ignore_errors=True)
