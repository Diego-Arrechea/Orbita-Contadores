"""
Comprobantes EMITIDOS vía WSFEv1 (facturación electrónica oficial).

El detalle clave: WSFEv1 NO tiene un método "listame todos los comprobantes". Tiene:
    - FECompUltimoAutorizado(PtoVta, CbteTipo) -> último número emitido de ese PV+tipo
    - FECompConsultar(PtoVta, CbteTipo, CbteNro) -> datos de UN comprobante puntual

Entonces, para reconstruir todos los emitidos de un cliente, se itera: por cada punto de
venta y cada tipo de comprobante, se pide el último número y se baja del 1 al último.
Para un monotributista que factura con "Comprobantes en línea", todas sus Facturas C
tienen CAE y son consultables así -> se puede reconstruir el 100% sin scraping.

Requiere: tu certificado autorizado para "wsfe" y, para consultar a un cliente, que ese
cliente te haya DELEGADO el servicio en ARCA (Administrador de Relaciones). El CUIT del
cliente va en Auth.Cuit.

Uso:  python comprobantes_emitidos.py 20111111112
"""
from __future__ import annotations

import sys

from zeep import Client, Transport

from wsaa_auth import HOMO, get_token_sign, make_session

WSDL = (
    "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL"
    if HOMO
    else "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL"
)

# Tipos de comprobante típicos de un monotributista (tabla oficial FEParamGetTiposCbte):
#   11 = Factura C, 12 = Nota de Débito C, 13 = Nota de Crédito C
TIPOS_MONOTRIBUTO = [11, 12, 13]


def listar_emitidos(
    cuit_cliente: int,
    puntos_venta: list[int] | None = None,
    max_por_tipo: int | None = None,
) -> list[dict]:
    """
    Reconstruye los comprobantes emitidos. `max_por_tipo` limita a los últimos N de cada
    (PV, tipo) — útil para una prueba rápida. None = todos.
    """
    token, sign = get_token_sign("wsfe")
    client = Client(WSDL, transport=Transport(session=make_session()))
    auth = {"Token": token, "Sign": sign, "Cuit": cuit_cliente}

    # Si no se pasan, se descubren con FEParamGetPtosVenta.
    if puntos_venta is None:
        puntos_venta = _descubrir_puntos_venta(client, auth)
    print(f"Puntos de venta: {puntos_venta}")

    comprobantes: list[dict] = []
    for pv in puntos_venta:
        for tipo in TIPOS_MONOTRIBUTO:
            ultimo = client.service.FECompUltimoAutorizado(Auth=auth, PtoVta=pv, CbteTipo=tipo)
            ultimo_nro = getattr(ultimo, "CbteNro", 0) or 0
            print(f"  PV {pv}, tipo {tipo}: ultimo autorizado = {ultimo_nro}")
            desde = max(1, ultimo_nro - max_por_tipo + 1) if max_por_tipo else 1
            for nro in range(desde, ultimo_nro + 1):
                req = {"CbteTipo": tipo, "CbteNro": nro, "PtoVta": pv}
                det = client.service.FECompConsultar(Auth=auth, FeCompConsReq=req)
                r = det.ResultGet
                comprobantes.append(
                    {
                        "tipo": tipo,
                        "puntoVenta": pv,
                        "numero": nro,
                        "fecha": getattr(r, "CbteFch", None),       # yyyymmdd
                        "total": getattr(r, "ImpTotal", None),
                        "neto": getattr(r, "ImpNeto", None),
                        "docReceptor": getattr(r, "DocNro", None),
                        "cae": getattr(r, "CodAutorizacion", None),
                    }
                )
    return comprobantes


def _descubrir_puntos_venta(client, auth) -> list[int]:
    res = client.service.FEParamGetPtosVenta(Auth=auth)
    pts = getattr(res, "ResultGet", None)
    if not pts:
        return [1]  # fallback razonable
    return [p.Nro for p in pts.PtoVenta]


if __name__ == "__main__":
    cuit = int(sys.argv[1]) if len(sys.argv) > 1 else 20111111112
    print(f"Consultando emitidos del CUIT {cuit} (WSFEv1, producción)...\n")
    # PRUEBA: solo los últimos 10 de cada tipo (rápido). Quitá max_por_tipo para TODOS.
    emitidos = listar_emitidos(cuit, max_por_tipo=10)
    print(f"\n✅ {len(emitidos)} comprobantes traídos (últimos 10 por tipo).")
    for c in emitidos[-10:]:
        print(c)
