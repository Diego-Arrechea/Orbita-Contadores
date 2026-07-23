"""Apartado de IVA (Libro IVA / posición). GATEADO: sólo cuentas con el IVA habilitado (allowlist
IVA_EMAILS + admins) llegan acá — la dependencia `usuario_iva` cierra todos los endpoints por detrás
del gate del front. Multi-tenant: cada contador opera sólo sobre sus propios clientes (_cliente_propio).

Esta es la PRIMERA rebanada del módulo: arma el Libro IVA de Ventas/Compras a partir de los
comprobantes que ya tenemos cacheados (ComprobanteEmitido, direccion emitido/recibido). El desglose
de IVA discriminado (neto/iva por comprobante, clase A/B/M de un RI) se captura en una rebanada
posterior al extender el parseo del sync; hasta entonces esas columnas están en NULL y el libro cae
al total como neto (correcto para monotributo clase C, que no discrimina IVA)."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import (
    TIPOS_NOTA_CREDITO,
    IvaLibroOut,
    IvaLineaOut,
    IvaPeriodoOut,
    IvaSubtotalesOut,
    nombre_tipo,
)
from ..security import usuario_iva
from .clientes import _cliente_propio

router = APIRouter(prefix="/api/iva", tags=["iva"])

_MESES = (
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
)

# ventas = comprobantes EMITIDOS por el cliente; compras = los RECIBIDOS. La columna física
# ComprobanteEmitido.direccion usa 'emitido'/'recibido'; el apartado de IVA habla de ventas/compras.
_DIR_A_COLUMNA = {"ventas": "emitido", "compras": "recibido"}


def _label_periodo(periodo: str) -> str:
    """'2026-07' -> 'Julio 2026'. Cae al crudo si el formato no matchea."""
    try:
        anio, mes = periodo.split("-")
        return f"{_MESES[int(mes)]} {anio}"
    except (ValueError, IndexError):
        return periodo


def _rango_mes(periodo: str) -> tuple[dt.date, dt.date]:
    """'2026-07' -> (2026-07-01, 2026-08-01). El fin es EXCLUSIVO (< fin). Portable (filtra por rango
    de fecha, sin funciones de fecha SQL específicas del motor)."""
    anio, mes = int(periodo[:4]), int(periodo[5:7])
    desde = dt.date(anio, mes, 1)
    hasta = dt.date(anio + 1, 1, 1) if mes == 12 else dt.date(anio, mes + 1, 1)
    return desde, hasta


@router.get("/clientes/{cuit}/periodos", response_model=list[IvaPeriodoOut])
def periodos_cliente(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Meses con comprobantes del cliente (más reciente primero), para el selector del Libro IVA."""
    _cliente_propio(db, cuit, usuario)
    comp = models.ComprobanteEmitido
    filas = db.execute(
        select(comp.fecha, comp.direccion).where(comp.cuit == cuit)
    ).all()
    # Agrupa por aaaa-mm en Python (volumen por-cliente acotado; evita funciones de fecha por motor).
    conteo: dict[str, dict[str, int]] = {}
    for fecha, direccion in filas:
        periodo = fecha.strftime("%Y-%m")
        slot = conteo.setdefault(periodo, {"ventas": 0, "compras": 0})
        if direccion == "recibido":
            slot["compras"] += 1
        else:  # 'emitido' (o cualquier otro histórico) cuenta como venta
            slot["ventas"] += 1
    return [
        IvaPeriodoOut(
            periodo=p,
            label=_label_periodo(p),
            ventas=conteo[p]["ventas"],
            compras=conteo[p]["compras"],
        )
        for p in sorted(conteo, reverse=True)
    ]


@router.get("/clientes/{cuit}/libro", response_model=IvaLibroOut)
def libro_iva(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    direccion: str = Query("ventas", pattern="^(ventas|compras)$"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Libro IVA del cliente para un período: renglón por comprobante + subtotales neteados (las
    notas de crédito restan)."""
    _cliente_propio(db, cuit, usuario)
    columna = _DIR_A_COLUMNA.get(direccion)
    if columna is None:  # el pattern del Query ya lo garantiza; defensa en profundidad
        raise HTTPException(status_code=422, detail="Dirección inválida.")
    desde, hasta = _rango_mes(periodo)

    comp = models.ComprobanteEmitido
    comps = db.scalars(
        select(comp)
        .where(
            comp.cuit == cuit,
            comp.direccion == columna,
            comp.fecha >= desde,
            comp.fecha < hasta,
        )
        .order_by(comp.fecha, comp.punto_venta, comp.numero)
    ).all()

    lineas: list[IvaLineaOut] = []
    sub = IvaSubtotalesOut()
    for c in comps:
        es_nc = c.cbte_tipo in TIPOS_NOTA_CREDITO
        signo = -1.0 if es_nc else 1.0
        total = float(c.imp_total)
        # Desglose capturado (RI clase A/B/M) o no (clase C / comprobantes previos a la feature).
        tiene_desglose = c.imp_neto is not None or c.imp_iva is not None
        if tiene_desglose:
            neto = float(c.imp_neto or 0)
            iva = float(c.imp_iva or 0)
            no_gravado = float(c.imp_no_gravado or 0)
            exento = float(c.imp_exento or 0)
            tributos = float(c.imp_trib or 0)
        else:
            neto, iva, no_gravado, exento, tributos = total, 0.0, 0.0, 0.0, 0.0

        lineas.append(
            IvaLineaOut(
                id=f"{c.cuit}-{c.direccion}-{c.punto_venta}-{c.cbte_tipo}-{c.numero}",
                fecha=c.fecha.isoformat(),
                tipo=nombre_tipo(c.cbte_tipo),
                cbteTipo=c.cbte_tipo,
                puntoVenta=c.punto_venta,
                numero=str(c.numero).zfill(8),
                contraparteNombre=c.contraparte_nombre or "—",
                contraparteCuit=c.doc_nro or "",
                neto=neto,
                iva=iva,
                noGravado=no_gravado,
                exento=exento,
                tributos=tributos,
                total=total,
                esNotaCredito=es_nc,
                sinDesglose=not tiene_desglose,
            )
        )
        sub.cantidad += 1
        sub.neto += signo * neto
        sub.iva += signo * iva
        sub.noGravado += signo * no_gravado
        sub.exento += signo * exento
        sub.tributos += signo * tributos
        sub.total += signo * total

    # Redondeo a 2 decimales (evita el ruido de coma flotante en los subtotales).
    for campo in ("neto", "iva", "noGravado", "exento", "tributos", "total"):
        setattr(sub, campo, round(getattr(sub, campo), 2))

    return IvaLibroOut(
        cuit=cuit, periodo=periodo, direccion=direccion, lineas=lineas, subtotales=sub
    )
