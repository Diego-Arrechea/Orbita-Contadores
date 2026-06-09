"""
Padrón / Constancia de inscripción (ws_sr_constancia_inscripcion, "Padrón A5").

Trae los datos públicos de un contribuyente a partir de su CUIT: nombre/razón social,
estado, domicilio, impuestos en los que está inscripto y —para monotributistas—
la categoría y la actividad. Es lo que llena la pantalla "Nuevo cliente" de Órbita.

Importante: este servicio NO requiere la clave fiscal del cliente. Sí requiere que TU
certificado esté autorizado para "ws_sr_constancia_inscripcion". El campo
`cuitRepresentada` es tu propio CUIT (el del titular del certificado).

Uso:  python padron.py 20111111112
"""
from __future__ import annotations

import sys

from zeep import Client

from wsaa_auth import HOMO, get_token_sign

WSDL = (
    "https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL"
    if HOMO
    else "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL"
)

# Tu CUIT (titular del certificado). En producción, sacalo de una variable de entorno.
CUIT_REPRESENTADA = 20111111112


def consultar(cuit: int) -> dict:
    token, sign = get_token_sign("ws_sr_constancia_inscripcion")
    client = Client(WSDL)
    res = client.service.getPersona_v2(
        token=token, sign=sign, cuitRepresentada=CUIT_REPRESENTADA, idPersona=cuit
    )
    return _map_a_orbita(res)


def _map_a_orbita(res) -> dict:
    """Mapea la respuesta de ARCA a los campos que usa el tipo `Cliente` de Órbita."""
    p = res.datosGenerales
    mono = getattr(res, "datosMonotributo", None)

    # Categoría de monotributo (A..K) y actividad (comercio/servicios), si aplica.
    categoria = getattr(mono, "categoriaMonotributo", None) if mono else None
    actividad = None
    if mono and getattr(mono, "actividadMonotributista", None):
        # ARCA describe la actividad; acá habría que clasificarla a comercio/servicios.
        actividad = mono.actividadMonotributista

    dom = getattr(p, "domicilioFiscal", None)
    return {
        "cuit": str(getattr(p, "idPersona", "")),
        "nombre": _nombre(p),
        "estado": getattr(p, "estadoClave", None),          # "ACTIVO", etc.
        "categoria": getattr(categoria, "idCategoria", None) if categoria else None,
        "actividadCruda": actividad,
        "domicilio": f"{getattr(dom, 'localidad', '')}, {getattr(dom, 'descripcionProvincia', '')}".strip(", ")
        if dom else None,
        "esMonotributista": mono is not None,
    }


def _nombre(p) -> str:
    if getattr(p, "razonSocial", None):
        return p.razonSocial
    return f"{getattr(p, 'nombre', '')} {getattr(p, 'apellido', '')}".strip()


if __name__ == "__main__":
    cuit = int(sys.argv[1]) if len(sys.argv) > 1 else 20111111112
    datos = consultar(cuit)
    import json

    print(json.dumps(datos, indent=2, ensure_ascii=False, default=str))
