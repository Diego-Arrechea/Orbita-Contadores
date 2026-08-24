"""Apartado de Contabilidad (plan de cuentas + libro diario). GATEADO: sólo las cuentas habilitadas
(allowlist CONTABILIDAD_EMAILS + admins) llegan acá — la dependencia `usuario_contabilidad` cierra
todos los endpoints por detrás del gate del front. Multi-tenant: cada contador opera únicamente
sobre sus propios clientes (`_cliente_propio`).

Primera rebanada: el plan de cuentas es POR CLIENTE (se siembra la plantilla estándar o se importa el
que el estudio ya usa) y el libro diario se DERIVA de los comprobantes que la app ya tiene. La
edición puntual de imputaciones, los asientos manuales y los informes (mayor / sumas y saldos) van en
las rebanadas siguientes. Ver services/contabilidad.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import (
    CuentaIn,
    CuentaOut,
    DiarioOut,
    IvaPeriodoOut,
    PlanImportarIn,
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
    dónde imputar) ni las que tengan una regla de imputación apuntándoles."""
    _cliente_propio(db, cuit, usuario)
    cuenta = _cuenta_del_cliente(db, cuit, cuenta_id)
    if cuenta.codigo in contabilidad.CUENTAS_SISTEMA:
        raise HTTPException(
            status_code=409,
            detail="Esta cuenta la usan los asientos automáticos: podés renombrarla, pero no borrarla.",
        )
    regla = models.ReglaImputacion
    usada = db.scalar(select(regla).where(regla.cuenta_id == cuenta.id))
    if usada is not None:
        raise HTTPException(
            status_code=409, detail="Hay comprobantes que se imputan a esta cuenta."
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
