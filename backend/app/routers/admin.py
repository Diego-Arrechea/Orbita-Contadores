"""Panel superadmin (sólo rol=admin). Gestiona TODAS las cuentas de contadores: listado con
métricas de uso, activar/desactivar, cambiar rol, impersonar (entrar como) y un log de auditoría.
Todo el router está protegido por `admin_actual`."""
from __future__ import annotations

import datetime as dt
import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import (
    AdminAuditoriaOut,
    AdminMetricasOut,
    AdminSyncFallidaOut,
    AdminUsuarioOut,
    AdminUsuarioPatch,
    ImpersonarOut,
    JobIdOut,
    UsuarioOut,
)
from ..scraping import jobs
from ..security import admin_actual, crear_token
from .clientes import _correr_sync

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(admin_actual)])


def _iso(d: dt.datetime | None) -> str | None:
    return d.isoformat() if d else None


def _usuario_out(u: models.Usuario) -> UsuarioOut:
    return UsuarioOut(
        id=u.id,
        nombre=u.nombre,
        apellido=u.apellido,
        email=u.email,
        telefono=u.telefono,
        dni=u.dni,
        cuit=u.cuit,
        estudio=u.estudio,
        matricula=u.matricula,
        rol=u.rol,
    )


def _admin_usuario_out(u: models.Usuario, clientes: int) -> AdminUsuarioOut:
    return AdminUsuarioOut(
        id=u.id,
        nombre=u.nombre,
        apellido=u.apellido,
        email=u.email,
        telefono=u.telefono,
        cuit=u.cuit,
        estudio=u.estudio,
        matricula=u.matricula,
        rol=u.rol,
        activo=u.activo,
        creado_en=_iso(u.creado_en),
        ultimo_acceso=_iso(u.ultimo_acceso),
        clientes=clientes,
    )


def _registrar(
    db: Session,
    admin: models.Usuario,
    accion: str,
    target: models.Usuario | None,
    detalle: str | None = None,
) -> None:
    """Anota una acción en la bitácora de auditoría (no hace commit: lo hace el caller)."""
    db.add(
        models.AuditoriaAdmin(
            admin_id=admin.id,
            admin_email=admin.email,
            accion=accion,
            target_id=target.id if target else None,
            target_email=target.email if target else "",
            detalle=detalle,
        )
    )


@router.get("/usuarios", response_model=list[AdminUsuarioOut])
def listar_usuarios(db: Session = Depends(get_db)):
    """Todas las cuentas con su Nº de clientes cargados (más nuevas primero)."""
    # Conteo de clientes por usuario en una sola query (evita N+1).
    conteos = dict(
        db.execute(
            select(models.ClienteARCA.usuario_id, func.count())
            .where(models.ClienteARCA.usuario_id.is_not(None))
            .group_by(models.ClienteARCA.usuario_id)
        ).all()
    )
    usuarios = db.scalars(
        select(models.Usuario).order_by(models.Usuario.creado_en.desc())
    ).all()
    return [_admin_usuario_out(u, conteos.get(u.id, 0)) for u in usuarios]


@router.get("/metricas", response_model=AdminMetricasOut)
def metricas(db: Session = Depends(get_db)):
    """Resumen global para el dashboard del panel."""
    total = db.scalar(select(func.count()).select_from(models.Usuario)) or 0
    activas = (
        db.scalar(select(func.count()).where(models.Usuario.activo.is_(True))) or 0
    )
    admins = db.scalar(select(func.count()).where(models.Usuario.rol == "admin")) or 0
    total_clientes = db.scalar(select(func.count()).select_from(models.ClienteARCA)) or 0

    ahora = dt.datetime.now(dt.timezone.utc)
    inicio_dia = ahora.replace(hour=0, minute=0, second=0, microsecond=0)
    hace_semana = ahora - dt.timedelta(days=7)
    syncs_hoy = (
        db.scalar(select(func.count()).where(models.Extraccion.fecha >= inicio_dia)) or 0
    )
    # "Con problemas" = clientes que fallaron hoy y NO se recuperaron después (sin una sync exitosa
    # posterior a su última falla). Cuenta SÓLO las no resueltas: un reintento/diagnóstico que dejó
    # fallas pero terminó bien no infla el número. (El detalle por fila va en /sincronizaciones/fallidas.)
    fallidas_hoy = dict(
        db.execute(
            select(models.Extraccion.cuit, func.max(models.Extraccion.fecha))
            .where(
                models.Extraccion.fecha >= inicio_dia,
                models.Extraccion.resultado == "fallida",
            )
            .group_by(models.Extraccion.cuit)
        ).all()
    )
    exitosas = (
        dict(
            db.execute(
                select(models.Extraccion.cuit, func.max(models.Extraccion.fecha))
                .where(
                    models.Extraccion.resultado == "exitosa",
                    models.Extraccion.cuit.in_(fallidas_hoy.keys()),
                )
                .group_by(models.Extraccion.cuit)
            ).all()
        )
        if fallidas_hoy
        else {}
    )
    syncs_fallidas = sum(
        1
        for cuit, falla in fallidas_hoy.items()
        if not (exitosas.get(cuit) and exitosas[cuit] > falla)
    )
    nuevas_semana = (
        db.scalar(select(func.count()).where(models.Usuario.creado_en >= hace_semana)) or 0
    )
    return AdminMetricasOut(
        total_cuentas=total,
        cuentas_activas=activas,
        cuentas_inactivas=total - activas,
        total_admins=admins,
        total_clientes=total_clientes,
        syncs_hoy=syncs_hoy,
        syncs_fallidas_hoy=syncs_fallidas,
        nuevas_cuentas_semana=nuevas_semana,
    )


@router.get("/sincronizaciones/fallidas", response_model=list[AdminSyncFallidaOut])
def sincronizaciones_fallidas(db: Session = Depends(get_db), limite: int = 50):
    """Últimas sincronizaciones fallidas (vista de ops) con el motivo técnico crudo, el cliente
    afectado, su contador y si el cliente ya se sincronizó bien DESPUÉS (estado actual)."""
    filas = db.execute(
        select(
            models.Extraccion,
            models.ClienteARCA.nombre,
            models.Usuario.email,
        )
        .outerjoin(models.ClienteARCA, models.ClienteARCA.cuit == models.Extraccion.cuit)
        .outerjoin(models.Usuario, models.Usuario.id == models.ClienteARCA.usuario_id)
        .where(models.Extraccion.resultado == "fallida")
        .order_by(models.Extraccion.fecha.desc())
        .limit(min(limite, 200))
    ).all()

    # Para resolver "¿se sincronizó bien después?": última extracción EXITOSA por cuit (una query).
    cuits = {e.cuit for e, _, _ in filas}
    ultima_ok: dict[str, dt.datetime] = {}
    if cuits:
        ultima_ok = dict(
            db.execute(
                select(models.Extraccion.cuit, func.max(models.Extraccion.fecha))
                .where(
                    models.Extraccion.cuit.in_(cuits),
                    models.Extraccion.resultado == "exitosa",
                )
                .group_by(models.Extraccion.cuit)
            ).all()
        )

    out = []
    for e, nombre, email in filas:
        ok_fecha = ultima_ok.get(e.cuit)
        out.append(
            AdminSyncFallidaOut(
                fecha=_iso(e.fecha) or "",
                cuit=e.cuit,
                cliente=nombre,
                contador_email=email,
                motivo=e.motivo,
                duracion_ms=e.duracion_ms,
                # Resuelto si hay una sync exitosa POSTERIOR a esta falla puntual.
                resuelto=ok_fecha is not None and ok_fecha > e.fecha,
                ultima_sync_ok=_iso(ok_fecha),
            )
        )
    return out


@router.post("/clientes/{cuit}/reintentar-sync", response_model=JobIdOut)
def reintentar_sync(
    cuit: str,
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(admin_actual),
):
    """Dispara, en background, un nuevo intento de sincronización de un cliente (cualquiera, sin
    importar de qué contador sea). Devuelve un job_id para seguir el progreso por
    GET /api/sincronizaciones/{job_id}. Reusa el mismo worker que la sync manual del contador."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise HTTPException(status_code=404, detail="Cliente no encontrado.")
    job_id = jobs.crear_job()
    threading.Thread(target=_correr_sync, args=(job_id, cuit), daemon=True).start()
    _registrar(db, admin, "reintentar_sync", None, f"{cliente.nombre or cuit} ({cuit})")
    db.commit()
    return JobIdOut(job_id=job_id)


@router.patch("/usuarios/{usuario_id}", response_model=AdminUsuarioOut)
def editar_usuario(
    usuario_id: int,
    cambios: AdminUsuarioPatch,
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(admin_actual),
):
    """Activa/desactiva una cuenta o le cambia el rol. No te podés desactivar ni quitarte el rol
    de admin a vos mismo (evita quedarte afuera del panel)."""
    target = db.get(models.Usuario, usuario_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada.")

    es_uno_mismo = target.id == admin.id

    if cambios.activo is not None and cambios.activo != target.activo:
        if es_uno_mismo and not cambios.activo:
            raise HTTPException(status_code=400, detail="No podés desactivar tu propia cuenta.")
        target.activo = cambios.activo
        _registrar(db, admin, "activar" if cambios.activo else "desactivar", target)

    if cambios.rol is not None and cambios.rol != target.rol:
        if cambios.rol not in ("contador", "admin"):
            raise HTTPException(status_code=400, detail="Rol inválido.")
        if es_uno_mismo and cambios.rol != "admin":
            raise HTTPException(status_code=400, detail="No podés quitarte el rol de admin.")
        anterior = target.rol
        target.rol = cambios.rol
        _registrar(db, admin, "cambiar_rol", target, f"{anterior} → {cambios.rol}")

    db.commit()
    db.refresh(target)
    clientes = (
        db.scalar(
            select(func.count()).where(models.ClienteARCA.usuario_id == target.id)
        )
        or 0
    )
    return _admin_usuario_out(target, clientes)


@router.post("/usuarios/{usuario_id}/impersonar", response_model=ImpersonarOut)
def impersonar(
    usuario_id: int,
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(admin_actual),
):
    """Devuelve un token de la cuenta indicada para entrar 'como' ese contador (soporte). Queda
    registrado en la auditoría. No se puede impersonar una cuenta inhabilitada."""
    target = db.get(models.Usuario, usuario_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada.")
    if not target.activo:
        raise HTTPException(
            status_code=400, detail="No se puede ingresar a una cuenta inhabilitada."
        )
    _registrar(db, admin, "impersonar", target)
    db.commit()
    return ImpersonarOut(token=crear_token(target.id), usuario=_usuario_out(target))


@router.get("/auditoria", response_model=list[AdminAuditoriaOut])
def auditoria(db: Session = Depends(get_db), limite: int = 200):
    """Últimas acciones del panel admin (más recientes primero)."""
    filas = db.scalars(
        select(models.AuditoriaAdmin)
        .order_by(models.AuditoriaAdmin.fecha.desc())
        .limit(min(limite, 500))
    ).all()
    return [
        AdminAuditoriaOut(
            id=f.id,
            admin_email=f.admin_email,
            accion=f.accion,
            target_email=f.target_email,
            detalle=f.detalle,
            fecha=_iso(f.fecha) or "",
        )
        for f in filas
    ]
