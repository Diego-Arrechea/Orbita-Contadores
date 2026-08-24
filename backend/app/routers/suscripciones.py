"""Suscripciones: el apartado "Mi suscripción" del contador + la gestión desde el panel superadmin.

Dos routers en el mismo archivo porque comparten toda la lógica de armado:
  • `/api/suscripcion`        — sólo lectura, para la cuenta logueada. Exige cuenta PLENA (la
                                suscripción es del estudio, no de cada usuario del equipo) Y el
                                gate `usuario_puede_suscripcion`: HOY los contadores todavía NO
                                ven este apartado; sólo los admins y las sesiones impersonadas
                                por un admin (para mirar la pantalla como la vería el contador).
  • `/api/admin/suscripciones` — listado, edición y cobranza manual (sólo rol=admin).

Hoy la suscripción NO corta el servicio: vencer cambia el estado que se muestra, nada más. Ver
services/suscripciones.py.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import (
    AdminSuscripcionDetalleOut,
    AdminSuscripcionOut,
    AdminSuscripcionesOut,
    AdminSuscripcionesResumen,
    AdminSuscripcionPatch,
    CatalogoPlanesOut,
    FuncionPlanOut,
    PagoSuscripcionIn,
    PagoSuscripcionOut,
    PlanOut,
    SuscripcionOut,
)
from ..security import (
    admin_actual,
    titular_actual,
    usuario_puede_suscripcion,
)
from ..services import suscripciones as svc
from .admin import _iso, _conteos_cartera, _registrar

router = APIRouter(prefix="/api/suscripcion", tags=["suscripcion"])
router_admin = APIRouter(
    prefix="/api/admin/suscripciones", tags=["admin"], dependencies=[Depends(admin_actual)]
)


def _transitoria(usuario: models.Usuario) -> models.Suscripcion:
    """Suscripción por defecto EN MEMORIA (no se guarda) para las cuentas que todavía no tienen una.
    Sirve para que los listados de sólo lectura no escriban en la base."""
    return models.Suscripcion(
        usuario_id=usuario.id,
        plan=svc.PLAN_DEFAULT,
        estado="sin_cargo",
        ciclo="mensual",
        inicio=usuario.creado_en.date().isoformat() if usuario.creado_en else None,
    )


def _pago_out(p: models.PagoSuscripcion) -> PagoSuscripcionOut:
    return PagoSuscripcionOut(
        id=p.id,
        fecha=p.fecha,
        importe=float(p.importe or 0),
        medio=p.medio,
        periodo_desde=p.periodo_desde,
        periodo_hasta=p.periodo_hasta,
        referencia=p.referencia,
        notas=p.notas,
        registrado_por=p.registrado_por or "",
    )


def _fila_admin(
    sus: models.Suscripcion,
    usuario: models.Usuario,
    clientes: int,
    ultimo_pago: str | None = None,
    total_pagado: float = 0.0,
) -> AdminSuscripcionOut:
    return AdminSuscripcionOut(
        usuario_id=usuario.id,
        email=usuario.email,
        nombre=usuario.nombre,
        apellido=usuario.apellido,
        estudio=usuario.estudio,
        activo=bool(usuario.activo),
        creado_en=_iso(usuario.creado_en),
        ultimo_acceso=_iso(usuario.ultimo_acceso),
        plan=sus.plan,
        plan_nombre=svc.plan_de(sus)["nombre"],
        estado=svc.estado_efectivo(sus),
        estado_guardado=sus.estado,
        ciclo=sus.ciclo,
        precio=svc.precio_efectivo(sus),
        precio_personalizado=sus.precio is not None,
        inicio=sus.inicio,
        vence=sus.vence,
        dias_restantes=svc.dias_restantes(sus),
        limite_clientes=svc.limite_efectivo(sus),
        clientes=clientes,
        ultimo_pago=ultimo_pago,
        total_pagado=total_pagado,
        notas=sus.notas,
    )


# ── "Mi suscripción" (sólo lectura) ───────────────────────────────────────────


def _acceso_apartado(usuario: models.Usuario = Depends(titular_actual)) -> models.Usuario:
    """Quién puede abrir el apartado: una cuenta PLENA que además pase el gate (admin o sesión
    impersonada por un admin). Mientras el apartado no esté abierto a los contadores, a ellos les
    responde 403 aunque tengan sesión válida."""
    if not usuario_puede_suscripcion(usuario):
        raise HTTPException(
            status_code=403, detail="No tenés habilitado el apartado de suscripción."
        )
    return usuario


@router.get("/planes", response_model=CatalogoPlanesOut)
def catalogo_planes(_: models.Usuario = Depends(_acceso_apartado)):
    """Los planes disponibles y el universo de funciones, para la comparativa del apartado. Detrás
    del mismo gate: la lista de precios no es pública ni se les muestra todavía a los contadores."""
    return CatalogoPlanesOut(
        planes=[
            PlanOut(
                clave=clave,
                nombre=datos["nombre"],
                precio=datos["precio"],
                limite_clientes=datos["limite_clientes"],
                descripcion=datos["descripcion"],
                funciones=list(datos["funciones"]),
            )
            for clave, datos in svc.PLANES.items()
        ],
        funciones=[FuncionPlanOut(**f) for f in svc.FUNCIONES],
    )


@router.get("", response_model=SuscripcionOut)
def mi_suscripcion(
    db: Session = Depends(get_db), titular: models.Usuario = Depends(_acceso_apartado)
):
    """El plan del estudio, hasta cuándo está al día y los pagos registrados."""
    sus = svc.obtener_o_crear(db, titular)
    return SuscripcionOut(
        plan=sus.plan,
        plan_nombre=svc.plan_de(sus)["nombre"],
        plan_descripcion=svc.plan_de(sus)["descripcion"],
        estado=svc.estado_efectivo(sus),
        ciclo=sus.ciclo,
        precio=svc.precio_efectivo(sus),
        inicio=sus.inicio,
        vence=sus.vence,
        dias_restantes=svc.dias_restantes(sus),
        al_dia=svc.al_dia(sus),
        limite_clientes=svc.limite_efectivo(sus),
        clientes_en_uso=svc.clientes_de_la_cuenta(db, titular.id),
        pagos=[_pago_out(p) for p in svc.pagos_de(db, sus)],
    )


# ── Panel admin: gestión de todas las suscripciones ───────────────────────────


def _cuenta_plena(db: Session, usuario_id: int) -> models.Usuario:
    """El usuario, sólo si es una cuenta PLENA (los empleados no tienen suscripción propia)."""
    usuario = db.get(models.Usuario, usuario_id)
    if usuario is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    if usuario.titular_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Esta cuenta es un usuario del estudio: la suscripción se maneja en la del titular",
        )
    return usuario


@router_admin.get("", response_model=AdminSuscripcionesOut)
def listar_suscripciones(db: Session = Depends(get_db)):
    """Todas las cuentas plenas con su estado comercial + los totales de la cartera."""
    usuarios = db.scalars(
        select(models.Usuario)
        .where(models.Usuario.titular_id.is_(None))
        .order_by(models.Usuario.creado_en.desc())
    ).all()
    suscripciones = {
        s.usuario_id: s for s in db.scalars(select(models.Suscripcion)).all()
    }
    clientes = _conteos_cartera(db)

    # Resumen de pagos por suscripción (último y acumulado) en una sola consulta.
    pagos = {
        fila[0]: (fila[1], float(fila[2] or 0))
        for fila in db.execute(
            select(
                models.PagoSuscripcion.suscripcion_id,
                func.max(models.PagoSuscripcion.fecha),
                func.sum(models.PagoSuscripcion.importe),
            ).group_by(models.PagoSuscripcion.suscripcion_id)
        ).all()
    }
    desde_30d = (dt.date.today() - dt.timedelta(days=30)).isoformat()
    cobrado_30d = float(
        db.scalar(
            select(func.sum(models.PagoSuscripcion.importe)).where(
                models.PagoSuscripcion.fecha >= desde_30d
            )
        )
        or 0
    )

    items: list[AdminSuscripcionOut] = []
    for u in usuarios:
        sus = suscripciones.get(u.id) or _transitoria(u)
        ultimo, total = pagos.get(sus.id, (None, 0.0)) if sus.id else (None, 0.0)
        items.append(_fila_admin(sus, u, clientes.get(u.id, 0), ultimo, total))

    por_estado = {e: 0 for e in svc.ESTADOS}
    for it in items:
        por_estado[it.estado] = por_estado.get(it.estado, 0) + 1
    # Ingreso mensualizado: lo que factura hoy la cartera que está pagando (anual /12).
    ingreso = sum(
        (it.precio / 12 if it.ciclo == "anual" else it.precio)
        for it in items
        if it.estado in ("activa", "prueba")
    )
    resumen = AdminSuscripcionesResumen(
        cuentas=len(items),
        activas=por_estado.get("activa", 0),
        en_prueba=por_estado.get("prueba", 0),
        vencidas=por_estado.get("vencida", 0),
        canceladas=por_estado.get("cancelada", 0),
        sin_cargo=por_estado.get("sin_cargo", 0),
        ingreso_mensual=round(ingreso, 2),
        cobrado_30d=round(cobrado_30d, 2),
        por_vencer_30d=sum(
            1
            for it in items
            if it.estado == "activa" and it.dias_restantes is not None and 0 <= it.dias_restantes <= 30
        ),
    )
    return AdminSuscripcionesOut(resumen=resumen, items=items)


@router_admin.get("/{usuario_id}", response_model=AdminSuscripcionDetalleOut)
def detalle_suscripcion(usuario_id: int, db: Session = Depends(get_db)):
    """La suscripción de una cuenta con todo su historial de pagos."""
    usuario = _cuenta_plena(db, usuario_id)
    sus = svc.obtener_o_crear(db, usuario)
    conteos = _conteos_cartera(db)
    pagos = svc.pagos_de(db, sus)
    total = sum(float(p.importe or 0) for p in pagos)
    return AdminSuscripcionDetalleOut(
        suscripcion=_fila_admin(
            sus,
            usuario,
            conteos.get(usuario.id, 0),
            pagos[0].fecha if pagos else None,
            total,
        ),
        pagos=[_pago_out(p) for p in pagos],
    )


@router_admin.patch("/{usuario_id}", response_model=AdminSuscripcionOut)
def editar_suscripcion(
    usuario_id: int,
    cambios: AdminSuscripcionPatch,
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(admin_actual),
):
    """Cambia el plan, el estado, el precio o el vencimiento de una cuenta. PATCH parcial: sólo se
    tocan los campos que vienen (mandar `precio: null` no borra el acuerdo; para volver al de lista
    hay que mandar `precio: 0` y limpiarlo desde el panel)."""
    usuario = _cuenta_plena(db, usuario_id)
    sus = svc.obtener_o_crear(db, usuario)
    datos = cambios.model_dump(exclude_unset=True)

    if "plan" in datos:
        if datos["plan"] not in svc.PLANES:
            raise HTTPException(status_code=400, detail="Plan desconocido")
        sus.plan = datos["plan"]
    if "estado" in datos:
        if datos["estado"] not in svc.ESTADOS:
            raise HTTPException(status_code=400, detail="Estado desconocido")
        sus.estado = datos["estado"]
        sus.cancelada_en = (
            dt.date.today().isoformat() if datos["estado"] == "cancelada" else None
        )
    if "ciclo" in datos:
        if datos["ciclo"] not in svc.CICLOS:
            raise HTTPException(status_code=400, detail="Ciclo desconocido")
        sus.ciclo = datos["ciclo"]
    if "precio" in datos:
        # precio None = vuelve al de lista del plan.
        sus.precio = datos["precio"]
    if "limite_clientes" in datos:
        sus.limite_clientes = datos["limite_clientes"]
    if "inicio" in datos:
        sus.inicio = datos["inicio"] or None
    if "vence" in datos:
        sus.vence = datos["vence"] or None
    if "notas" in datos:
        sus.notas = datos["notas"] or None

    sus.actualizada_en = dt.datetime.now(dt.timezone.utc)
    _registrar(
        db,
        admin,
        "suscripcion_editada",
        usuario,
        ", ".join(f"{k}={v}" for k, v in datos.items()) or None,
    )
    db.commit()
    db.refresh(sus)
    conteos = _conteos_cartera(db)
    pagos = svc.pagos_de(db, sus)
    return _fila_admin(
        sus,
        usuario,
        conteos.get(usuario.id, 0),
        pagos[0].fecha if pagos else None,
        sum(float(p.importe or 0) for p in pagos),
    )


@router_admin.post("/{usuario_id}/pagos", response_model=AdminSuscripcionDetalleOut)
def registrar_pago(
    usuario_id: int,
    datos: PagoSuscripcionIn,
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(admin_actual),
):
    """Registra un cobro. Corre el vencimiento un ciclo (o hasta la fecha que se indique) y deja la
    suscripción activa."""
    usuario = _cuenta_plena(db, usuario_id)
    sus = svc.obtener_o_crear(db, usuario)
    svc.registrar_pago(
        db,
        sus,
        fecha=datos.fecha,
        importe=datos.importe,
        medio=datos.medio,
        periodo_desde=datos.periodo_desde,
        periodo_hasta=datos.periodo_hasta,
        referencia=datos.referencia,
        notas=datos.notas,
        registrado_por=admin.email,
    )
    _registrar(
        db,
        admin,
        "suscripcion_pago",
        usuario,
        f"${datos.importe:,.0f} ({datos.medio}) — vence {sus.vence}",
    )
    db.commit()
    return detalle_suscripcion(usuario_id, db)


@router_admin.delete("/{usuario_id}/pagos/{pago_id}", response_model=AdminSuscripcionDetalleOut)
def borrar_pago(
    usuario_id: int,
    pago_id: int,
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(admin_actual),
):
    """Borra un pago mal cargado. NO retrocede el vencimiento (se corrige a mano si hace falta):
    así un typo en el importe no le corta el acceso a nadie por accidente."""
    usuario = _cuenta_plena(db, usuario_id)
    sus = svc.obtener_o_crear(db, usuario)
    pago = db.get(models.PagoSuscripcion, pago_id)
    if pago is None or pago.suscripcion_id != sus.id:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    _registrar(db, admin, "suscripcion_pago_borrado", usuario, f"${float(pago.importe or 0):,.0f} del {pago.fecha}")
    db.delete(pago)
    db.commit()
    return detalle_suscripcion(usuario_id, db)
