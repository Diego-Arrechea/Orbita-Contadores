"""
Bootstrap del certificado de un cliente (lo que antes hacíamos a mano con el script):
  Fase A  crear alias + subir CSR
  Fase B  asociar el alias al WS Facturación Electrónica
  Fase C  descargar el .crt

Usa **CloakBrowser con humanize=True**: el árbol de servicios de ARCA (Scriptaculous con
animaciones) sólo responde fiable con interacción "humana"; Patchright headless no lo logra.
En el VPS (Linux) corre headless; en Windows abre ventana (el bootstrap es ocasional).

Reutiliza la navegación de `_comun.py` (login, relaciones, certificados). El CSR se sube desde
memoria y el cert se devuelve en bytes. `on_progress(pct, msg)` alimenta la barra del frontend.
"""
from __future__ import annotations

import shutil
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

from cloakbrowser import launch_persistent_context
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from ..config import BASE_DIR, settings
from . import _comun

ProgressCb = Callable[[int, str], None]


def generar_csr(cuit: str, alias: str) -> tuple[bytes, bytes]:
    """Genera (key_pem, csr_pem) en memoria. Subject = serialNumber 'CUIT <n>', CN=alias."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
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
    return key_pem, csr.public_bytes(serialization.Encoding.PEM)


def _ruta_key(cuit: str, alias: str) -> Path:
    return BASE_DIR / "data" / "keys" / f"{cuit}_{alias}.key"


def _guardar_key(cuit: str, alias: str, key_pem: bytes) -> None:
    """Guarda la .key recién generada APENAS se crea, antes de tocar ARCA. Si el bootstrap se
    corta a la mitad pero el alias ya quedó creado en ARCA, NO perdemos la llave: el alias se
    reutiliza en el próximo intento en vez de generar uno nuevo (no acumulamos alias al pedo)."""
    ruta = _ruta_key(cuit, alias)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_bytes(key_pem)


def _borrar_key(cuit: str, alias: str) -> None:
    """Descarta la .key de un alias que NO se llegó a crear (ARCA dijo 'ya existe'): esa llave
    no corresponde a ningún certificado, así que no debe quedar guardada."""
    _ruta_key(cuit, alias).unlink(missing_ok=True)


def _cert_key_matchean(cert_pem: bytes, key_pem: bytes) -> bool:
    """¿El cert descargado corresponde a NUESTRA clave? (coincide la clave pública). Si no, el
    alias ya existía en ARCA con OTRA clave y bajamos el certificado equivocado — inservible para
    firmar (WSAA: 'firma inválida')."""
    try:
        c = x509.load_pem_x509_certificate(cert_pem)
        k = serialization.load_pem_private_key(key_pem, password=None)
        return c.public_key().public_numbers() == k.public_key().public_numbers()
    except Exception:  # noqa: BLE001
        return False


def fase_a(page, cuit: str, alias: str, csr_pem: bytes) -> bool:
    """Crea el alias y sube el CSR (desde memoria). Devuelve True si lo creó; False si ARCA
    responde 'ALIAS ya existe' (para que el caller pruebe el siguiente alias). Espera el
    elemento concreto de cada paso, no networkidle (ARCA no queda 'idle' nunca)."""
    _comun.seleccionar_contribuyente(page, cuit)
    # 1) Lista de certificados → botón "Agregar alias" (input image).
    page.wait_for_selector(_comun.SEL_AGREGAR, state="visible", timeout=20000)
    _comun.click_robusto(page, page.locator(_comun.SEL_AGREGAR).first)  # → formulario
    # 2) Estamos en el formulario cuando aparece el <input type=file> del CSR.
    page.wait_for_selector("input[type='file']", state="visible", timeout=20000)
    page.locator("input[type='text']").first.fill(alias)
    page.locator("input[type='file']").first.set_input_files(
        files={"name": f"{cuit}_{alias}.csr", "mimeType": "application/pkcs10", "buffer": csr_pem}
    )
    time.sleep(0.5)
    _comun.click_robusto(page, page.locator(_comun.SEL_AGREGAR).first)  # confirmar (crea el cert)
    # 3) Damos un instante a que ARCA renderice la respuesta y leemos el cuerpo.
    page.wait_for_timeout(1200)
    cuerpo = " ".join((page.inner_text("body") or "").split())
    if "ALIAS ya existe" in cuerpo:
        return False  # ocupado: el caller probará el siguiente (orbita2, orbita3…)
    if "Request enviado es inv" in cuerpo:
        raise RuntimeError(f"ARCA rechazó el CSR del alias '{alias}': {cuerpo[:160]}")
    return True


def fase_b(ctx, page, cuit: str, alias: str) -> None:
    """Asocia el alias (Computador Fiscal) al WS Facturación Electrónica. Cada paso espera el
    elemento concreto del siguiente (no networkidle: ARCA mantiene conexiones abiertas y nunca
    queda 'idle', lo que colgaba la navegación ~30s por paso)."""
    _comun.seleccionar_contribuyente(page, cuit)  # idempotente: sólo actúa si está el combo
    # "Adherir Servicio" (input image #cmdAgregarServicio) en el Administrador de Relaciones.
    page.wait_for_selector("#cmdAgregarServicio", state="visible", timeout=20000)
    _comun.click_robusto(page, page.locator("#cmdAgregarServicio").first)

    # Árbol de organismos (abre en pestaña nueva, tarda). Lo identificamos por los onclick/href
    # reales: el árbol viene pre-renderizado pero colapsado con display:none (no sirven íconos).
    p = _comun.esperar_en_pestanas(ctx, "td[onclick*='ctrl.afip']", 25000) or page
    nodo_afip = p.locator("td[onclick*='ctrl.afip']").first  # organismo AFIP → Effect.toggle
    nodo_afip.wait_for(state="visible", timeout=15000)
    _comun.click_robusto(p, nodo_afip)
    ws = p.locator("td[onclick*='grp.webservices']").first  # despliega WebServices
    ws.wait_for(state="visible", timeout=15000)
    _comun.click_robusto(p, ws)
    fe = p.locator("a[href*=\"ws://wsfe'\"]").first  # Facturación Electrónica (la ' separa de wsfex)
    fe.wait_for(state="visible", timeout=15000)
    _comun.click_robusto(p, fe)

    # "Buscar usuario": esperamos el botón en la pestaña que corresponda.
    p = _comun.esperar_en_pestanas(ctx, "#cmdBuscarUsuario", 20000) or p
    _comun.click_robusto(p, p.locator("#cmdBuscarUsuario").first)

    # Combo del Computador Fiscal (el alias). Aparece tras el postback.
    p = _comun.esperar_en_pestanas(ctx, "#cboComputadoresAdministrados", 20000) or p
    p.wait_for_selector("#cboComputadoresAdministrados", state="visible", timeout=10000)
    p.select_option("#cboComputadoresAdministrados", label=alias)

    # "Seleccionar servicio" (aparece tras el __doPostBack del select).
    p = _comun.esperar_en_pestanas(ctx, "#cmdSeleccionarServicio", 20000) or p
    _comun.click_robusto(p, p.locator("#cmdSeleccionarServicio").first)

    # Confirmar: "Generar relación".
    p = _comun.esperar_en_pestanas(ctx, "#cmdGenerarRelacion", 20000) or p
    _comun.click_robusto(p, p.locator("#cmdGenerarRelacion").first)
    p.wait_for_timeout(1500)  # se abre el comprobante de la relación generada


def _buscar_fila_alias(ctx, alias: str, timeout_ms: int = 15000):
    """Busca en TODAS las pestañas la fila de la LISTA de certificados cuyo primer token sea el
    alias. Tras las Fases A/B quedan pestañas residuales (formulario de alta, árbol, comprobante
    de la relación) que confunden a la búsqueda; acá ubicamos la pestaña correcta. Devuelve
    (pagina, indice_de_fila) o (None, None)."""
    for _ in range(max(1, timeout_ms // 500)):
        for pg in list(ctx.pages):
            try:
                filas = pg.locator("tr")
                for i in range(filas.count()):
                    partes = " ".join((filas.nth(i).inner_text() or "").split()).split()
                    if partes and partes[0] == alias:
                        return pg, i
            except Exception:  # noqa: BLE001
                pass
        if ctx.pages:
            ctx.pages[0].wait_for_timeout(500)
    return None, None


def fase_c(ctx, page, cuit: str, alias: str) -> bytes:
    """Descarga el .crt y devuelve sus bytes. Abre la LISTA de certificados, ubica la fila del
    alias (en la pestaña correcta, no en el formulario/árbol residual), entra al detalle ('Ver')
    y baja el cert. Selectores tolerantes (validados en descargar_cert.py)."""
    SEL_DESCARGAR = (
        "input[type='image'][alt*='Descargar' i], input[type='image'][src*='descargar' i], "
        "a:has-text('Descargar')"
    )
    if page.locator(SEL_DESCARGAR).count() == 0:
        pg0 = _comun.ir_a_certificados(ctx, page)
        _comun.seleccionar_contribuyente(pg0, cuit)
        pg0.wait_for_timeout(1500)
        page, idx = _buscar_fila_alias(ctx, alias, 15000)
        if page is None:
            raise RuntimeError(f"No encontré el alias '{alias}' en la lista de certificados de {cuit}.")
        fila = page.locator("tr").nth(idx)
        ver = fila.get_by_role("link", name="Ver")
        if ver.count() == 0:  # fallback: 'Ver' como input image o link a detalle
            ver = fila.locator(
                "a:has-text('Ver'), input[type='image'][alt*='Ver' i], "
                "input[type='image'][src*='ver' i], a[href*='etalle' i]"
            )
        _comun.click_robusto(page, ver.first)
        page = _comun.esperar_en_pestanas(ctx, SEL_DESCARGAR, 20000) or page  # detalle del cert
    with page.expect_download() as dl:
        _comun.click_robusto(page, page.locator(SEL_DESCARGAR).first)
    return Path(dl.value.path()).read_bytes()


def _diagnostico(ctx, cuit: str) -> str:
    """Al fallar: guarda screenshot + HTML + extrae el texto visible de la(s) pestaña(s) de
    ARCA (ahí suele estar el mensaje real del error) para incluirlo en el motivo del fallo.
    El HTML sirve para ajustar selectores cuando ARCA rediseña una pantalla (p. ej. el árbol)."""
    diag = BASE_DIR / "data" / "diag"
    diag.mkdir(parents=True, exist_ok=True)
    partes: list[str] = []
    for i, pg in enumerate(ctx.pages):
        try:
            if "afip" not in pg.url:
                continue
            pg.screenshot(path=str(diag / f"fallo_{cuit}_{i}.png"), full_page=True)
            try:
                (diag / f"fallo_{cuit}_{i}.html").write_text(pg.content(), encoding="utf-8")
            except Exception:  # noqa: BLE001
                pass
            txt = " ".join(pg.inner_text("body").split())
            partes.append(txt[:280])
        except Exception:  # noqa: BLE001
            pass
    return (" | ".join(partes) + f"  [diag en {diag}]") if partes else "(sin pestaña de ARCA)"


def bootstrap_cliente(
    cuit_cliente: str,
    cuit_login: str,
    clave: str,
    alias: str | None = None,
    on_progress: ProgressCb | None = None,
    headless: bool | None = None,
    pausa_debug: bool = False,
) -> tuple[bytes, bytes]:
    """Genera el cert del cliente de punta a punta. Devuelve (cert_pem, key_pem)."""
    if headless is None:
        headless = settings.scraping_headless
    base_alias = alias or "orbita"  # serie de alias a probar: orbita, orbita2, orbita3…

    def prog(pct: int, msg: str) -> None:
        if on_progress:
            on_progress(pct, msg)

    prog(5, "Preparando…")

    perfil = tempfile.mkdtemp(prefix="orbita_bs_")  # perfil LIMPIO (sin contexto residual)
    try:
        ctx = launch_persistent_context(
            user_data_dir=perfil,
            headless=headless,
            humanize=True,
            locale="es-AR",
            timezone="America/Argentina/Buenos_Aires",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            prog(15, "Iniciando sesión en ARCA…")
            _comun.login(page, cuit_login, clave)

            # Sólo el representado necesita fijar el contexto en Relaciones antes de Certificados
            # (Certificados hereda ese contexto). El titular ya opera como sí mismo y no tiene
            # combo de contribuyente → saltamos el paso (evita una navegación lenta de más).
            if cuit_cliente != cuit_login:
                prog(30, "Estableciendo contexto…")
                pr = _comun.ir_a_relaciones(ctx, page)
                _comun.seleccionar_contribuyente(pr, cuit_cliente)

            # Probamos la serie de alias (orbita, orbita2…) hasta bajar un cert que CORRESPONDA a
            # nuestra clave. Si un alias ya existía en ARCA con OTRA clave (de una prueba vieja),
            # el cert que se descarga no matchea → lo descartamos y seguimos con el siguiente.
            cert_pem = key_pem = None
            for i in range(8):
                alias = base_alias if i == 0 else f"{base_alias}{i + 1}"
                ruta = _ruta_key(cuit_cliente, alias)
                reusar = ruta.exists()  # ya creamos este alias antes (su key está guardada)
                if reusar:
                    key_pem = ruta.read_bytes()
                    prog(50, f"Retomando {alias}…")
                else:
                    prog(50, f"Creando el certificado ({alias})…")
                    key_pem, csr_pem = generar_csr(cuit_cliente, alias)
                    _guardar_key(cuit_cliente, alias, key_pem)  # guardar la .key YA
                    page_cert = _comun.ir_a_certificados(ctx, page)
                    _comun.seleccionar_contribuyente(page_cert, cuit_cliente)
                    if not fase_a(page_cert, cuit_cliente, alias, csr_pem):
                        _borrar_key(cuit_cliente, alias)  # 'ya existe' → probamos el siguiente
                        continue

                prog(75, "Autorizando el servicio…")
                page_rel = _comun.ir_a_relaciones(ctx, page)
                try:
                    fase_b(ctx, page_rel, cuit_cliente, alias)
                except Exception:
                    if not reusar:
                        raise  # en un alta nueva la asociación es obligatoria
                    # reutilizando: pudo quedar ya asociado en un intento previo → seguimos

                prog(90, "Descargando el certificado…")
                cert_try = fase_c(ctx, page_rel, cuit_cliente, alias)
                if _cert_key_matchean(cert_try, key_pem):  # cert ↔ key: el par es válido
                    cert_pem = cert_try
                    break
                _borrar_key(cuit_cliente, alias)  # alias ajeno (otra clave) → descartar y seguir

            if cert_pem is None or key_pem is None:
                raise RuntimeError(
                    f"No obtuve un certificado válido para {cuit_cliente}: los alias "
                    f"'{base_alias}…' ya existen en ARCA con otra clave."
                )

            prog(100, "Certificado listo")
            return cert_pem, key_pem
        except Exception as e:
            raise RuntimeError(
                f"{type(e).__name__}: {str(e)[:120]} || ARCA dice: {_diagnostico(ctx, cuit_cliente)}"
            ) from e
        finally:
            if pausa_debug:  # debug: dejar la ventana abierta para inspeccionar el estado final
                try:
                    input(">>> Mirá la ventana de ARCA. Apretá ENTER acá para cerrarla…")
                except Exception:  # noqa: BLE001
                    pass
            ctx.close()
    finally:
        shutil.rmtree(perfil, ignore_errors=True)
