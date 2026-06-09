"""
WSFEv1 — comprobantes EMITIDOS (facturación electrónica oficial).

Portado de research/arca/camino_a_wsaa/comprobantes_emitidos.py. WSFEv1 no tiene un
"listame todo": se itera por (punto de venta, tipo) pidiendo el último número y se baja
cada comprobante con FECompConsultar.

Devuelve datos CRUDOS (el mapeo al formato de Órbita lo hace el servicio/schema).
"""
from __future__ import annotations

from zeep import Client, Transport

from ..config import settings
from .wsaa_auth import get_token_sign, make_session

WSDL_HOMO = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL"
WSDL_PROD = "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL"

# Tipos de comprobante comunes (FEParamGetTiposCbte): A, B y C (Factura/ND/NC).
# Cubre tanto monotributo (11/12/13) como Responsable Inscripto (1/2/3/6/7/8).
TIPOS = [1, 2, 3, 6, 7, 8, 11, 12, 13]


# Además de los PV que liste FEParamGetPtosVenta, probamos PV 1..N: el facturador web
# "Comprobantes en línea" (típico en monotributistas) a veces usa puntos de venta que ese
# método NO devuelve, y así nos perderíamos esos comprobantes.
MAX_PV_EXPLORAR = 20


def _descubrir_pv(client, auth) -> list[int]:
    pvs = set(range(1, MAX_PV_EXPLORAR + 1))
    try:
        res = client.service.FEParamGetPtosVenta(Auth=auth)
        pts = getattr(res, "ResultGet", None)
        if pts:
            pvs.update(int(p.Nro) for p in pts.PtoVenta)
    except Exception:  # noqa: BLE001
        pass
    return sorted(pvs)


def listar_emitidos(
    cuit: str | int,
    cert_bytes: bytes,
    key_bytes: bytes,
    max_por_tipo: int | None = None,
) -> list[dict]:
    """Reconstruye los comprobantes emitidos del CUIT. Devuelve dicts crudos."""
    homo = settings.arca_homo
    token, sign = get_token_sign("wsfe", cert_bytes, key_bytes, cuit, homo)
    wsdl = WSDL_HOMO if homo else WSDL_PROD
    client = Client(wsdl, transport=Transport(session=make_session()))
    auth = {"Token": token, "Sign": sign, "Cuit": int(cuit)}

    out: list[dict] = []
    for pv in _descubrir_pv(client, auth):
        for tipo in TIPOS:
            try:
                ult = client.service.FECompUltimoAutorizado(Auth=auth, PtoVta=pv, CbteTipo=tipo)
                ultimo_nro = getattr(ult, "CbteNro", 0) or 0
            except Exception:  # noqa: BLE001 — tipo no habilitado para este CUIT
                continue
            if ultimo_nro <= 0:
                continue
            desde = max(1, ultimo_nro - max_por_tipo + 1) if max_por_tipo else 1
            for nro in range(desde, ultimo_nro + 1):
                try:
                    det = client.service.FECompConsultar(
                        Auth=auth, FeCompConsReq={"CbteTipo": tipo, "CbteNro": nro, "PtoVta": pv}
                    )
                    r = det.ResultGet
                    if r is None:  # hueco en la numeración → seguimos
                        continue
                    # Moneda/cotización: WSFEv1 usa códigos propios (PES/DOL); los normalizamos al
                    # mismo shape que Mis Comprobantes (ARS/USD) para que el upsert los trate igual.
                    mon_id = str(getattr(r, "MonId", "PES") or "PES")
                    moneda = {"PES": "ARS", "DOL": "USD"}.get(mon_id, mon_id)
                    out.append(
                        {
                            "cbte_tipo": tipo,
                            "punto_venta": pv,
                            "numero": nro,
                            "fecha": str(getattr(r, "CbteFch", "") or ""),  # yyyymmdd
                            "imp_total": float(getattr(r, "ImpTotal", 0) or 0),  # en moneda de origen
                            "moneda": moneda,
                            "cotizacion": float(getattr(r, "MonCotiz", 1) or 1),
                            "doc_nro": str(getattr(r, "DocNro", "") or ""),
                            "cae": str(getattr(r, "CodAutorizacion", "") or ""),
                        }
                    )
                except Exception:  # noqa: BLE001 — un comprobante problemático no corta la sync
                    continue
    return out
