"""
WSAA — autenticación contra ARCA (ex-AFIP).

Portado de research/arca/camino_a_wsaa/wsaa_auth.py con DOS cambios para el backend:
  1. sign_tra recibe el cert y la key como BYTES (en el spike los leía de archivos);
     acá vienen descifrados de la DB y se pasan en memoria.
  2. El cache del Ticket de Acceso (TA) es POR CUIT (cada cliente tiene su propio cert),
     no global.

Flujo: CreateTRA -> SignTRA (CMS/PKCS#7) -> LoginCMS -> Token+Sign (vale ~12h, se cachea).
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import ssl
import xml.etree.ElementTree as ET

import requests
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs7
from requests.adapters import HTTPAdapter
from urllib3.util.ssl_ import create_urllib3_context

from ..config import BASE_DIR, settings

WSAA_HOMO = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms"
WSAA_PROD = "https://wsaa.afip.gov.ar/ws/services/LoginCms"
CACHE_DIR = BASE_DIR / ".ta_cache"


# --- TLS legacy de AFIP (DH 1024 -> SECLEVEL=1 + renegociación legacy) --------
class _AfipTLSAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        ctx = create_urllib3_context()
        ctx.set_ciphers("DEFAULT@SECLEVEL=1")
        ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)


def make_session() -> requests.Session:
    """Session que tolera el TLS viejo de AFIP. Reusala también con zeep."""
    s = requests.Session()
    s.mount("https://", _AfipTLSAdapter())
    return s


def _iso(d: dt.datetime) -> str:
    return d.replace(microsecond=0).isoformat()


def create_tra(service: str) -> bytes:
    now = dt.datetime.now(dt.timezone.utc)
    tra = ET.Element("loginTicketRequest", version="1.0")
    header = ET.SubElement(tra, "header")
    ET.SubElement(header, "uniqueId").text = str(int(now.timestamp()))
    ET.SubElement(header, "generationTime").text = _iso(now - dt.timedelta(minutes=10))
    ET.SubElement(header, "expirationTime").text = _iso(now + dt.timedelta(hours=12))
    ET.SubElement(tra, "service").text = service
    return b'<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(tra, encoding="utf-8")


def sign_tra(tra: bytes, cert_bytes: bytes, key_bytes: bytes) -> str:
    """Firma el TRA en CMS/PKCS#7 (DER, base64) con cert+key en memoria."""
    cert = x509.load_pem_x509_certificate(cert_bytes)
    key = serialization.load_pem_private_key(key_bytes, password=None)
    cms = (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(tra)
        .add_signer(cert, key, hashes.SHA256())
        .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.Binary])
    )
    return base64.b64encode(cms).decode()


def login_cms(cms_b64: str, homo: bool) -> tuple[str, str, dt.datetime]:
    """Manda el CMS al WSAA y devuelve (token, sign, expiración)."""
    url = WSAA_HOMO if homo else WSAA_PROD
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
        url,
        data=envelope.encode("utf-8"),
        headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ""},
        timeout=30,
    )
    if resp.status_code != 200:
        import re as _re

        m = _re.search(r"<faultstring>(.*?)</faultstring>", resp.text, _re.S)
        detalle = m.group(1).strip() if m else resp.text[:600]
        raise RuntimeError(f"WSAA HTTP {resp.status_code} — AFIP dice: {detalle}")

    outer = ET.fromstring(resp.content)
    ta_xml = next(e.text for e in outer.iter() if e.tag.endswith("loginCmsReturn"))
    ta = ET.fromstring(ta_xml)
    token = ta.findtext(".//token")
    sign = ta.findtext(".//sign")
    expira = dt.datetime.fromisoformat(ta.findtext(".//expirationTime"))
    return token, sign, expira


def get_token_sign(
    service: str,
    cert_bytes: bytes,
    key_bytes: bytes,
    cuit: str | int,
    homo: bool | None = None,
) -> tuple[str, str]:
    """Devuelve (token, sign) para un servicio, cacheando el TA por CUIT (~12h)."""
    if homo is None:
        homo = settings.arca_homo
    CACHE_DIR.mkdir(exist_ok=True)
    cache_file = CACHE_DIR / f"{service}_{cuit}.json"
    if cache_file.exists():
        cached = json.loads(cache_file.read_text())
        if dt.datetime.fromisoformat(cached["expira"]) > dt.datetime.now(dt.timezone.utc):
            return cached["token"], cached["sign"]

    tra = create_tra(service)
    token, sign, expira = login_cms(sign_tra(tra, cert_bytes, key_bytes), homo)
    cache_file.write_text(
        json.dumps({"token": token, "sign": sign, "expira": expira.isoformat()})
    )
    return token, sign
