"""
WSFEv1 — comprobantes EMITIDOS (facturación electrónica oficial).

Portado de research/arca/camino_a_wsaa/comprobantes_emitidos.py. WSFEv1 no tiene un
"listame todo": se itera por (punto de venta, tipo) pidiendo el último número y se baja
cada comprobante con FECompConsultar.

Devuelve datos CRUDOS (el mapeo al formato de Órbita lo hace el servicio/schema).
"""
from __future__ import annotations

import datetime as dt

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


# ════════════════════════════════════════════════════════════════════════════
# EMISIÓN (FECAESolicitar) — facturar desde la app
# ════════════════════════════════════════════════════════════════════════════

# Tipos de comprobante clase C (monotributo: no discrimina IVA).
CBTE_FACTURA_C = 11
CBTE_NOTA_DEBITO_C = 12
CBTE_NOTA_CREDITO_C = 13


class FacturacionError(RuntimeError):
    """Error de emisión: ARCA rechazó el comprobante o devolvió errores de validación.
    Lleva el detalle estructurado (errores de request + observaciones del comprobante)."""

    def __init__(self, mensaje: str, *, errores=None, observaciones=None, resultado=None):
        super().__init__(mensaje)
        self.errores = errores or []
        self.observaciones = observaciones or []
        self.resultado = resultado


def _ymd(d: dt.date) -> int:
    return int(d.strftime("%Y%m%d"))


def _extraer_errores(resp) -> list[str]:
    out: list[str] = []
    errs = getattr(resp, "Errors", None)
    if errs and getattr(errs, "Err", None):
        for e in errs.Err:
            out.append(f"{getattr(e, 'Code', '')}: {getattr(e, 'Msg', '')}".strip())
    return out


def _extraer_obs(det_resp) -> list[str]:
    out: list[str] = []
    if det_resp is None:
        return out
    obs = getattr(det_resp, "Observaciones", None)
    if obs and getattr(obs, "Obs", None):
        for o in obs.Obs:
            out.append(f"{getattr(o, 'Code', '')}: {getattr(o, 'Msg', '')}".strip())
    return out


def listar_puntos_venta(cuit_emisor, cert_bytes, key_bytes, homo=None) -> list[dict]:
    """Puntos de venta del CUIT habilitados para facturar por WEB SERVICE (FEParamGetPtosVenta).

    Sólo devuelve los usables: no bloqueados y sin fecha de baja. Cada uno: {nro, emision_tipo}.
    Si el cliente no tiene ninguno, la lista viene vacía (necesita dar de alta un PV tipo Web Service)."""
    if homo is None:
        homo = settings.arca_homo
    token, sign = get_token_sign("wsfe", cert_bytes, key_bytes, cuit_emisor, homo)
    wsdl = WSDL_HOMO if homo else WSDL_PROD
    client = Client(wsdl, transport=Transport(session=make_session()))
    auth = {"Token": token, "Sign": sign, "Cuit": int(cuit_emisor)}
    res = client.service.FEParamGetPtosVenta(Auth=auth)
    out: list[dict] = []
    pts = getattr(res, "ResultGet", None)
    if pts and getattr(pts, "PtoVenta", None):
        for p in pts.PtoVenta:
            bloqueado = str(getattr(p, "Bloqueado", "N")).strip().upper() in ("S", "SI", "TRUE")
            baja = str(getattr(p, "FchBaja", "") or "").strip()
            if bloqueado or (baja and baja.upper() not in ("", "NULL")):
                continue
            out.append({"nro": int(p.Nro), "emision_tipo": str(getattr(p, "EmisionTipo", "") or "")})
    return sorted(out, key=lambda x: x["nro"])


def proximo_numero(cuit_emisor, cert_bytes, key_bytes, punto_venta, cbte_tipo, homo=None):
    """Siguiente número a emitir para (punto de venta, tipo). Es el último autorizado + 1."""
    if homo is None:
        homo = settings.arca_homo
    token, sign = get_token_sign("wsfe", cert_bytes, key_bytes, cuit_emisor, homo)
    wsdl = WSDL_HOMO if homo else WSDL_PROD
    client = Client(wsdl, transport=Transport(session=make_session()))
    auth = {"Token": token, "Sign": sign, "Cuit": int(cuit_emisor)}
    ult = client.service.FECompUltimoAutorizado(Auth=auth, PtoVta=punto_venta, CbteTipo=cbte_tipo)
    return (getattr(ult, "CbteNro", 0) or 0) + 1


def emitir_comprobante_c(
    cuit_emisor: str | int,
    cert_bytes: bytes,
    key_bytes: bytes,
    *,
    cbte_tipo: int,
    punto_venta: int,
    importe_total: float,
    concepto: int = 1,  # 1 productos · 2 servicios · 3 ambos
    doc_tipo: int = 99,  # 80 CUIT · 96 DNI · 99 consumidor final
    doc_nro: str | int = 0,
    condicion_iva_receptor: int = 5,  # RG 5616 (obligatorio). 5 = Consumidor Final · 1 = RI · 4 = Exento · 6 = Monotributo

    fecha: dt.date | None = None,
    fch_serv_desde: dt.date | None = None,
    fch_serv_hasta: dt.date | None = None,
    fch_vto_pago: dt.date | None = None,
    comprobante_asociado: dict | None = None,  # NC: {"tipo":, "punto_venta":, "numero":}
    homo: bool | None = None,
) -> dict:
    """Emite una Factura C (11) o Nota de Crédito C (13) por WSFEv1 (FECAESolicitar).

    Clase C (monotributo): no discrimina IVA → ImpNeto = ImpTotal, ImpIVA = 0, sin nodo Iva.
    Devuelve el comprobante autorizado (con CAE y su vencimiento). Lanza FacturacionError si ARCA
    rechaza. `homo=None` toma el entorno de `settings.arca_homo`.
    """
    if cbte_tipo not in (CBTE_FACTURA_C, CBTE_NOTA_CREDITO_C):
        raise ValueError("Sólo se admite Factura C (11) o Nota de Crédito C (13).")
    if concepto not in (1, 2, 3):
        raise ValueError("Concepto inválido (1 productos, 2 servicios, 3 ambos).")
    if homo is None:
        homo = settings.arca_homo
    fecha = fecha or dt.date.today()
    total = round(float(importe_total), 2)
    if total <= 0:
        raise ValueError("El importe total debe ser mayor a 0.")

    token, sign = get_token_sign("wsfe", cert_bytes, key_bytes, cuit_emisor, homo)
    wsdl = WSDL_HOMO if homo else WSDL_PROD
    client = Client(wsdl, transport=Transport(session=make_session()))
    auth = {"Token": token, "Sign": sign, "Cuit": int(cuit_emisor)}

    ult = client.service.FECompUltimoAutorizado(Auth=auth, PtoVta=punto_venta, CbteTipo=cbte_tipo)
    numero = (getattr(ult, "CbteNro", 0) or 0) + 1

    det = {
        "Concepto": concepto,
        "DocTipo": doc_tipo,
        "DocNro": int(doc_nro or 0),
        "CondicionIVAReceptorId": condicion_iva_receptor,
        "CbteDesde": numero,
        "CbteHasta": numero,
        "CbteFch": _ymd(fecha),
        "ImpTotal": total,
        "ImpTotConc": 0,
        "ImpNeto": total,
        "ImpOpEx": 0,
        "ImpIVA": 0,
        "ImpTrib": 0,
        "MonId": "PES",
        "MonCotiz": 1,
    }
    # Servicios / ambos: ARCA exige el período de servicio y el vto de pago.
    if concepto in (2, 3):
        det["FchServDesde"] = _ymd(fch_serv_desde or fecha)
        det["FchServHasta"] = _ymd(fch_serv_hasta or fecha)
        det["FchVtoPago"] = _ymd(fch_vto_pago or fecha)
    # Nota de crédito: debe referenciar el comprobante que corrige/anula.
    if cbte_tipo == CBTE_NOTA_CREDITO_C:
        if not comprobante_asociado:
            raise ValueError("La Nota de Crédito C requiere el comprobante asociado.")
        det["CbtesAsoc"] = {
            "CbteAsoc": [
                {
                    "Tipo": int(comprobante_asociado["tipo"]),
                    "PtoVta": int(comprobante_asociado["punto_venta"]),
                    "Nro": int(comprobante_asociado["numero"]),
                }
            ]
        }

    req = {
        "FeCabReq": {"CantReg": 1, "PtoVta": punto_venta, "CbteTipo": cbte_tipo},
        "FeDetReq": {"FECAEDetRequest": [det]},
    }
    resp = client.service.FECAESolicitar(Auth=auth, FeCAEReq=req)

    errores = _extraer_errores(resp)
    cab = getattr(resp, "FeCabResp", None)
    resultado = getattr(cab, "Resultado", "R") if cab else "R"
    det_resp = None
    try:
        det_resp = resp.FeDetResp.FECAEDetResponse[0]
    except Exception:  # noqa: BLE001 — respuesta sin detalle (rechazo de request)
        det_resp = None
    observaciones = _extraer_obs(det_resp)
    cae = (getattr(det_resp, "CAE", "") or "") if det_resp else ""
    cae_vto = (getattr(det_resp, "CAEFchVto", "") or "") if det_resp else ""

    if resultado != "A" or not cae:
        msg = "; ".join(errores + observaciones) or "ARCA rechazó el comprobante."
        raise FacturacionError(
            msg, errores=errores, observaciones=observaciones, resultado=resultado
        )

    return {
        "cbte_tipo": cbte_tipo,
        "punto_venta": punto_venta,
        "numero": numero,
        "fecha": fecha.strftime("%Y-%m-%d"),
        "importe_total": total,
        "cae": str(cae),
        "cae_vto": str(cae_vto),
        "doc_tipo": doc_tipo,
        "doc_nro": str(doc_nro or 0),
        "observaciones": observaciones,
        "homologacion": homo,
    }
