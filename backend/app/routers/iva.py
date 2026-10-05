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

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..arca.afip import LivaOcupadoError
from ..db import get_db
from ..services import iva_correcciones, iva_dj, libro_iva_pdf, lid_export, lid_import
from ..services.iva_correcciones import PAR_LETRA, clave_comprobante
from ..schemas import (
    TIPOS_MONOTRIBUTO,
    TIPOS_NOTA_CREDITO,
    IvaAjusteIn,
    IvaAlicuotaLineaOut,
    IvaAlicuotaOut,
    IvaCorreccionIn,
    IvaDjPresentadaOut,
    IvaInconsistenciaOut,
    IvaLadoOut,
    IvaLibroOut,
    IvaLineaOut,
    IvaOriginalOut,
    IvaPercepcionesOut,
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


def _comps_periodo(
    db: Session, cuit: str, periodo: str, columna: str
) -> list[models.ComprobanteEmitido]:
    """Comprobantes del cliente en el mes, de un lado ('emitido' = ventas, 'recibido' = compras)."""
    desde, hasta = _rango_mes(periodo)
    comp = models.ComprobanteEmitido
    return list(
        db.scalars(
            select(comp)
            .where(
                comp.cuit == cuit,
                comp.direccion == columna,
                comp.fecha >= desde,
                comp.fecha < hasta,
            )
            .order_by(comp.fecha, comp.punto_venta, comp.numero)
        ).all()
    )


def _efectivos_periodo(
    db: Session, cuit: str, periodo: str, columna: str, *, con_excluidos: bool = False
):
    """Comprobantes del mes con las correcciones del contador aplicadas. Por defecto sin los
    excluidos (no corresponden al negocio): así los ven la posición, el export y las revisiones."""
    efs = iva_correcciones.efectivos(db, _comps_periodo(db, cuit, periodo, columna))
    return efs if con_excluidos else [e for e in efs if not e.excluido]


def _percep_out(p: dict | None) -> IvaPercepcionesOut | None:
    return IvaPercepcionesOut(**{k: round(v, 2) for k, v in p.items()}) if p is not None else None


def _armar_libro(db: Session, cuit: str, periodo: str, direccion: str) -> IvaLibroOut:
    """Libro IVA del período con las correcciones aplicadas. Los excluidos se listan (marcados) pero
    no suman a los subtotales."""
    columna = _DIR_A_COLUMNA[direccion]
    crudos = _comps_periodo(db, cuit, periodo, columna)
    efs = iva_correcciones.efectivos(db, crudos)

    lineas: list[IvaLineaOut] = []
    sub = IvaSubtotalesOut()
    percep_tot = {k: 0.0 for k in iva_correcciones.PERCEP_CAMPOS}
    excluidos = corregidos = 0
    for crudo, c in zip(crudos, efs):
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
        percep = iva_correcciones.percepciones_de(c)

        # Valores de antes de corregir: el panel de edición parte de acá y "volver al original" los
        # muestra. Se mandan siempre (son baratos) para que el panel abra igual en cualquier fila.
        o = c.original
        original = IvaOriginalOut(
            tipo=nombre_tipo(c.cbte_tipo_original),
            cbteTipo=c.cbte_tipo_original,
            neto=o["neto"], iva=o["iva"], noGravado=o["noGravado"],
            exento=o["exento"], tributos=o["tributos"], total=o["total"],
            alicuotas=[IvaAlicuotaLineaOut(**a) for a in iva_correcciones.alicuotas_de(crudo)],
            percepciones=_percep_out(iva_correcciones.percepciones_de(crudo)),
        )
        alt = PAR_LETRA.get(c.cbte_tipo_original)
        lineas.append(
            IvaLineaOut(
                id=clave_comprobante(c),
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
                compId=c.id,
                corregido=c.corregido,
                excluido=c.excluido,
                nota=c.nota,
                alicuotas=[IvaAlicuotaLineaOut(**a) for a in iva_correcciones.alicuotas_de(c)],
                percepciones=_percep_out(percep),
                original=original,
                cbteTipoAlternativo=alt,
                tipoAlternativo=nombre_tipo(alt) if alt else None,
            )
        )
        if c.corregido:
            corregidos += 1
        if c.excluido:
            excluidos += 1
            continue
        sub.cantidad += 1
        sub.neto += signo * neto
        sub.iva += signo * iva
        sub.noGravado += signo * no_gravado
        sub.exento += signo * exento
        sub.tributos += signo * tributos
        sub.total += signo * total
        for k, v in percep.items():
            percep_tot[k] += signo * v

    # Redondeo a 2 decimales (evita el ruido de coma flotante en los subtotales).
    for campo in ("neto", "iva", "noGravado", "exento", "tributos", "total"):
        setattr(sub, campo, round(getattr(sub, campo), 2))

    return IvaLibroOut(
        cuit=cuit,
        periodo=periodo,
        direccion=direccion,
        lineas=lineas,
        subtotales=sub,
        porAlicuota=_agregar_lado([c for c in efs if not c.excluido]).porAlicuota,
        percepciones=_percep_out(percep_tot),
        excluidos=excluidos,
        corregidos=corregidos,
    )


@router.get("/clientes/{cuit}/libro", response_model=IvaLibroOut)
def libro_iva(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    direccion: str = Query("ventas", pattern="^(ventas|compras)$"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Libro IVA del cliente para un período: renglón por comprobante (con las correcciones del
    contador aplicadas) + subtotales neteados (las notas de crédito restan; los excluidos no suman)."""
    _cliente_propio(db, cuit, usuario)
    if direccion not in _DIR_A_COLUMNA:  # el pattern del Query ya lo garantiza; defensa en profundidad
        raise HTTPException(status_code=422, detail="Dirección inválida.")
    return _armar_libro(db, cuit, periodo, direccion)


@router.get("/clientes/{cuit}/libro/pdf")
def libro_iva_pdf_endpoint(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    direccion: str = Query("ventas", pattern="^(ventas|compras)$"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """El Libro IVA del período en PDF (detalle por comprobante y alícuota, percepciones separadas,
    resumen por alícuota y totales), para controlar contra el Portal IVA o archivar."""
    cliente = _cliente_propio(db, cuit, usuario)
    efs = _efectivos_periodo(db, cuit, periodo, _DIR_A_COLUMNA[direccion], con_excluidos=True)
    pdf = libro_iva_pdf.generar(
        efs,
        cliente_nombre=cliente.nombre,
        cuit=cuit,
        periodo_label=_label_periodo(periodo),
        direccion=direccion,
        por_alicuota=_agregar_lado([e for e in efs if not e.excluido]).porAlicuota,
    )
    cap = "Ventas" if direccion == "ventas" else "Compras"
    per = periodo.replace("-", "")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="LibroIVA_{cap}_{per}_{cuit}.pdf"'},
    )


def _comprobante_del_cliente(db: Session, cuit: str, comp_id: int) -> models.ComprobanteEmitido:
    c = db.get(models.ComprobanteEmitido, comp_id)
    if c is None or c.cuit != cuit:
        raise HTTPException(status_code=404, detail="Comprobante no encontrado.")
    return c


@router.put("/clientes/{cuit}/comprobantes/{comp_id}/correccion")
def guardar_correccion(
    cuit: str,
    comp_id: int,
    datos: IvaCorreccionIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Guarda la corrección del contador sobre un comprobante (alícuota, letra, no gravado/exento,
    reparto de percepciones, exclusión). No toca el comprobante: se aplica al armar el libro, la
    posición y los archivos. Todo en null y excluido=false = vuelve al original."""
    _cliente_propio(db, cuit, usuario)
    c = _comprobante_del_cliente(db, cuit, comp_id)
    try:
        corr = iva_correcciones.guardar(
            db,
            c,
            cbte_tipo=datos.cbteTipo,
            alicuotas=[a.model_dump() for a in datos.alicuotas] if datos.alicuotas is not None else None,
            no_gravado=datos.noGravado,
            exento=datos.exento,
            percepciones=datos.percepciones.model_dump() if datos.percepciones is not None else None,
            excluido=datos.excluido,
            nota=datos.nota,
            usuario_id=usuario.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "corregido": corr is not None}


@router.delete("/clientes/{cuit}/comprobantes/{comp_id}/correccion")
def borrar_correccion(
    cuit: str,
    comp_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Descarta la corrección del comprobante: vuelve a los valores originales."""
    _cliente_propio(db, cuit, usuario)
    c = _comprobante_del_cliente(db, cuit, comp_id)
    corr = iva_correcciones.buscar(db, c)
    if corr is not None:
        db.delete(corr)
        db.commit()
    return {"ok": True}


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
    # Con las correcciones del contador aplicadas y sin los comprobantes excluidos.
    recibido_comps = _efectivos_periodo(db, cuit, periodo, "recibido")
    ventas = _agregar_lado(_efectivos_periodo(db, cuit, periodo, "emitido"))
    compras = _agregar_lado(recibido_comps)
    debito = ventas.iva
    credito = compras.iva
    saldo_tecnico = round(debito - credito, 2)
    # Percepciones de IVA sufridas (pago a cuenta): salen del desglose REAL importado del borrador de
    # AFIP (percepciones_json.iva). Si no se importó, quedan en 0 (Mis Comprobantes sólo da el total
    # lumpeado, y contarlo como percepción IVA sobre-declararía el pago a cuenta).
    percepciones = 0.0
    for c in recibido_comps:
        if not c.percepciones_json:
            continue
        try:
            pj = json.loads(c.percepciones_json)
        except ValueError:
            continue
        signo = -1.0 if c.cbte_tipo in TIPOS_NOTA_CREDITO else 1.0
        percepciones += signo * float(pj.get("iva") or 0)
    percepciones = round(percepciones, 2)
    # Ajustes manuales del contador (saldo a favor anterior, retenciones, otros pagos a cuenta).
    aj = db.scalar(
        select(models.IvaAjuste).where(
            models.IvaAjuste.cuit == cuit, models.IvaAjuste.periodo == periodo
        )
    )
    retenciones = float(aj.retenciones or 0) if aj else 0.0
    otros_pagos = float(aj.otros_pagos or 0) if aj else 0.0
    saldo_favor_anterior = float(aj.saldo_favor_anterior or 0) if aj else 0.0
    # Saldo del impuesto: técnico − pagos a cuenta − saldo a favor anterior. >0 a pagar, <0 a favor.
    saldo_impuesto = round(
        saldo_tecnico - percepciones - retenciones - otros_pagos - saldo_favor_anterior, 2
    )
    return IvaPosicionOut(
        cuit=cuit,
        periodo=periodo,
        ventas=ventas,
        compras=compras,
        debitoFiscal=debito,
        creditoFiscal=credito,
        saldoTecnico=saldo_tecnico,
        percepciones=round(percepciones, 2),
        retenciones=round(retenciones, 2),
        otrosPagos=round(otros_pagos, 2),
        saldoFavorAnterior=round(saldo_favor_anterior, 2),
        saldoImpuesto=abs(saldo_impuesto),
        aFavor=saldo_impuesto < 0,
    )


@router.patch("/clientes/{cuit}/ajustes")
def guardar_ajustes(
    cuit: str,
    datos: IvaAjusteIn,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Guarda los ajustes manuales de la posición de IVA del período (saldo a favor anterior,
    retenciones, otros pagos a cuenta). Upsert por (cuit, período)."""
    _cliente_propio(db, cuit, usuario)
    aj = db.scalar(
        select(models.IvaAjuste).where(
            models.IvaAjuste.cuit == cuit, models.IvaAjuste.periodo == periodo
        )
    )
    if aj is None:
        aj = models.IvaAjuste(cuit=cuit, periodo=periodo)
        db.add(aj)
    aj.saldo_favor_anterior = datos.saldoFavorAnterior
    aj.retenciones = datos.retenciones
    aj.otros_pagos = datos.otrosPagos
    aj.actualizado_en = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return {"ok": True}


@router.post("/clientes/{cuit}/importar-de-afip")
def importar_percepciones_de_afip(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Trae el detalle del período directo de AFIP (percepciones IVA/IIBB/municipales separadas por
    comprobante) y lo aplica sobre el Libro IVA — sin descargar ni subir archivos. Sólo funciona
    sobre períodos que todavía no presentaron el Libro IVA; para uno ya presentado queda el import
    por archivo. Tarda un rato (AFIP procesa la consulta): el front debe mostrar progreso."""
    _cliente_propio(db, cuit, usuario)
    try:
        return iva_dj.importar_percepciones_auto(db, cuit, periodo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LivaOcupadoError as e:
        if e.motivo == "presentado":
            raise HTTPException(
                status_code=409,
                detail="El Libro IVA de este período ya está presentado, así que el detalle no se "
                "puede traer al instante. Descargá el archivo del período desde el Portal IVA e "
                "importalo acá con el botón de subir archivo.",
            )
        raise HTTPException(
            status_code=409,
            detail="Hay un borrador del Libro IVA abierto para este cliente en el Portal IVA. "
            "Presentalo o descartalo y volvé a intentar.",
        )
    except Exception:  # noqa: BLE001 — falla de la consulta, no del pedido
        raise HTTPException(
            status_code=502,
            detail="No pudimos traer el detalle del período en este momento. Probá de nuevo en unos minutos.",
        )


@router.get("/clientes/{cuit}/dj-presentada", response_model=IvaDjPresentadaOut)
def dj_presentada(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Lo declarado en el IVA del período, si ya fue presentado: débito, crédito, percepciones y
    retenciones sufridas, saldo a favor anterior y saldo del impuesto. Con esto el contador completa
    los ajustes sin tipearlos y compara contra lo que calcula Órbita."""
    _cliente_propio(db, cuit, usuario)
    try:
        datos = iva_dj.traer_dj_presentada(db, cuit, periodo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:  # noqa: BLE001 — falla de la consulta, no del pedido
        raise HTTPException(
            status_code=502,
            detail="No pudimos consultar la declaración de IVA del período. Probá de nuevo en unos minutos.",
        )
    if not datos:
        raise HTTPException(
            status_code=404,
            detail="Este período todavía no tiene una declaración de IVA presentada.",
        )
    return IvaDjPresentadaOut(
        periodo=datos.get("periodo") or periodo,
        formulario=datos.get("formulario"),
        presentadaEn=datos.get("presentada_en"),
        debitoFiscal=round(float(datos.get("debito_fiscal") or 0), 2),
        creditoFiscal=round(float(datos.get("credito_fiscal") or 0), 2),
        saldoTecnico=round(float(datos.get("saldo_tecnico") or 0), 2),
        percepciones=round(float(datos.get("percepciones") or 0), 2),
        retenciones=round(float(datos.get("retenciones") or 0), 2),
        otrosPagos=round(float(datos.get("otros_pagos") or 0), 2),
        saldoFavorAnterior=round(float(datos.get("saldo_favor_anterior") or 0), 2),
        saldoImpuesto=round(float(datos.get("saldo_impuesto") or 0), 2),
    )


# --- Detección de inconsistencias (revisiones sugeridas) --------------------------------------------
_ALICUOTAS_STD = (0.0, 2.5, 5.0, 10.5, 21.0, 27.0)


def _rate_estandar(neto: float, iva: float) -> bool:
    """¿La alícuota efectiva (iva/neto) coincide con una oficial (±0.5)?"""
    if not neto:
        return True
    r = round(iva / neto * 100, 1)
    return any(abs(r - a) <= 0.5 for a in _ALICUOTAS_STD)


def _n_alicuotas(c: models.ComprobanteEmitido) -> int:
    if not c.alicuotas_json:
        return 1
    try:
        return len(json.loads(c.alicuotas_json)) or 1
    except ValueError:
        return 1


def _detectar_inconsistencias(comps: list, lado: str) -> list[IvaInconsistenciaOut]:
    """Revisiones sugeridas sobre los comprobantes de un lado. No corrige: sólo marca."""
    out: list[IvaInconsistenciaOut] = []
    for c in comps:
        if c.cbte_tipo in TIPOS_NOTA_CREDITO:
            continue
        neto = float(c.imp_neto or 0)
        iva = float(c.imp_iva or 0)
        exento = float(c.imp_exento or 0)
        no_grav = float(c.imp_no_gravado or 0)
        es_c = c.cbte_tipo in TIPOS_MONOTRIBUTO  # clase C no discrimina IVA (no aplica)
        cid = clave_comprobante(c)
        etq = f"{nombre_tipo(c.cbte_tipo)} {str(c.punto_venta).zfill(5)}-{str(c.numero).zfill(8)}"
        cp = c.contraparte_nombre or "—"

        def _add(tipo: str, sev: str, detalle: str) -> None:
            out.append(
                IvaInconsistenciaOut(
                    tipo=tipo, severidad=sev, lado=lado, comprobanteId=cid,
                    comprobante=etq, contraparte=cp, detalle=detalle,
                )
            )

        # 1) IVA cero sobre neto gravado (no clase C, sin exento/no gravado que lo justifique).
        if not es_c and neto > 0 and iva == 0 and exento == 0 and no_grav == 0:
            _add("iva_cero", "aviso",
                 "Tiene neto gravado pero el IVA figura en cero. Revisá la alícuota.")
        # 2) Alícuota efectiva no estándar (sólo comprobantes de una sola alícuota).
        elif neto > 0 and iva > 0 and _n_alicuotas(c) <= 1 and not _rate_estandar(neto, iva):
            _add("alicuota_atipica", "datos",
                 f"La alícuota efectiva ({round(iva / neto * 100, 1)}%) no coincide con una oficial.")
        # 3) Compra con crédito fiscal de un proveedor sin CUIT válido.
        if lado == "compras" and iva > 0:
            doc = "".join(ch for ch in (c.doc_nro or "") if ch.isdigit())
            if len(doc) != 11:
                _add("compra_sin_cuit", "datos",
                     "Compra con crédito fiscal de un proveedor sin CUIT válido.")
    return out


@router.post("/clientes/{cuit}/importar-borrador")
async def importar_borrador(
    cuit: str,
    request: Request,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Importa el borrador del Libro IVA Digital de AFIP (ZIP o CSV, en el body crudo del POST) para
    traer las percepciones SEPARADAS por tipo (percepción IVA real, etc.) que Mis Comprobantes no da.
    Matchea por tipo/PV/número y las guarda en los comprobantes. Devuelve {actualizados, sin_match,
    total}. Body crudo (no multipart) para no depender de python-multipart."""
    _cliente_propio(db, cuit, usuario)
    contenido = await request.body()
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    return lid_import.importar(db, cuit, contenido)


@router.get("/clientes/{cuit}/inconsistencias", response_model=list[IvaInconsistenciaOut])
def inconsistencias(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_iva),
):
    """Revisiones sugeridas del período (posibles errores a chequear antes de declarar)."""
    _cliente_propio(db, cuit, usuario)
    # Sobre los valores ya corregidos (lo que el contador arregló deja de marcarse) y sin excluidos.
    return _detectar_inconsistencias(
        _efectivos_periodo(db, cuit, periodo, "emitido"), "ventas"
    ) + _detectar_inconsistencias(_efectivos_periodo(db, cuit, periodo, "recibido"), "compras")


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
    columna = "emitido" if direccion == "ventas" else "recibido"
    # Con las correcciones del contador aplicadas y sin los comprobantes excluidos.
    comps = _efectivos_periodo(db, cuit, periodo, columna)
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
