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
import io
import json
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..services import lid_export
from ..schemas import (
    TIPOS_NOTA_CREDITO,
    IvaAlicuotaOut,
    IvaLadoOut,
    IvaLibroOut,
    IvaLineaOut,
    IvaPeriodoOut,
    IvaPosicionOut,
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


# Alícuotas oficiales de IVA (para inferir la alícuota de cada comprobante desde la relación IVA/neto).
_ALICUOTAS = (27.0, 21.0, 10.5, 5.0, 2.5)


def _clasificar_alicuota(neto: float, iva: float) -> str:
    """Infiere la alícuota de un comprobante por la relación IVA/neto. Sirve para el caso de una sola
    alícuota (la mayoría); los mixtos (21%+10,5% en un mismo comprobante) caen en 'Otras' porque sólo
    tenemos el neto/IVA TOTAL, no el detalle por alícuota."""
    if not neto:
        return "0%"
    ratio = round(iva / neto * 100, 2)
    for a in _ALICUOTAS:
        if abs(ratio - a) <= 0.3:
            return f"{a:g}%"
    if ratio <= 0.3:
        return "0%"
    return "Otras"


def _agregar_lado(comps: list[models.ComprobanteEmitido]) -> IvaLadoOut:
    """Agrega los comprobantes de un lado (ventas o compras) neteando las notas de crédito, con el
    desglose por alícuota (sólo la parte gravada; exento/no gravado van como totales del lado)."""
    lado = IvaLadoOut()
    por_alic: dict[str, dict] = {}
    for c in comps:
        signo = -1.0 if c.cbte_tipo in TIPOS_NOTA_CREDITO else 1.0
        total = float(c.imp_total)
        tiene = c.imp_neto is not None or c.imp_iva is not None
        neto = float(c.imp_neto or 0) if tiene else total
        iva = float(c.imp_iva or 0)
        no_grav = float(c.imp_no_gravado or 0)
        exento = float(c.imp_exento or 0)
        trib = float(c.imp_trib or 0)
        lado.cantidad += 1
        lado.neto += signo * neto
        lado.iva += signo * iva
        lado.noGravado += signo * no_grav
        lado.exento += signo * exento
        lado.tributos += signo * trib
        lado.total += signo * total
        # Desglose por alícuota: preferimos el detalle REAL capturado (alicuotas_json); si no está
        # (datos viejos), inferimos una única alícuota del total. exento/no gravado van aparte.
        detalle = None
        if c.alicuotas_json:
            try:
                detalle = json.loads(c.alicuotas_json)
            except ValueError:
                detalle = None
        if detalle:
            for a in detalle:
                clave = f"{float(a['alicuota']):g}%"
                slot = por_alic.setdefault(clave, {"neto": 0.0, "iva": 0.0, "cantidad": 0})
                slot["neto"] += signo * float(a["base"])
                slot["iva"] += signo * float(a["iva"])
                slot["cantidad"] += 1
        elif neto:
            clave = _clasificar_alicuota(neto, iva)
            slot = por_alic.setdefault(clave, {"neto": 0.0, "iva": 0.0, "cantidad": 0})
            slot["neto"] += signo * neto
            slot["iva"] += signo * iva
            slot["cantidad"] += 1
    for campo in ("neto", "iva", "noGravado", "exento", "tributos", "total"):
        setattr(lado, campo, round(getattr(lado, campo), 2))
    # Orden de alícuotas: las estándar de mayor a menor, después 'Otras'/'0%'.
    orden = {f"{a:g}%": i for i, a in enumerate(_ALICUOTAS)}
    lado.porAlicuota = [
        IvaAlicuotaOut(
            alicuota=k, neto=round(v["neto"], 2), iva=round(v["iva"], 2), cantidad=v["cantidad"]
        )
        for k, v in sorted(por_alic.items(), key=lambda kv: orden.get(kv[0], 99))
    ]
    return lado


@router.get("/clientes/{cuit}/posicion", response_model=IvaPosicionOut)
def posicion_iva(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Posición de IVA del período (estilo F2002): débito (ventas) − crédito (compras) = saldo
    técnico; menos percepciones sufridas = saldo del impuesto (a pagar o a favor)."""
    _cliente_propio(db, cuit, usuario)
    desde, hasta = _rango_mes(periodo)
    comp = models.ComprobanteEmitido

    def _comps(columna: str):
        return db.scalars(
            select(comp).where(
                comp.cuit == cuit,
                comp.direccion == columna,
                comp.fecha >= desde,
                comp.fecha < hasta,
            )
        ).all()

    ventas = _agregar_lado(_comps("emitido"))
    compras = _agregar_lado(_comps("recibido"))
    debito = ventas.iva
    credito = compras.iva
    saldo_tecnico = round(debito - credito, 2)
    # Percepciones de IVA sufridas (pago a cuenta): NO las contamos todavía. Mis Comprobantes sólo da
    # el TOTAL de otros tributos (lumpeado: percepción IVA + IIBB + municipal + otros), no el desglose,
    # así que no podemos identificar la percepción IVA real. Contar el lumpeado sobre-declara el pago a
    # cuenta (infla el crédito) → peligroso. Queda en 0 hasta capturar el detalle del comprobante.
    percepciones = 0.0
    saldo_impuesto = round(saldo_tecnico - percepciones, 2)
    return IvaPosicionOut(
        cuit=cuit,
        periodo=periodo,
        ventas=ventas,
        compras=compras,
        debitoFiscal=debito,
        creditoFiscal=credito,
        saldoTecnico=saldo_tecnico,
        percepciones=round(percepciones, 2),
        saldoImpuesto=abs(saldo_impuesto),
        aFavor=saldo_impuesto < 0,
    )


@router.get("/clientes/{cuit}/export/lid")
def export_lid(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    direccion: str = Query("ventas", pattern="^(ventas|compras)$"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Descarga el Libro IVA Digital de AFIP (ventas o compras) como ZIP con los dos TXT de ancho fijo
    (cabecera + alícuotas), listos para el portal Libro IVA Digital."""
    _cliente_propio(db, cuit, usuario)
    desde, hasta = _rango_mes(periodo)
    columna = "emitido" if direccion == "ventas" else "recibido"
    comp = models.ComprobanteEmitido
    comps = db.scalars(
        select(comp).where(
            comp.cuit == cuit,
            comp.direccion == columna,
            comp.fecha >= desde,
            comp.fecha < hasta,
        )
    ).all()
    if direccion == "ventas":
        archivos = lid_export.generar_lid_ventas(comps)
        etiqueta, cap = "Ventas", "Ventas"
    else:
        archivos = lid_export.generar_lid_compras(comps)
        etiqueta, cap = "Compras", "Compras"
    per = periodo.replace("-", "")  # aaaamm para el nombre
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"LID {etiqueta} {per}.txt", archivos["cabecera"])
        z.writestr(f"LID {etiqueta} Alicuotas {per}.txt", archivos["alicuotas"])
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="LibroIVADigital_{cap}_{per}.zip"'},
    )
