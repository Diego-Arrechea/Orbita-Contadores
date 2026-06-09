"""
descubrir_endpoint.py — Login con clave fiscal + descubrir la URL real de "Mis Comprobantes".

Flujo en 2 PASOS, controlás cada uno apretando ENTER cuando termines:

  PASO 1 — LOGIN: el script abre la pantalla de ACCESO CON CLAVE FISCAL de ARCA.
           Te logueás a mano (CUIT → clave → captcha/2FA). El script NO sigue hasta que
           vos le digas (ENTER), así que tomate el tiempo que necesites.

  PASO 2 — DESCUBRIR: navegás a "Mis Comprobantes" y hacés una consulta. El script
           registra las llamadas de red y vuelca la URL del endpoint de datos real
           (el reemplazo del viejo serviciosjava2/ajax.do, que ARCA dio de baja).

Reusa la sesión de .perfil_arca/ (si ya entraste antes, el PASO 1 ya te encuentra adentro).

Uso:  python descubrir_endpoint.py
"""
from __future__ import annotations

from cloakbrowser import launch_persistent_context

LOGIN_URL = "https://auth.afip.gob.ar/contribuyente_/login.xhtml"

PISTAS = ("ajax", "comprob", "consulta", "rest", "/api", "json", "mcmp",
          "listar", "buscar", "emitid", "recibid", "factura")

capturadas: list[tuple[str, str, str]] = []  # (method, resource_type, url)


def _on_request(req) -> None:
    try:
        rt = req.resource_type
        if rt in ("xhr", "fetch") or any(k in req.url.lower() for k in PISTAS):
            capturadas.append((req.method, rt, req.url))
    except Exception:  # noqa: BLE001
        pass


def _en_login(url: str) -> bool:
    u = url.lower()
    return "auth.afip" in u or "login" in u


def main() -> None:
    ctx = launch_persistent_context(
        user_data_dir="./.perfil_arca",
        headless=False,
        humanize=True,
        locale="es-AR",
        timezone="America/Argentina/Buenos_Aires",
    )
    ctx.on("page", lambda p: p.on("request", _on_request))
    for p in ctx.pages:
        p.on("request", _on_request)
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    # ─────────── PASO 1: LOGIN CON CLAVE FISCAL ───────────
    page.goto(LOGIN_URL)
    print("\n" + "=" * 70)
    print("PASO 1 — INICIÁ SESIÓN CON TU CLAVE FISCAL")
    print("  En la ventana del navegador: CUIT → Siguiente → clave fiscal → Ingresar")
    print("  (resolvé el captcha o el 2FA si aparecen). Tomate el tiempo que haga falta.")
    print("=" * 70)
    input(">>> Cuando ya estés DENTRO de ARCA, volvé acá y apretá ENTER... ")

    if _en_login(page.url):
        print("\n⚠️  Todavía parece una pantalla de login:", page.url)
        print("    Intentá entrar de nuevo en la ventana; cuando estés adentro, ENTER.")
        input(">>> ENTER para continuar... ")
    else:
        print("✅ Sesión iniciada. URL actual:", page.url)

    # ─────────── PASO 2: MIS COMPROBANTES + CONSULTA ───────────
    print("\n" + "=" * 70)
    print("PASO 2 — ABRÍ MIS COMPROBANTES Y HACÉ UNA CONSULTA")
    print("  1) Entrá a 'Mis Comprobantes' (Consulta de Comprobantes Emitidos y Recibidos).")
    print("  2) Solapa EMITIDOS → elegí un rango de fechas → apretá BUSCAR / Consultar.")
    print("=" * 70)
    input(">>> ENTER cuando hayas hecho UNA consulta de comprobantes... ")

    # ─────────── Volcado de URLs capturadas ───────────
    vistas: set[str] = set()
    resaltadas: list[str] = []
    otras: list[str] = []
    for m, rt, u in capturadas:
        if u in vistas:
            continue
        vistas.add(u)
        linea = f"[{rt:5}] {m:4} {u}"
        (resaltadas if any(k in u.lower() for k in PISTAS) else otras).append(linea)

    print("\n=== MÁS PROBABLES (endpoint de datos) ===")
    for l in resaltadas:
        print(l)
    if not resaltadas:
        print("(ninguna con pistas; pegame igual la sección de abajo)")
    print(f"\n=== OTRAS XHR/fetch ({len(otras)}) ===")
    for l in otras[:40]:
        print(l)

    print("\nURL final en la barra:", page.url)
    print(f"\nTotal: {len(vistas)} URLs únicas. 👉 Pegame la sección 'MÁS PROBABLES'.")
    input("\nENTER para cerrar... ")
    ctx.close()


if __name__ == "__main__":
    main()
