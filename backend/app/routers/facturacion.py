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

import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..arca import wsfev1
from ..config import facturacion_habilitada_para, settings
from ..db import SessionLocal, get_db
from ..schemas import JobOut
from ..scraping import jobs
from ..security import admin_actual, usuario_actual
from ..services import facturacion as facturacion_svc
from .clientes import _cliente_propio

router = APIRouter(prefix="/api", tags=["facturacion"])


def _exigir_habilitado(usuario: models.Usuario) -> None:
    """Rollout gateado: emails en FACTURACION_EMAILS + admins pueden facturar."""
    if not facturacion_habilitada_para(usuario.email, usuario.rol):
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
    punto_venta: int | None = Field(None, description="None = auto-detectar el PV Web Service del cliente")
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
    except facturacion_svc.SinPuntoVenta:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "sin_punto_venta",
                "mensaje": (
                    "Este cliente no tiene un punto de venta de facturación electrónica (Web Service) "
                    "dado de alta en ARCA. Hay que crearlo una vez."
                ),
            },
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


# ── Preparar facturación (generar el cert) como JOB en segundo plano ──────────
def _correr_preparacion(job_id: str, cuit: str) -> None:
    """Genera el certificado del cliente (bootstrap, ~1 min) en un thread, reportando progreso."""
    db = SessionLocal()
    try:
        if settings.arca_homo:
            # En homologación se usa el cert de prueba: no hay nada que generar.
            jobs.actualizar(job_id, estado="terminado", progreso=100, mensaje="Listo (homologación)")
            return

        def prog(pct: int, msg: str) -> None:
            jobs.actualizar(job_id, progreso=min(99, max(0, pct)), mensaje=msg)

        facturacion_svc.asegurar_certificado(db, cuit, on_progress=prog)
        jobs.actualizar(job_id, estado="terminado", progreso=100, mensaje="Facturación habilitada")
    except Exception as e:  # noqa: BLE001
        jobs.actualizar(
            job_id,
            estado="error",
            error=str(e),
            mensaje="No se pudo habilitar la facturación de este cliente.",
        )
    finally:
        db.close()


@router.post("/clientes/{cuit}/facturacion/preparar")
def preparar_facturacion(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
):
    """Arranca, en segundo plano, la generación del certificado del cliente. Devuelve job_id para
    seguir el progreso (el bootstrap es scraping y tarda ~1 min)."""
    _exigir_habilitado(usuario)
    _cliente_propio(db, cuit, usuario)
    job_id = jobs.crear_job()
    threading.Thread(target=_correr_preparacion, args=(job_id, cuit), daemon=True).start()
    return {"job_id": job_id}


@router.get("/clientes/{cuit}/facturacion/preparar/{job_id}", response_model=JobOut)
def progreso_preparacion(
    cuit: str,
    job_id: str,
    usuario: models.Usuario = Depends(usuario_actual),
):
    _exigir_habilitado(usuario)
    job = jobs.obtener(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado.")
    return job
