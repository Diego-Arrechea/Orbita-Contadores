"""
listar_representados.py — RUN PRIMARIA del onboarding del contador.

Loguea con la clave fiscal del contador y lee, del combo "Autoridad de Aplicación" del
Administrador de Relaciones, los CUITs que puede operar (él + sus representados).

Lógica pedida:
  - si hay UN solo CUIT  -> se usa ese directo (no se muestra menú)
  - si hay VARIOS        -> se listan para que el contador elija a quién monitorear

Reutiliza login() e ir_a_relaciones() de bootstrap_certificado.py (la clave sale de
credenciales_local.py, igual que el bootstrap).

Uso:  python listar_representados.py            (CUIT del contador desde credenciales_local)
      python listar_representados.py <CUIT>     (CUIT explícito)
"""
from __future__ import annotations

import sys

from cloakbrowser import launch_persistent_context

from bootstrap_certificado import CLAVE, _CUIT_DEF, ir_a_relaciones, login


def leer_representados(page, cuit_login: str) -> list[dict]:
    """Lee las opciones del combo de Autoridad de Aplicación. Cada <option> tiene value=CUIT
    y texto=nombre. Si el combo NO aparece (el contador no representa a nadie), devuelve solo
    el titular."""
    sel = page.locator("#tblAutoridadAplicacion_cmbCont")
    reps: list[dict] = []
    if sel.count() > 0:
        for opt in sel.locator("option").all():
            val = (opt.get_attribute("value") or "").strip()
            if val.isdigit() and len(val) == 11:  # descarta "-- Seleccione --"
                reps.append({"cuit": val, "nombre": (opt.text_content() or "").strip()})
    if not reps:
        reps = [{"cuit": cuit_login, "nombre": "(titular, sin representados)"}]
    return reps


def main() -> list[dict]:
    cuit = sys.argv[1].strip() if len(sys.argv) > 1 else (_CUIT_DEF or "").strip()
    if not cuit or not CLAVE:
        print("Faltan credenciales: completá credenciales_local.py o pasá el CUIT por argumento.")
        return []

    print("[1/2] Abriendo navegador y logueando como contador...")
    ctx = launch_persistent_context(
        user_data_dir="./.perfil_listar",
        headless=False,
        humanize=True,
        locale="es-AR",
        timezone="America/Argentina/Buenos_Aires",
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        login(page, cuit)
        print("[2/2] Leyendo CUITs en el Administrador de Relaciones...")
        pr = ir_a_relaciones(ctx, page)
        reps = leer_representados(pr, cuit)

        print()
        if len(reps) == 1:
            r = reps[0]
            print(f"✅ Un solo CUIT -> se usa directo (sin menú): {r['cuit']}  {r['nombre']}")
        else:
            print(f"✅ {len(reps)} CUITs disponibles — elegí a quién monitorear:")
            for i, r in enumerate(reps, 1):
                print(f"   {i}. {r['cuit']}  {r['nombre']}")
        page.wait_for_timeout(2500)  # cierre automático
        return reps
    finally:
        ctx.close()


if __name__ == "__main__":
    main()
