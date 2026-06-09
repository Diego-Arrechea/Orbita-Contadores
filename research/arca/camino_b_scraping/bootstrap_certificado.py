"""
bootstrap_certificado.py — FULL AUTO con CloakBrowser: login → certificados → crear alias + CSR.

Aprendizaje del diagnóstico (diagnostico.txt): si se hace el LOGIN AUTOMÁTICO COMPLETO
(login.xhtml → loginClave → portalcf) y RECIÉN DESPUÉS se navega a verCertificado.aspx,
ARCA entrega las cookies de serviciosweb.afip.gob.ar (ASP.NET_SessionId + TS del WAF F5)
y la página responde 200. El WAF puede servir un challenge en el 1er hit → se hace un
RELOAD para obtener el contenido real.

Flujo del trámite:
  FASE A  verCertificado → "Agregar alias" → alias + subir CSR → "Agregar alias"
  FASE C  detalleCertificado → "Descargar" → <alias>.crt        (a sumar)
  FASE B  Admin Relaciones → asociar al WS Facturación Electrónica  (a sumar)

⚠️ Usá un ALIAS NUEVO (ej. "orbitatest"), no "orbita".
Credenciales en credenciales_local.py (GITIGNORED).

Uso:  python bootstrap_certificado.py <CUIT> <ALIAS>
"""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from cloakbrowser import launch_persistent_context

try:
    from credenciales_local import CLAVE, CUIT as _CUIT_DEF
except ImportError:
    _CUIT_DEF, CLAVE = None, None

LOGIN_URL = "https://auth.afip.gob.ar/contribuyente_/login.xhtml"
CERT_URL = "https://serviciosweb.afip.gob.ar/clavefiscal/adminrel/verCertificado.aspx"

SEL_USER = "#F1\\:username"
SEL_SIGUIENTE = "#F1\\:btnSiguiente"
SEL_PASS = "#F1\\:password"
SEL_INGRESAR = "#F1\\:btnIngresar"


def generar_csr(cuit: str, alias: str) -> Path:
    key_path, csr_path = Path(f"{cuit}_{alias}.key"), Path(f"{cuit}_{alias}.csr")
    if csr_path.exists():
        print(f"  (ya existe {csr_path}, lo reuso)")
        return csr_path
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(
            x509.Name(
                [
                    x509.NameAttribute(NameOID.COUNTRY_NAME, "AR"),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "ORBITA"),
                    x509.NameAttribute(NameOID.COMMON_NAME, alias),
                    x509.NameAttribute(NameOID.SERIAL_NUMBER, f"CUIT {cuit}"),
                ]
            )
        )
        .sign(key, hashes.SHA256())
    )
    csr_path.write_bytes(csr.public_bytes(serialization.Encoding.PEM))
    print(f"  generados {key_path} y {csr_path}")
    return csr_path


def login(page, cuit: str) -> None:
    print("[login] abriendo ARCA...")
    page.goto(LOGIN_URL)
    page.wait_for_load_state("networkidle")
    if not page.locator(SEL_USER).first.is_visible():
        print("[login] ya había sesión iniciada.")
        return
    page.fill(SEL_USER, cuit)
    page.click(SEL_SIGUIENTE)
    page.wait_for_selector(SEL_PASS, timeout=20000)
    page.fill(SEL_PASS, CLAVE)
    page.click(SEL_INGRESAR)
    page.wait_for_load_state("networkidle")
    time.sleep(4)  # dar tiempo a la cadena de redirecciones al portal
    print(f"[login] URL tras login: {page.url}")


PORTAL = "https://portalcf.cloud.afip.gob.ar/portal/app/"

# OJO: el botón "Agregar alias" NO tiene texto en el DOM — es <input type="image"> con un
# GIF (alt vacío). Por eso hay que matchearlo por id/src, NO por texto ni role-name.
SEL_AGREGAR = "#cmdIngresar, input[type='image'][src*='agregarAlias' i]"


def _pagina_con(ctx, selector: str):
    """Encuentra la pestaña que tenga ese selector (maneja popups / pestaña nueva)."""
    for p in ctx.pages:
        try:
            if p.locator(selector).count() > 0:
                return p
        except Exception:  # noqa: BLE001
            pass
    return ctx.pages[-1] if ctx.pages else None


def _esperar_en_pestanas(ctx, selector: str, timeout_ms: int = 20000):
    """Espera hasta que `selector` aparezca en ALGUNA pestaña. Devuelve esa pestaña o None."""
    for _ in range(max(1, int(timeout_ms / 500))):
        for pg in list(ctx.pages):
            try:
                if pg.locator(selector).count() > 0:
                    return pg
            except Exception:  # noqa: BLE001
                pass
        if ctx.pages:
            ctx.pages[0].wait_for_timeout(500)
    return None


def _click_continuar_si_aparece(ctx, timeout_ms: int = 3000) -> bool:
    """Si al abrir un servicio aparece el botón 'Continuar' (pantalla de adhesión, cuando el
    servicio no estaba adherido a la clave del cliente), lo aprieta. Si no aparece, sigue."""
    for _ in range(max(1, int(timeout_ms / 500))):
        for pg in list(ctx.pages):
            try:
                btn = pg.get_by_role("button", name="Continuar")
                if btn.count() > 0 and btn.first.is_visible():
                    print("  adhiriendo servicio (botón 'Continuar')...")
                    btn.first.click()
                    pg.wait_for_load_state("networkidle")
                    return True
            except Exception:  # noqa: BLE001
                pass
        if ctx.pages:
            ctx.pages[0].wait_for_timeout(500)
    return False


def buscar_servicio(ctx, page, texto: str, aria_label: str, detector: str):
    """Busca un servicio en el buscador del portal (#buscadorInput, un typeahead) y lo abre.
    Navegar desde el portal es lo que AUTORIZA la sesión en serviciosweb. Devuelve la pestaña
    donde aparece `detector`, o None si no lo logró."""
    page.goto(PORTAL)
    page.wait_for_load_state("networkidle")
    buscador = page.locator("#buscadorInput")
    buscador.wait_for(state="visible", timeout=20000)
    buscador.click()
    buscador.fill("")
    buscador.press_sequentially(texto, delay=80)  # typeahead: hay que TIPEAR (fill no filtra)
    opcion = page.locator(f'li[role="option"][aria-label*="{aria_label}" i]').first
    opcion.wait_for(state="visible", timeout=10000)
    opcion.click()
    page.wait_for_load_state("networkidle")
    _click_continuar_si_aparece(ctx)  # pantalla de adhesión, si el servicio no estaba adherido
    return _esperar_en_pestanas(ctx, detector, 20000)


def ir_a_certificados(ctx, page):
    """Abre 'Administración de Certificados Digitales' buscándolo en el portal. 100% automático
    (reintenta solo, sin pasos manuales)."""
    print("[Fase A] abriendo 'Administración de Certificados Digitales'...")
    for intento in (1, 2):
        try:
            p = buscar_servicio(ctx, page, "digitales", "Certificados Digitales", SEL_AGREGAR)
            if p is not None:
                return p
            print(f"  intento {intento}: no apareció 'Agregar alias'.")
        except Exception as e:  # noqa: BLE001
            print(f"  intento {intento}: búsqueda falló:", e)
    raise RuntimeError("No se pudo abrir 'Administración de Certificados Digitales' automáticamente.")


def _cuit_representado(ctx, cuit_login: str, timeout_ms: int = 4000) -> str:
    """Busca 'Actuando en representación de' (#tblDetalleRelacion_lblRepresentado) en CUALQUIER
    pestaña, esperando hasta `timeout_ms`. Si el CUIT representado difiere del login, lo devuelve
    (el cert va para ESE ente). Imprime lo que encuentra (debug)."""
    for _ in range(max(1, int(timeout_ms / 500))):
        for pg in list(ctx.pages):
            try:
                sp = pg.locator("#tblDetalleRelacion_lblRepresentado")
                if sp.count() > 0 and sp.first.is_visible():
                    txt = sp.first.inner_text()
                    m = re.search(r"(\d{2}-?\d{8}-?\d)", txt)
                    if m:
                        rep = re.sub(r"\D", "", m.group(1))
                        print(f"  representado: '{txt.strip()}' -> {rep}")
                        return rep if (len(rep) == 11 and rep != cuit_login) else cuit_login
            except Exception:  # noqa: BLE001
                pass
        if ctx.pages:
            ctx.pages[0].wait_for_timeout(500)
    return cuit_login


def fase_a(page, cuit: str, alias: str) -> None:
    """Crea el alias + sube el CSR para `cuit`. Se asume que el contexto del representado ya
    quedó establecido (se seleccionó en el Administrador de Relaciones ANTES de entrar acá)."""
    print(f"[fase A] creando alias '{alias}' para CUIT {cuit}...")
    _seleccionar_contribuyente_si_aparece(page, cuit)  # por si Certificados re-pregunta el CUIT
    page.locator(SEL_AGREGAR).first.click()  # → formulario de agregar alias
    page.wait_for_load_state("networkidle")
    csr_path = generar_csr(cuit, alias)
    page.locator("input[type='text']").first.fill(alias)
    page.locator("input[type='file']").first.set_input_files(str(csr_path))
    time.sleep(0.5)
    page.locator(SEL_AGREGAR).first.click()  # confirmar
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    try:
        page.screenshot(path="fase_a_resultado.png")
        body = page.inner_text("body")
        print("  resultado:", " | ".join(l.strip() for l in body.splitlines() if l.strip())[:600])
    except Exception:  # noqa: BLE001
        pass
    print("[fase A] enviado.")


def fase_c_descargar(ctx, page, cuit: str, alias: str) -> Path:
    """
    FASE C — descargar el .crt. El 'Ver' de cada fila es un __doPostBack distinto, así que
    ubicamos la fila por el NOMBRE EXACTO del alias y clickeamos su 'Ver'. El botón de
    descarga es <input type=image alt="Descargar">.
    """
    SEL_DESCARGAR = "input[type='image'][alt='Descargar' i]"
    if page.locator(SEL_DESCARGAR).count() == 0:
        # SIEMPRE vamos a la lista de Certificados por el portal (mantiene el contexto del
        # representado; un goto directo lo resetea). NO miramos los links 'Ver' como pista de
        # "ya estoy en la lista" porque Relaciones también los tiene y nos confundía.
        page = ir_a_certificados(ctx, page)
        _seleccionar_contribuyente_si_aparece(page, cuit)  # lista del representado, no del login
        print(f"[fase C] buscando el alias '{alias}' en la lista...")
        fila = page.locator("tr").filter(has=page.locator(f"td:text-is('{alias}')"))
        ver = fila.get_by_role("link", name="Ver")
        if ver.count() == 0:
            try:
                filas = [f.strip()[:70] for f in page.locator("tr").all_inner_texts() if f.strip()]
                print("  filas en la página:", filas[:15])
            except Exception:  # noqa: BLE001
                pass
            raise RuntimeError(f"No encontré el alias '{alias}' en los certificados de {cuit}.")
        ver.first.click()
        page.wait_for_load_state("networkidle")
    print("[fase C] descargando el certificado...")
    with page.expect_download() as dl:
        page.locator(SEL_DESCARGAR).first.click()
    dest = Path(f"{cuit}_{alias}.crt")
    dl.value.save_as(str(dest))
    print(f"[fase C] ✅ certificado guardado: {dest.resolve()}")
    return dest


ADMINREL_MAIN = "https://serviciosweb.afip.gob.ar/ClaveFiscal/AdminRel/main.aspx"


def ir_a_relaciones(ctx, page):
    """Va al Administrador de Relaciones desde el portal. 100% automático (reintenta solo).
    OJO: cuando el login representa a varios, ARCA muestra PRIMERO el combo de Autoridad de
    Aplicación (#tblAutoridadAplicacion_cmbCont) y recién al elegir contribuyente aparece
    #cmdAgregarServicio → detectamos CUALQUIERA de los dos para no quedarnos esperando."""
    print("[Fase B] abriendo 'Administrador de Relaciones'...")
    detector = "#tblAutoridadAplicacion_cmbCont, #cmdAgregarServicio"
    for intento in (1, 2):
        try:
            p = buscar_servicio(ctx, page, "relaciones", "Relaciones", detector)
            if p is not None:
                return p
            print(f"  intento {intento}: no apareció Relaciones tras la búsqueda.")
        except Exception as e:  # noqa: BLE001
            print(f"  intento {intento}: búsqueda falló:", e)
    raise RuntimeError("No se pudo abrir el Administrador de Relaciones automáticamente.")


def _seleccionar_contribuyente_si_aparece(page, cuit: str) -> None:
    """Si el Admin de Relaciones pide elegir contribuyente (cuando el usuario representa a
    varios), selecciona el CUIT que estamos procesando. El value de cada opción es el CUIT."""
    sel = page.locator("#tblAutoridadAplicacion_cmbCont")
    try:
        if sel.count() > 0:
            print(f"  seleccionando contribuyente {cuit}...")
            sel.select_option(value=cuit)
            page.wait_for_load_state("networkidle")
    except Exception as e:  # noqa: BLE001
        print("  no se pudo seleccionar contribuyente:", e)


def fase_b_asociar(ctx, page, cuit: str, alias: str) -> None:
    """FASE B — asociar el alias (Computador Fiscal) al WS Facturación Electrónica.
    Re-detecta la pestaña activa en cada paso por si algo abre en ventana nueva."""
    _seleccionar_contribuyente_si_aparece(page, cuit)
    print("[fase B] Adherir Servicio...")
    page.locator("#cmdAgregarServicio").first.click()
    page.wait_for_load_state("networkidle")

    print("[fase B] árbol de servicios...")
    p = _pagina_con(ctx, "img[src*='arbolClaveFiscal' i]") or page
    ws = p.get_by_text("WebServices", exact=True).first
    # Solo expandir ARCA/AFIP si 'WebServices' NO está visible (evita colapsarlo por toggle).
    if not ws.is_visible():
        print("[fase B]   expandiendo ARCA/AFIP...")
        p.locator("img[src*='arbolClaveFiscal/afip' i]").first.click()
        ws.wait_for(state="visible", timeout=15000)
    print("[fase B]   clic 'WebServices' (despliega Fact. Electrónica)...")
    ws.click()  # Effect.toggle 'appear'
    fe = p.get_by_role("link", name="Facturación Electrónica").first
    fe.wait_for(state="visible", timeout=15000)
    print("[fase B]   clic 'Facturación Electrónica'...")
    fe.click()
    p.wait_for_load_state("networkidle")

    print("[fase B] Buscar representante...")
    p = _pagina_con(ctx, "#cmdBuscarUsuario") or p
    p.locator("#cmdBuscarUsuario").first.click()
    p.wait_for_load_state("networkidle")

    print(f"[fase B] seleccionando Computador Fiscal '{alias}'...")
    ps = _esperar_en_pestanas(ctx, "#cboComputadoresAdministrados", 20000)
    if ps is not None:
        p = ps
    else:
        print("[fase B] ⚠️ no apareció el combo de Computador Fiscal en ninguna pestaña.")
    p.wait_for_selector("#cboComputadoresAdministrados", timeout=10000)
    opciones = p.locator("#cboComputadoresAdministrados option").all_text_contents()
    print(f"[fase B] opciones del combo: {opciones}")
    p.select_option("#cboComputadoresAdministrados", label=alias)
    p.wait_for_load_state("networkidle")  # el <select> dispara __doPostBack

    print("[fase B] confirmar selección (Computador Fiscal)...")
    p = _pagina_con(ctx, "#cmdSeleccionarServicio") or p
    p.locator("#cmdSeleccionarServicio").first.click()
    p.wait_for_load_state("networkidle")

    print("[fase B] CONFIRMAR — generar la relación...")
    p = _pagina_con(ctx, "#cmdGenerarRelacion") or p
    p.wait_for_selector("#cmdGenerarRelacion", timeout=15000)
    p.locator("#cmdGenerarRelacion").first.click()
    p.wait_for_load_state("networkidle")
    p.wait_for_timeout(1500)  # se abre el pop-up/comprobante de la relación
    print("[fase B] ✅ relación GENERADA (alias autorizado para el WS).")


def main() -> None:
    if len(sys.argv) < 3:
        print("Uso: python bootstrap_certificado.py <CUIT> <ALIAS> [soloB]")
        print("  soloB = probar SOLO la Fase B con un alias que YA existe (saltea crear/descargar)")
        return
    cuit_cliente, alias = sys.argv[1].strip(), sys.argv[2].strip()
    _modo = sys.argv[3].strip().lower() if len(sys.argv) > 3 else ""
    solo_b = _modo in ("solob", "b", "skip-a")
    solo_c = _modo in ("soloc", "c", "descargar")
    if not CLAVE:
        print("Falta credenciales_local.py con CUIT y CLAVE.")
        return
    cuit_login = (_CUIT_DEF or cuit_cliente).strip()  # el login es el CONTADOR (credenciales_local)
    es_representado = cuit_cliente != cuit_login
    if es_representado:
        print(f"Login {cuit_login} (contador) -> procesando representado {cuit_cliente}")

    print("[1/3] Abriendo navegador stealth...")
    ctx = launch_persistent_context(
        user_data_dir="./.perfil_bootstrap",
        headless=False,
        humanize=True,
        locale="es-AR",
        timezone="America/Argentina/Buenos_Aires",
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    try:
        login(page, cuit_login)
        # Contexto del representado para full/soloC (Certificados hereda el contexto de
        # Relaciones). soloB no lo necesita: fase_b_asociar ya selecciona el contribuyente.
        if es_representado and not solo_b:
            print(f"[contexto] estableciendo representación de {cuit_cliente}...")
            pr = ir_a_relaciones(ctx, page)
            _seleccionar_contribuyente_si_aparece(pr, cuit_cliente)

        if solo_c:
            print("[Fase C] descargar el certificado...")
            fase_c_descargar(ctx, page, cuit_cliente, alias)
        elif solo_b:
            print("[Fase B] asociar al WS Facturación Electrónica...")
            page_rel = ir_a_relaciones(ctx, page)
            fase_b_asociar(ctx, page_rel, cuit_cliente, alias)
        else:  # flujo completo A → B → C
            page_cert = ir_a_certificados(ctx, page)
            print("[Fase A] crear alias + subir CSR...")
            fase_a(page_cert, cuit_cliente, alias)
            print("[Fase B] asociar al WS Facturación Electrónica...")
            page_rel = ir_a_relaciones(ctx, page)
            fase_b_asociar(ctx, page_rel, cuit_cliente, alias)
            print("[Fase C] descargar el certificado...")
            fase_c_descargar(ctx, page_rel, cuit_cliente, alias)
        print("\n=== ✅ Listo ===")
        page.wait_for_timeout(3000)  # cierre automático (sin ENTER)
    finally:
        ctx.close()


if __name__ == "__main__":
    main()
