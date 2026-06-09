"""
Prueba guiada contra ARCA REAL (producción). Estrategia incremental y de-riesgada:

  1) Abre el navegador stealth (headful) en el login de ARCA.
  2) VOS te logueás a mano la PRIMERA vez (resolvés captcha/2FA). El perfil persistente
     (.perfil_arca/) guarda la sesión, así que es una sola vez.
  3) El script vuelca los IDs reales de los campos del login (para confirmar selectores).
  4) Detecta que ya estás adentro, va a Mis Comprobantes y prueba el endpoint REAL,
     mostrando la respuesta CRUDA (para confirmar formato y ajustar el parseo).

NO automatiza el login todavía: primero validamos que el resto del flujo funciona contra
ARCA real. Cuando esto ande, pasamos los selectores confirmados a login.py y lo automatizamos.

Uso:  python probar_produccion.py
"""
from __future__ import annotations

import json
import time
from urllib.parse import quote

from cloakbrowser import launch_persistent_context

LOGIN_URL = "https://auth.afip.gob.ar/contribuyente_/login.xhtml"
MENU = "https://serviciosjava2.afip.gob.ar/mcmp/jsp/menu.do"
BASE = "https://serviciosjava2.afip.gob.ar/mcmp/jsp/ajax.do"

# Rango y tipos a consultar (11 = Factura C). Ajustá a gusto.
DESDE, HASTA = "01/01/2026", "31/05/2026"
TIPOS = (11, 13)


def main() -> None:
    ctx = launch_persistent_context(
        user_data_dir="./.perfil_arca",
        headless=False,                 # headful: ves el navegador y resolvés captcha/2FA
        humanize=True,
        locale="es-AR",
        timezone="America/Argentina/Buenos_Aires",
        # proxy="http://user:pass@host:port",   # ← descomentá con un proxy residencial AR
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    try:
        page.goto(LOGIN_URL)
        time.sleep(2)

        # ─── Paso 1: login manual (solo la primera vez) ───
        if _en_login(page):
            _volcar_campos(page)
            print("\n" + "=" * 70)
            print(">>> LOGUEATE A MANO en la ventana del navegador:")
            print("    CUIT → Siguiente → clave fiscal → (captcha/2FA si aparece).")
            print("=" * 70)
            input(">>> Cuando estés DENTRO del portal de ARCA, volvé acá y apretá ENTER... ")
        else:
            print("Ya había sesión guardada en el perfil. Saltando login.")

        # ─── Paso 2: probar el endpoint real de Mis Comprobantes ───
        print("\nAbriendo Mis Comprobantes...")
        page.goto(MENU)
        time.sleep(2)
        print("URL actual:", page.url)

        rango = quote(f"{DESDE} - {HASTA}")
        tipos_qs = "".join(f"&tiposComprobantes[]={t}" for t in TIPOS)
        hdr = {"X-Requested-With": "XMLHttpRequest"}

        print("\n=== generarConsulta (respuesta CRUDA) ===")
        gen = page.request.get(
            f"{BASE}?f=generarConsulta&t=E&fechaEmision={rango}{tipos_qs}", headers=hdr
        )
        print("HTTP", gen.status)
        print(gen.text()[:600])

        try:
            id_consulta = gen.json()["datos"]["idConsulta"]
        except Exception as e:  # noqa: BLE001
            print("\n⚠️ No se pudo leer idConsulta. Revisá la salida cruda de arriba.")
            print("   (Quizás el endpoint cambió, o no estás logueado, o no hay PV.)", e)
            input("\nENTER para cerrar...")
            return

        print("\n=== listaResultados (respuesta CRUDA, primeras filas) ===")
        res = page.request.get(
            f"{BASE}?f=listaResultados&id={id_consulta}&_={int(time.time() * 1000)}", headers=hdr
        )
        print("HTTP", res.status)
        data = res.json().get("datos", {}).get("data", [])
        print(f"{len(data)} filas recibidas. Ejemplo de fila CRUDA (para mapear columnas):")
        print(json.dumps(data[:3], indent=2, ensure_ascii=False))

        print("\n✅ Si ves filas arriba, el flujo de datos contra ARCA real FUNCIONA.")
        print("   Pasame: (a) los campos del login volcados y (b) una fila cruda,")
        print("   y dejo login.py automatizado y el parseo afinado.")

    finally:
        input("\nENTER para cerrar el navegador... ")
        ctx.close()


def _en_login(page) -> bool:
    url = page.url.lower()
    return "auth.afip" in url or "login" in url


def _volcar_campos(page) -> None:
    """Imprime inputs y botones del login para confirmar los selectores reales."""
    try:
        campos = page.eval_on_selector_all(
            "input, button",
            "els => els.map(e => ({tag:e.tagName, id:e.id, name:e.name, type:e.type, placeholder:e.placeholder}))",
        )
        print("\n=== Campos detectados en el login (confirmá los IDs/names reales) ===")
        print(json.dumps(campos, indent=2, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        print("No se pudieron volcar los campos del login:", e)


if __name__ == "__main__":
    main()
