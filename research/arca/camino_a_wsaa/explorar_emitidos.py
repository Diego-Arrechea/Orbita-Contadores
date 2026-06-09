"""
explorar_emitidos.py — EXPLORACIÓN de datos reales.

Descubre los puntos de venta de un CUIT, barre TODOS los tipos de comprobante comunes
(Factura A/B/C, Notas de Débito/Crédito) y, para los que tengan emitidos, vuelca el DETALLE
COMPLETO de FECompConsultar (todos los campos, en JSON) para ver la estructura real de los
datos antes de modelar el backend.

A diferencia de comprobantes_emitidos.py (que asume monotributo: tipos 11/12/13), este barre
todo, así sirve también para un Responsable Inscripto (Factura A/B).

Uso:  python explorar_emitidos.py <CUIT>
"""
from __future__ import annotations

import json
import sys

from zeep import Client, Transport
from zeep.helpers import serialize_object

from wsaa_auth import HOMO, get_token_sign, make_session

WSDL = (
    "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL"
    if HOMO
    else "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL"
)

# Tabla oficial FEParamGetTiposCbte (los más comunes que puede emitir un contribuyente):
TIPOS = {
    1: "Factura A", 2: "Nota de Débito A", 3: "Nota de Crédito A",
    6: "Factura B", 7: "Nota de Débito B", 8: "Nota de Crédito B",
    11: "Factura C", 12: "Nota de Débito C", 13: "Nota de Crédito C",
    51: "Factura M", 52: "Nota de Débito M", 53: "Nota de Crédito M",
}


def _json(obj) -> str:
    """Serializa un objeto zeep a JSON legible (maneja Decimal/fechas con default=str)."""
    return json.dumps(serialize_object(obj), default=str, ensure_ascii=False, indent=2)


def main(cuit: int) -> None:
    token, sign = get_token_sign("wsfe")
    client = Client(WSDL, transport=Transport(session=make_session()))
    auth = {"Token": token, "Sign": sign, "Cuit": cuit}

    pts = client.service.FEParamGetPtosVenta(Auth=auth)
    rg = getattr(pts, "ResultGet", None)
    pvs = [p.Nro for p in rg.PtoVenta] if rg else [1]
    print(f"Puntos de venta: {pvs}\n")

    hubo_datos = False
    for pv in pvs:
        for tipo, nombre in TIPOS.items():
            try:
                ult = client.service.FECompUltimoAutorizado(Auth=auth, PtoVta=pv, CbteTipo=tipo)
                n = getattr(ult, "CbteNro", 0) or 0
            except Exception:  # noqa: BLE001 — tipo no habilitado para este CUIT
                continue
            if n <= 0:
                continue
            hubo_datos = True
            print(f"━━━ PV {pv} · tipo {tipo} ({nombre}): {n} emitido(s) ━━━")
            try:
                det = client.service.FECompConsultar(
                    Auth=auth, FeCompConsReq={"CbteTipo": tipo, "CbteNro": n, "PtoVta": pv}
                )
                print("  Detalle del ÚLTIMO (FECompConsultar.ResultGet):")
                print(_json(det.ResultGet))
            except Exception as e:  # noqa: BLE001
                print(f"  no se pudo consultar el detalle: {e}")
            print()

    if not hubo_datos:
        print("No se encontraron comprobantes emitidos en ningún tipo/PV.")


if __name__ == "__main__":
    cuit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    print(f"Explorando emitidos del CUIT {cuit} (WSFEv1, producción)...\n")
    main(cuit)
