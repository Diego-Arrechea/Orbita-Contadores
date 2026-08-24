"""Apartado de Contabilidad (plan de cuentas + libro diario). GATEADO: sólo las cuentas habilitadas
(allowlist CONTABILIDAD_EMAILS + admins) llegan acá — la dependencia `usuario_contabilidad` cierra
todos los endpoints por detrás del gate del front. Multi-tenant: cada contador opera únicamente
sobre sus propios clientes (`_cliente_propio`).

El plan de cuentas es POR CLIENTE (se siembra la plantilla estándar o se importa el que el estudio ya
usa) y el libro diario se DERIVA de los comprobantes que la app ya tiene: no se persiste, se recalcula.
Lo que sí se guarda son las decisiones del contador — la cuenta que le fija a un comprobante, las
reglas que memoriza por contraparte y los asientos que carga a mano. Los informes (mayor / sumas y
saldos) salen del mismo cálculo, sobre el rango de fechas que elija el contador, igual que los
estados contables. Cerrar un período congela sus asientos y guarda sus saldos. Ver
services/contabilidad.py.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import (
    AsientoManualIn,
    CierreOut,
    CuentaIn,
    CuentaOut,
    DiarioOut,
    EstadosOut,
    ImputacionIn,
    IvaPeriodoOut,
    MayorOut,
    PlanImportarIn,
    ReglaOut,
    SumasSaldosOut,
)
from ..security import usuario_contabilidad
from ..services import contabilidad
from .clientes import _cliente_propio

router = APIRouter(prefix="/api/contabilidad", tags=["contabilidad"])


def _cuenta_out(cuenta: models.CuentaContable) -> CuentaOut:
    return CuentaOut(
        id=cuenta.id,
        codigo=cuenta.codigo,
        nombre=cuenta.nombre,
        tipo=cuenta.tipo,
        imputable=bool(cuenta.imputable),
    )


def _cuenta_del_cliente(db: Session, cuit: str, cuenta_id: int) -> models.CuentaContable:
    """La cuenta sólo si pertenece al plan de ESE cliente (si no, 404: no se toca el plan ajeno)."""
    cuenta = db.get(models.CuentaContable, cuenta_id)
    if cuenta is None or cuenta.cuit != cuit:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return cuenta


@router.get("/clientes/{cuit}/periodos", response_model=list[IvaPeriodoOut])
def periodos_cliente(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Meses con comprobantes del cliente, para el selector del diario. Misma forma que el selector
    del Libro IVA (se reusa el schema): período, etiqueta y cuántos comprobantes hay de cada lado."""
    _cliente_propio(db, cuit, usuario)
    return [IvaPeriodoOut(**p) for p in contabilidad.periodos_con_comprobantes(db, cuit)]


@router.get("/clientes/{cuit}/plan", response_model=list[CuentaOut])
def plan_de_cuentas(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Plan de cuentas del cliente (vacío si todavía no lo armó: el front ofrece sembrar o importar)."""
    _cliente_propio(db, cuit, usuario)
    return [_cuenta_out(c) for c in contabilidad.cuentas_de(db, cuit)]


@router.post("/clientes/{cuit}/plan/sembrar")
def sembrar_plan(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Crea el plan de cuentas sugerido en el cliente. Idempotente: agrega sólo lo que falta, así
    volver a apretarlo no pisa lo que el contador ya editó."""
    _cliente_propio(db, cuit, usuario)
    return {"creadas": contabilidad.sembrar_plan(db, cuit)}


@router.post("/clientes/{cuit}/plan/importar")
def importar_plan(
    cuit: str,
    datos: PlanImportarIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Importa el plan de cuentas que el estudio ya usa (el front parsea el Excel y manda las filas).
    Upsert por código: actualiza las que existen, crea las nuevas y no borra nada."""
    _cliente_propio(db, cuit, usuario)
    return contabilidad.importar_plan(db, cuit, datos.cuentas)


@router.post("/clientes/{cuit}/plan", response_model=CuentaOut)
def crear_cuenta(
    cuit: str,
    datos: CuentaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Agrega una cuenta al plan del cliente. 409 si ya existe una con ese código."""
    _cliente_propio(db, cuit, usuario)
    cta = models.CuentaContable
    existe = db.scalar(select(cta).where(cta.cuit == cuit, cta.codigo == datos.codigo))
    if existe is not None:
        raise HTTPException(status_code=409, detail=f"Ya existe una cuenta con el código {datos.codigo}.")
    cuenta = models.CuentaContable(
        cuit=cuit, codigo=datos.codigo, nombre=datos.nombre,
        tipo=datos.tipo, imputable=datos.imputable,
    )
    db.add(cuenta)
    db.commit()
    db.refresh(cuenta)
    return _cuenta_out(cuenta)


@router.patch("/clientes/{cuit}/plan/{cuenta_id}", response_model=CuentaOut)
def editar_cuenta(
    cuit: str,
    cuenta_id: int,
    datos: CuentaIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Edita una cuenta del plan (código, nombre, tipo, si es imputable). 409 si el código nuevo ya
    lo usa otra cuenta del mismo cliente."""
    _cliente_propio(db, cuit, usuario)
    cuenta = _cuenta_del_cliente(db, cuit, cuenta_id)
    if datos.codigo != cuenta.codigo:
        cta = models.CuentaContable
        choca = db.scalar(select(cta).where(cta.cuit == cuit, cta.codigo == datos.codigo))
        if choca is not None:
            raise HTTPException(
                status_code=409, detail=f"Ya existe una cuenta con el código {datos.codigo}."
            )
    cuenta.codigo = datos.codigo
    cuenta.nombre = datos.nombre
    cuenta.tipo = datos.tipo
    cuenta.imputable = datos.imputable
    db.commit()
    db.refresh(cuenta)
    return _cuenta_out(cuenta)


@router.delete("/clientes/{cuit}/plan/{cuenta_id}")
def borrar_cuenta(
    cuit: str,
    cuenta_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Borra una cuenta del plan. No se pueden borrar las que usa el asiento automático (quedaría sin
    dónde imputar) ni las que ya tengan movimientos: una regla, un comprobante imputado a mano o un
    renglón de un asiento manual (además, en Postgres la FK ni siquiera lo permitiría)."""
    _cliente_propio(db, cuit, usuario)
    cuenta = _cuenta_del_cliente(db, cuit, cuenta_id)
    if cuenta.codigo in contabilidad.CUENTAS_SISTEMA:
        raise HTTPException(
            status_code=409,
            detail="Esta cuenta la usan los asientos automáticos: podés renombrarla, pero no borrarla.",
        )
    en_uso = (
        db.scalar(select(models.ReglaImputacion).where(
            models.ReglaImputacion.cuenta_id == cuenta.id))
        or db.scalar(select(models.ImputacionComprobante).where(
            models.ImputacionComprobante.cuenta_id == cuenta.id))
        or db.scalar(select(models.LineaAsientoManual).where(
            models.LineaAsientoManual.cuenta_id == cuenta.id))
    )
    if en_uso is not None:
        raise HTTPException(
            status_code=409, detail="Hay movimientos registrados en esta cuenta."
        )
    db.delete(cuenta)
    db.commit()
    return {"ok": True}


@router.get("/clientes/{cuit}/diario", response_model=DiarioOut)
def libro_diario(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Libro diario del período: un asiento por comprobante, armado con el plan del cliente."""
    _cliente_propio(db, cuit, usuario)
    return DiarioOut(**contabilidad.diario(db, cuit, periodo))


@router.put("/clientes/{cuit}/imputaciones")
def imputar(
    cuit: str,
    datos: ImputacionIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Cambia la cuenta con la que se registra un comprobante. Con `recordar`, deja además la regla
    para que los próximos de esa contraparte se imputen solos igual."""
    _cliente_propio(db, cuit, usuario)
    try:
        return contabilidad.guardar_imputacion(
            db, cuit, datos.comprobanteId, datos.cuentaId, usuario.email, datos.recordar
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/clientes/{cuit}/imputaciones/{comprobante_id}")
def quitar_imputacion(
    cuit: str,
    comprobante_id: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Vuelve el comprobante a la cuenta que le corresponde por regla (o a la sugerida)."""
    _cliente_propio(db, cuit, usuario)
    return contabilidad.borrar_imputacion(db, cuit, comprobante_id)


@router.get("/clientes/{cuit}/reglas", response_model=list[ReglaOut])
def reglas(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Las imputaciones automáticas que el contador fue guardando para este cliente."""
    _cliente_propio(db, cuit, usuario)
    return [ReglaOut(**r) for r in contabilidad.reglas_de(db, cuit)]


@router.delete("/clientes/{cuit}/reglas/{regla_id}")
def quitar_regla(
    cuit: str,
    regla_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Borra una imputación automática: los comprobantes de esa contraparte vuelven a la cuenta
    sugerida (lo ya imputado a mano queda como está)."""
    _cliente_propio(db, cuit, usuario)
    if not contabilidad.borrar_regla(db, cuit, regla_id):
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    return {"ok": True}


@router.post("/clientes/{cuit}/asientos")
def crear_asiento(
    cuit: str,
    datos: AsientoManualIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Carga un asiento a mano (lo que no sale de un comprobante: cobros, pagos, amortizaciones,
    ajustes). El schema ya validó que cierre; acá se valida que las cuentas sean del cliente."""
    _cliente_propio(db, cuit, usuario)
    try:
        return {"id": contabilidad.crear_asiento_manual(db, cuit, datos, usuario.email)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/clientes/{cuit}/asientos/{asiento_id}")
def borrar_asiento(
    cuit: str,
    asiento_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Borra un asiento manual con sus renglones."""
    _cliente_propio(db, cuit, usuario)
    if not contabilidad.borrar_asiento_manual(db, cuit, asiento_id):
        raise HTTPException(status_code=404, detail="Asiento no encontrado")
    return {"ok": True}


@router.get("/clientes/{cuit}/mayor", response_model=MayorOut)
def libro_mayor(
    cuit: str,
    cuenta: str = Query(..., min_length=1, max_length=20, description="código de la cuenta"),
    desde: dt.date = Query(..., description="aaaa-mm-dd"),
    hasta: dt.date = Query(..., description="aaaa-mm-dd, inclusive"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Mayor de una cuenta entre dos fechas: arranca del saldo anterior y arrastra el saldo
    movimiento por movimiento."""
    _cliente_propio(db, cuit, usuario)
    if hasta < desde:
        raise HTTPException(status_code=422, detail="La fecha de fin es anterior a la de inicio.")
    try:
        return MayorOut(**contabilidad.mayor(db, cuit, cuenta, desde, hasta))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/clientes/{cuit}/sumas-y-saldos", response_model=SumasSaldosOut)
def sumas_y_saldos(
    cuit: str,
    desde: dt.date = Query(..., description="aaaa-mm-dd"),
    hasta: dt.date = Query(..., description="aaaa-mm-dd, inclusive"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Balance de sumas y saldos del rango: una fila por cuenta con movimientos (o con saldo que
    viene de antes) y los totales de cada columna."""
    _cliente_propio(db, cuit, usuario)
    if hasta < desde:
        raise HTTPException(status_code=422, detail="La fecha de fin es anterior a la de inicio.")
    return SumasSaldosOut(**contabilidad.sumas_y_saldos(db, cuit, desde, hasta))


@router.get("/clientes/{cuit}/cierres", response_model=list[CierreOut])
def listar_cierres(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Períodos ya cerrados del cliente."""
    _cliente_propio(db, cuit, usuario)
    return [
        CierreOut(
            periodo=c.periodo,
            label=contabilidad.label_periodo(c.periodo),
            asientos=c.asientos or 0,
            debe=float(c.debe or 0),
            haber=float(c.haber or 0),
            cerradoPor=c.cerrado_por or "",
            cerradoEn=c.cerrado_en.isoformat() if c.cerrado_en else None,
        )
        for c in contabilidad.cierres_de(db, cuit)
    ]


@router.post("/clientes/{cuit}/cierres")
def cerrar_periodo(
    cuit: str,
    periodo: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="aaaa-mm"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Cierra el período: sus asientos quedan quietos y sus saldos, guardados. Volver a cerrarlo
    actualiza la foto (sirve cuando entraron movimientos con fecha vieja)."""
    _cliente_propio(db, cuit, usuario)
    try:
        return contabilidad.cerrar_periodo(db, cuit, periodo, usuario.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/clientes/{cuit}/cierres/{periodo}")
def reabrir_periodo(
    cuit: str,
    periodo: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Reabre un período cerrado para poder volver a tocarlo."""
    _cliente_propio(db, cuit, usuario)
    if not contabilidad.reabrir_periodo(db, cuit, periodo):
        raise HTTPException(status_code=404, detail="Ese período no está cerrado.")
    return {"ok": True}


@router.get("/clientes/{cuit}/estados", response_model=EstadosOut)
def estados_contables(
    cuit: str,
    desde: dt.date = Query(..., description="aaaa-mm-dd"),
    hasta: dt.date = Query(..., description="aaaa-mm-dd, inclusive"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_contabilidad),
):
    """Estado de resultados del rango y situación patrimonial a la fecha de cierre del rango."""
    _cliente_propio(db, cuit, usuario)
    if hasta < desde:
        raise HTTPException(status_code=422, detail="La fecha de fin es anterior a la de inicio.")
    return EstadosOut(**contabilidad.estados(db, cuit, desde, hasta))
