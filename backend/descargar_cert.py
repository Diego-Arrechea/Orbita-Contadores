"""
Prueba SOLO la Fase C: descargar el .crt de un alias YA creado y asociado (sin rehacer A/B).
Ventana visible. Lista los alias que ve, guarda el HTML de la lista de certificados en
data/diag/ y prueba a entrar al alias + descargar con varios selectores (así diagnostico la
estructura real de esa pantalla, que todavía no conocíamos).

Uso (desde backend/, con el venv):
    python descargar_cert.py <CUIT> <CUIT_LOGIN> <CLAVE> [ALIAS]

- Si no pasás ALIAS, usa el ÚLTIMO alias 'orbita*' que aparezca en la lista.
- Ejemplo titular:  python descargar_cert.py 20217168652 20217168652 MI_CLAVE
"""
import shutil
import sys
import tempfile
from pathlib import Path

from cloakbrowser import launch_persistent_context

from app.config import BASE_DIR
from app.scraping import _comun


def main() -> None:
    if len(sys.argv) < 4:
        print("Uso: python descargar_cert.py <CUIT> <CUIT_LOGIN> <CLAVE> [ALIAS]")
        return
    cuit, cuit_login, clave = sys.argv[1].strip(), sys.argv[2].strip(), sys.argv[3]
    alias_obj = sys.argv[4].strip() if len(sys.argv) > 4 else None

    perfil = tempfile.mkdtemp(prefix="orbita_c_")
    ctx = launch_persistent_context(
        user_data_dir=perfil,
        headless=False,
        humanize=True,
        locale="es-AR",
        timezone="America/Argentina/Buenos_Aires",
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        print("[1] login…", flush=True)
        _comun.login(page, cuit_login, clave)

        print("[2] abriendo 'Administración de Certificados Digitales'…", flush=True)
        page = _comun.ir_a_certificados(ctx, page)
        _comun.seleccionar_contribuyente(page, cuit)
        page.wait_for_timeout(1500)

        # Guardar el HTML de la lista (para ajustar selectores con certeza).
        diag = BASE_DIR / "data" / "diag"
        diag.mkdir(parents=True, exist_ok=True)
        (diag / f"lista_certs_{cuit}.html").write_text(page.content(), encoding="utf-8")
        print(f"    HTML de la lista → data/diag/lista_certs_{cuit}.html", flush=True)

        # Inspeccionar filas: primer token (suele ser el alias) + qué links/imgs tiene.
        filas = page.locator("tr")
        n = filas.count()
        print(f"[3] {n} filas. Resumen (primer token + links):", flush=True)
        candidatos: list[tuple[int, str]] = []
        for i in range(n):
            txt = " ".join((filas.nth(i).inner_text() or "").split())
            partes = txt.split()
            if not partes:
                continue
            links = filas.nth(i).locator("a, input[type='image']").count()
            if i < 40 or partes[0].lower().startswith("orbita"):
                print(f"    fila {i:>2}: '{partes[0]}'  ({links} links)  | {txt[:70]}", flush=True)
            if partes[0].lower().startswith("orbita"):
                candidatos.append((i, partes[0]))

        if not candidatos:
            print("\n⚠️ No vi ningún alias 'orbita*'. Mirá el HTML guardado / la ventana.", flush=True)
            return

        if alias_obj:
            idx, alias = next(((i, a) for i, a in candidatos if a == alias_obj), candidatos[-1])
        else:
            idx, alias = candidatos[-1]  # el último que aparece
        print(f"\n[4] alias elegido: '{alias}' (fila {idx}). Buscando cómo entrar…", flush=True)

        fila = filas.nth(idx)
        # Probamos varias formas de "Ver"/entrar al detalle del alias.
        ver = fila.get_by_role("link", name="Ver")
        if ver.count() == 0:
            ver = fila.locator(
                "a:has-text('Ver'), input[type='image'][alt*='Ver' i], "
                "input[type='image'][src*='ver' i], a[href*='etalle' i]"
            )
        print(f"    candidatos 'Ver' en la fila: {ver.count()}", flush=True)
        if ver.count() == 0:
            print("    ⚠️ No encontré cómo entrar al alias. Pegame el HTML guardado.", flush=True)
            return
        _comun.click_robusto(page, ver.first)
        page.wait_for_timeout(2500)

        SEL_DESCARGAR = (
            "input[type='image'][alt*='Descargar' i], input[type='image'][src*='descargar' i], "
            "a:has-text('Descargar')"
        )
        print(f"[5] botones 'Descargar' visibles: {page.locator(SEL_DESCARGAR).count()}", flush=True)
        if page.locator(SEL_DESCARGAR).count() == 0:
            (diag / f"detalle_cert_{cuit}.html").write_text(page.content(), encoding="utf-8")
            print(f"    ⚠️ No vi 'Descargar'. HTML del detalle → data/diag/detalle_cert_{cuit}.html",
                  flush=True)
            return
        with page.expect_download() as dl:
            _comun.click_robusto(page, page.locator(SEL_DESCARGAR).first)
        dest = Path(f"{cuit}_{alias}.crt")
        dl.value.save_as(str(dest))
        print(f"\n✅ Cert descargado: {dest.resolve()}  ({dest.stat().st_size} bytes)", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"\n❌ {type(e).__name__}: {e}", flush=True)
    finally:
        try:
            input(">>> ENTER para cerrar la ventana…")
        except Exception:  # noqa: BLE001
            pass
        ctx.close()
        shutil.rmtree(perfil, ignore_errors=True)


if __name__ == "__main__":
    main()
