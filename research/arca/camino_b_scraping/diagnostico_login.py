"""
diagnostico_login.py — Login a ARCA + diagnóstico de COOKIES y PETICIONES.

Loguea automático, vuelca las cookies que ARCA entrega (¿están las de serviciosweb.afip.gob.ar,
ASP.NET_SessionId y la TS del WAF?), navega a verCertificado.aspx y registra todas las
respuestas/errores/consola. Guarda todo en diagnostico.txt para revisar.

Headful (como lo usás vos). NO interactivo: corre y cierra solo, dejando diagnostico.txt.
Uso:  python diagnostico_login.py
"""
from __future__ import annotations

import time

from cloakbrowser import launch_persistent_context

try:
    from credenciales_local import CLAVE, CUIT
except ImportError:
    import getpass

    CUIT = input("CUIT: ").strip()
    CLAVE = getpass.getpass("Clave: ")

LOGIN_URL = "https://auth.afip.gob.ar/contribuyente_/login.xhtml"
CERT_URL = "https://serviciosweb.afip.gob.ar/clavefiscal/adminrel/verCertificado.aspx"
OUT = "diagnostico.txt"

_eventos: list[str] = []


def log(msg: object = "") -> None:
    s = str(msg)
    print(s)
    _eventos.append(s)


def _on_response(r) -> None:
    try:
        u = r.url
        if "afip.gob.ar" not in u:
            return
        if r.status >= 300 or any(k in u for k in ("serviciosweb", "loginClave", "login.xhtml", "portalcf")):
            log(f"[RESP {r.status}] {r.request.method} {u[:130]}")
    except Exception:  # noqa: BLE001
        pass


def _on_failed(r) -> None:
    try:
        log(f"[REQ FAILED] {getattr(r, 'failure', None)} {r.url[:130]}")
    except Exception:  # noqa: BLE001
        pass


def _on_console(m) -> None:
    try:
        if m.type in ("error", "warning"):
            log(f"[CONSOLE {m.type}] {m.text[:200]}")
    except Exception:  # noqa: BLE001
        pass


def dump_cookies(ctx, titulo: str) -> None:
    log(f"\n=== {titulo} ===")
    hay_serviciosweb = False
    for c in ctx.cookies():
        dom = c.get("domain", "")
        if "afip.gob.ar" in dom:
            log(f"  {c['name']:24} dom={dom:34} len={len(c.get('value', ''))}")
            if "serviciosweb" in dom:
                hay_serviciosweb = True
    log(f"  -> ¿cookies de serviciosweb.afip.gob.ar?: {'SÍ' if hay_serviciosweb else 'NO'}")


def main() -> None:
    ctx = launch_persistent_context(
        user_data_dir="./.perfil_diag",
        headless=False,
        humanize=True,
        locale="es-AR",
        timezone="America/Argentina/Buenos_Aires",
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.on("response", _on_response)
    page.on("requestfailed", _on_failed)
    page.on("console", _on_console)

    try:
        log("=== LOGIN ===")
        page.goto(LOGIN_URL)
        page.wait_for_load_state("networkidle")
        if page.locator("#F1\\:username").first.is_visible():
            page.fill("#F1\\:username", CUIT)
            page.click("#F1\\:btnSiguiente")
            page.wait_for_selector("#F1\\:password", timeout=20000)
            page.fill("#F1\\:password", CLAVE)
            page.click("#F1\\:btnIngresar")
            page.wait_for_load_state("networkidle")
            time.sleep(3)
        log(f"URL tras login: {page.url}")
        dump_cookies(ctx, "COOKIES TRAS LOGIN")

        log("\n=== NAVEGANDO A verCertificado.aspx ===")
        try:
            resp = page.goto(CERT_URL, wait_until="domcontentloaded", timeout=30000)
            log(f"goto verCertificado status: {resp.status if resp else 'None'}")
        except Exception as e:  # noqa: BLE001
            log(f"goto EXCEPCION: {type(e).__name__}: {str(e)[:200]}")
        time.sleep(6)
        log(f"URL final: {page.url}")
        try:
            log(f"Título: {page.title()}")
        except Exception:  # noqa: BLE001
            pass
        dump_cookies(ctx, "COOKIES TRAS verCertificado")
    finally:
        try:
            with open(OUT, "w", encoding="utf-8") as f:
                f.write("\n".join(_eventos))
        except Exception as e:  # noqa: BLE001
            print("No se pudo guardar:", e)
        print(f"\n>>> Diagnóstico guardado en {OUT}")
        ctx.close()


if __name__ == "__main__":
    main()
