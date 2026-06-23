"""
Facturación electrónica (WSFEv1, FECAESolicitar) — emitir comprobantes desde la app.

Dos caminos:
  • PRUEBA en HOMOLOGACIÓN (admin): valida el motor WSAA→FECAESolicitar con un certificado de
    homologación configurado en el .env, sin generar comprobantes reales.
  • PRODUCCIÓN por cliente (contador dueño): genera el certificado del cliente on-demand (con la clave
    del propio cliente) y emite a su nombre. Cubre Factura C (11) y Nota de Crédito C (13).

Ver memoria `credenciales-arca`: el certificado es por CLIENTE, con la clave del propio cliente.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..arca import wsfev1
from ..config import facturacion_habilitada, settings
from ..db import get_db
from ..security import admin_actual, usuario_actual
from ..services import facturacion as facturacion_svc
from .clientes import _cliente_propio

router = APIRouter(prefix="/api", tags=["facturacion"])


def _exigir_habilitado(usuario: models.Usuario) -> None:
    """Rollout gateado: sólo los emails en FACTURACION_EMAILS pueden facturar."""
    if not facturacion_habilitada(usuario.email):
        raise HTTPException(
            status_code=403,
            detail="La facturación electrónica todavía no está habilitada para tu cuenta.",
        )


class ComprobanteAsociado(BaseModel):
    tipo: int
    punto_venta: int
    numero: int


def _emitir_o_http(**kwargs):
    """Llama al motor de emisión traduciendo los errores a HTTP legibles."""
    try:
        return wsfev1.emitir_comprobante_c(**kwargs)
    except wsfev1.FacturacionError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "mensaje": str(e),
                "errores": e.errores,
                "observaciones": e.observaciones,
                "resultado": e.resultado,
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 — error de red/WS
        raise HTTPException(status_code=502, detail=f"Error comunicándose con ARCA: {e}")


# ── Prueba en homologación (admin) ───────────────────────────────────────────
class EmitirTestIn(BaseModel):
    cbte_tipo: int = Field(11, description="11 = Factura C · 13 = Nota de Crédito C")
    importe_total: float = Field(..., gt=0)
    concepto: int = Field(1, description="1 productos · 2 servicios · 3 ambos")
    doc_tipo: int = Field(99, description="80 CUIT · 96 DNI · 99 consumidor final")
    doc_nro: str = "0"
    condicion_iva_receptor: int = Field(5, description="RG 5616: 5 Consumidor Final · 1 RI · 4 Exento · 6 Monotributo")
    comprobante_asociado: ComprobanteAsociado | None = None
    punto_venta: int | None = None


@router.post("/facturacion/test-homologacion")
def emitir_test_homologacion(body: EmitirTestIn, _: models.Usuario = Depends(admin_actual)):
    """Emite un comprobante de PRUEBA en homologación con el certificado configurado."""
    cert_path = settings.arca_homo_cert_path
    key_path = settings.arca_homo_key_path
    cuit = settings.arca_homo_cuit
    if not (cert_path and key_path and cuit):
        raise HTTPException(
            status_code=400,
            detail=(
                "Falta configurar el certificado de homologación. Generá un certificado en el "
                "entorno de pruebas de AFIP (WSASS), habilitá su CUIT para el WS de Facturación "
                "Electrónica y seteá ARCA_HOMO_CERT_PATH, ARCA_HOMO_KEY_PATH y ARCA_HOMO_CUIT en el .env."
            ),
        )
    try:
        cert_bytes = Path(cert_path).read_bytes()
        key_bytes = Path(key_path).read_bytes()
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el certificado de homologación: {e}")

    asociado = body.comprobante_asociado.model_dump() if body.comprobante_asociado else None
    return _emitir_o_http(
        cuit_emisor=cuit,
        cert_bytes=cert_bytes,
        key_bytes=key_bytes,
        cbte_tipo=body.cbte_tipo,
        punto_venta=body.punto_venta or settings.arca_homo_punto_venta,
        importe_total=body.importe_total,
        concepto=body.concepto,
        doc_tipo=body.doc_tipo,
        doc_nro=body.doc_nro,
        condicion_iva_receptor=body.condicion_iva_receptor,
        comprobante_asociado=asociado,
        homo=True,  # este endpoint SIEMPRE es homologación
    )


# ── Facturación por cliente (contador dueño) ─────────────────────────────────
@router.get("/clientes/{cuit}/facturacion/contexto")
def contexto_facturacion(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
):
    """Si el cliente ya puede facturar sin esperar (certificado generado)."""
    _exigir_habilitado(usuario)
    _cliente_propio(db, cuit, usuario)
    return facturacion_svc.contexto(db, cuit)


class FacturarIn(BaseModel):
    cbte_tipo: int = Field(11, description="11 = Factura C · 13 = Nota de Crédito C")
    importe_total: float = Field(..., gt=0)
    punto_venta: int = 1
    concepto: int = Field(1, description="1 productos · 2 servicios · 3 ambos")
    doc_tipo: int = Field(99, description="80 CUIT · 96 DNI · 99 consumidor final")
    doc_nro: str = "0"
    condicion_iva_receptor: int = Field(5, description="RG 5616: 5 Consumidor Final · 1 RI · 4 Exento · 6 Monotributo")
    comprobante_asociado: ComprobanteAsociado | None = None


@router.post("/clientes/{cuit}/facturar")
def facturar(
    cuit: str,
    body: FacturarIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
):
    """Emite una Factura C / Nota de Crédito C a nombre del cliente (emisión REAL en producción).
    Genera el certificado del cliente la primera vez (puede tardar ~1 min)."""
    _exigir_habilitado(usuario)
    _cliente_propio(db, cuit, usuario)
    asociado = body.comprobante_asociado.model_dump() if body.comprobante_asociado else None
    try:
        return facturacion_svc.emitir(
            db,
            cuit,
            cbte_tipo=body.cbte_tipo,
            importe_total=body.importe_total,
            punto_venta=body.punto_venta,
            concepto=body.concepto,
            doc_tipo=body.doc_tipo,
            doc_nro=body.doc_nro,
            condicion_iva_receptor=body.condicion_iva_receptor,
            comprobante_asociado=asociado,
        )
    except wsfev1.FacturacionError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "mensaje": str(e),
                "errores": e.errores,
                "observaciones": e.observaciones,
                "resultado": e.resultado,
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001 — bootstrap del cert o WS de ARCA
        raise HTTPException(status_code=502, detail=f"No se pudo emitir el comprobante: {e}")
