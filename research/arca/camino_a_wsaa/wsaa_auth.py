"""
WSAA — Web Service de Autenticación y Autorización de ARCA (ex-AFIP).

Esto replica, desde las primitivas, lo que AfipSDK hace por dentro para autenticarse
contra los web services SOAP oficiales. NO usa clave fiscal: usa un certificado digital.

Flujo (idéntico al de cualquier cliente de AFIP):

    1. CreateTRA  -> armar el "Ticket de Requerimiento de Acceso" (un XML)
    2. SignTRA    -> firmarlo en formato CMS/PKCS#7 con tu certificado + clave privada
    3. LoginCMS   -> mandarlo por SOAP al WSAA, que devuelve un Token y un Sign
    4. (cache)    -> el Token+Sign (Ticket de Acceso, "TA") vale ~12 h: se reusa

El Token y el Sign resultantes se le pasan después a cada web service de negocio
(WSFEv1, padrón, etc.) junto con el CUIT en cuyo nombre se opera.

Requisitos para que funcione de verdad:
    - cert.crt : certificado X.509 emitido por ARCA (a partir de tu CSR)
    - clave.key: la clave privada con la que generaste el CSR
    El certificado debe estar AUTORIZADO para el servicio que pidas (wsfe, padrón, etc.).

Generación del certificado (una sola vez):
    openssl genrsa -out clave.key 2048
    openssl req -new -key clave.key -subj "/C=AR/O=TU_ESTUDIO/CN=orbita/serialNumber=CUIT 20XXXXXXXXX" -out pedido.csr
    -> subir pedido.csr al portal WSASS (homologación) o Admin. de Certificados (producción)
    -> descargar el .crt y autorizar el web service
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import os
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
import ssl
from requests.adapters import HTTPAdapter
from urllib3.util.ssl_ import create_urllib3_context
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs7

# --- Configuración -----------------------------------------------------------
# Producción por defecto; exportá ARCA_HOMO=true para usar el entorno de testing.
HOMO = os.getenv("ARCA_HOMO", "false").lower() == "true"

WSAA_URL = (
    "https://wsaahomo.afip.gov.ar/ws/services/LoginCms"
    if HOMO
    else "https://wsaa.afip.gov.ar/ws/services/LoginCms"
)

CERT_PATH = Path(os.getenv("ARCA_CERT", "cert.crt"))
KEY_PATH = Path(os.getenv("ARCA_KEY", "clave.key"))
CACHE_DIR = Path(os.getenv("ARCA_TA_CACHE", ".ta_cache"))


# --- TLS legacy de AFIP ------------------------------------------------------
# Los servidores de AFIP usan Diffie-Hellman de 1024 bits, que el OpenSSL moderno
# rechaza con [SSL: DH_KEY_TOO_SMALL]. Bajamos el nivel de seguridad TLS y
# habilitamos renegociación legacy SOLO para estas conexiones.
class _AfipTLSAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        ctx = create_urllib3_context()
        ctx.set_ciphers("DEFAULT@SECLEVEL=1")
        ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)


def make_session() -> requests.Session:
    """requests.Session que tolera el TLS viejo de AFIP. Reusala también con zeep."""
    s = requests.Session()
    s.mount("https://", _AfipTLSAdapter())
    return s


# --- 1. Crear el TRA ---------------------------------------------------------
def create_tra(service: str) -> bytes:
    """Arma el XML del Ticket de Requerimiento de Acceso para un servicio."""
    now = dt.datetime.now(dt.timezone.utc)
    tra = ET.Element("loginTicketRequest", version="1.0")
    header = ET.SubElement(tra, "header")
    # uniqueId: cualquier entero creciente; el timestamp sirve.
    ET.SubElement(header, "uniqueId").text = str(int(now.timestamp()))
    ET.SubElement(header, "generationTime").text = _iso(now - dt.timedelta(minutes=10))
    ET.SubElement(header, "expirationTime").text = _iso(now + dt.timedelta(hours=12))
    ET.SubElement(tra, "service").text = service
    return b'<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(tra, encoding="utf-8")


def _iso(d: dt.datetime) -> str:
    # AFIP acepta ISO-8601 con offset; usamos UTC ("+00:00")
    return d.replace(microsecond=0).isoformat()


# --- 2. Firmar el TRA en CMS/PKCS#7 ------------------------------------------
def sign_tra(tra: bytes) -> str:
    """
    Firma el TRA con el certificado + clave privada y lo devuelve como CMS
    (PKCS#7 SignedData) en DER, codificado en base64. Esta firma es la parte
    "AFIP-específica" del asunto; el resto es SOAP común.
    """
    cert = x509.load_pem_x509_certificate(CERT_PATH.read_bytes())
    key = serialization.load_pem_private_key(KEY_PATH.read_bytes(), password=None)
    cms = (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(tra)
        .add_signer(cert, key, hashes.SHA256())  # AFIP acepta SHA-256
        .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.Binary])
    )
    return base64.b64encode(cms).decode()


# --- 3. Llamar al WSAA (SOAP crudo, para ver el wire) ------------------------
def login_cms(cms_b64: str) -> tuple[str, str, dt.datetime]:
    """Manda el CMS al WSAA y devuelve (token, sign, expiración)."""
    envelope = f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>{cms_b64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>"""

    resp = make_session().post(
        WSAA_URL,
        data=envelope.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ""},
        timeout=30,
    )
    if resp.status_code != 200:
        # AFIP devuelve el motivo real (fault SOAP) en el cuerpo del error.
        import re as _re

        m = _re.search(r"<faultstring>(.*?)</faultstring>", resp.text, _re.S)
        detalle = m.group(1).strip() if m else resp.text[:600]
        raise RuntimeError(f"WSAA HTTP {resp.status_code} — AFIP dice: {detalle}")

    # La respuesta trae el XML del Ticket de Acceso escapeado dentro de loginCmsReturn.
    outer = ET.fromstring(resp.content)
    ta_xml = next(e.text for e in outer.iter() if e.tag.endswith("loginCmsReturn"))
    ta = ET.fromstring(ta_xml)
    token = ta.findtext(".//token")
    sign = ta.findtext(".//sign")
    expira = dt.datetime.fromisoformat(ta.findtext(".//expirationTime"))
    return token, sign, expira


# --- 4. Orquestador con caché en disco ---------------------------------------
def get_token_sign(service: str) -> tuple[str, str]:
    """
    Devuelve (token, sign) para un servicio, reusando el TA cacheado si todavía
    es válido (vale ~12 h). Así no pedís un TA nuevo en cada llamada (AFIP
    rechaza pedidos repetidos de TA mientras hay uno vigente).
    """
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{service}.json"
    if cache_file.exists():
        cached = json.loads(cache_file.read_text())
        if dt.datetime.fromisoformat(cached["expira"]) > dt.datetime.now(dt.timezone.utc):
            return cached["token"], cached["sign"]

    tra = create_tra(service)
    token, sign, expira = login_cms(sign_tra(tra))
    cache_file.write_text(json.dumps({"token": token, "sign": sign, "expira": expira.isoformat()}))
    return token, sign


if __name__ == "__main__":
    # "wsfe" = facturación electrónica; "ws_sr_constancia_inscripcion" = padrón
    token, sign = get_token_sign("wsfe")
    print("TOKEN:", token[:40], "...")
    print("SIGN :", sign[:40], "...")
    print("\nOK — TA obtenido y cacheado en", CACHE_DIR.resolve())
