"""Panel superadmin (sólo rol=admin). Gestiona TODAS las cuentas de contadores: listado con
métricas de uso, activar/desactivar, cambiar rol, impersonar (entrar como) y un log de auditoría.
Todo el router está protegido por `admin_actual`."""
from __future__ import annotations

import datetime as dt
import json
import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import (
    AdminAuditoriaOut,
    AdminAvisoNombreOut,
    AdminClienteOut,
    AdminContadorFichaOut,
    AdminContadorResumen,
    AdminMetricasOut,
    AdminSyncFallidaOut,
    AdminUsuarioOut,
    AdminUsuarioPatch,
    ImpersonarOut,
    JobIdOut,
    ResetPasswordAdminOut,
    UsuarioOut,
)
from ..scraping import jobs
from ..security import (
    admin_actual,
    crear_token,
    es_empleado,
    generar_password_temporal,
    hashear_password,
    permisos_efectivos,
    usuario_puede_facturar,
)
from .clientes import _correr_sync, construir_cliente_out, datos_cartera

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(admin_actual)])


def _iso(d: dt.datetime | None) -> str | None:
    return d.isoformat() if d else None


def _usuario_out(u: models.Usuario) -> UsuarioOut:
    empleado = es_empleado(u)
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
        email_confirmado=bool(u.email_confirmado),
        facturacion_habilitada=usuario_puede_facturar(u),
        # Al impersonar a un empleado, el front necesita saberlo para restringirle la navegación
        # igual que en una sesión real del empleado.
        es_empleado=empleado,
        permisos=permisos_efectivos(u) if empleado else None,
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
        email_confirmado=bool(u.email_confirmado),
        creado_en=_iso(u.creado_en),
        ultimo_acceso=_iso(u.ultimo_acceso),
        ultimo_logout=_iso(u.ultimo_logout),
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
    confirmados = (
        db.scalar(select(func.count()).where(models.Usuario.email_confirmado.is_(True))) or 0
    )
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
        mails_confirmados=confirmados,
        total_admins=admins,
        total_clientes=total_clientes,
        syncs_hoy=syncs_hoy,
        syncs_fallidas_hoy=syncs_fallidas,
        nuevas_cuentas_semana=nuevas_semana,
    )


@router.get("/metricas/captcha")
def metricas_captcha(db: Session = Depends(get_db), dias: int = 30, limite: int = 100):
    """Métrica del captcha de ARCA en el login: cada vez que ARCA muestra el desafío de imagen a un
    CUIT se registra un evento (services/afip.py). Devuelve en cuántas CUENTAS DISTINTAS aparece y
    con qué frecuencia (para saber si pasa en cuentas puntuales o generalizado), cuántos resolvió
    CapSolver, y el desglose por cuenta."""
    ce = models.CaptchaEvento
    total_eventos = db.scalar(select(func.count()).select_from(ce)) or 0
    cuentas_distintas = db.scalar(select(func.count(func.distinct(ce.cuit)))) or 0
    resueltos = db.scalar(select(func.count()).where(ce.resuelto.is_(True))) or 0
    total_clientes = db.scalar(select(func.count()).select_from(models.ClienteARCA)) or 0

    desde = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=dias)
    eventos_periodo = db.scalar(select(func.count()).where(ce.fecha >= desde)) or 0
    cuentas_periodo = (
        db.scalar(select(func.count(func.distinct(ce.cuit))).where(ce.fecha >= desde)) or 0
    )

    # Desglose por cuenta: cuántas veces vio captcha, cuántas se resolvieron y la última fecha.
    filas = db.execute(
        select(
            ce.cuit,
            func.count().label("eventos"),
            func.sum(case((ce.resuelto.is_(True), 1), else_=0)).label("resueltos"),
            func.max(ce.fecha).label("ultima"),
        )
        .group_by(ce.cuit)
        .order_by(func.count().desc())
        .limit(limite)
    ).all()
    cuits = [f.cuit for f in filas]
    nombres = (
        dict(
            db.execute(
                select(models.ClienteARCA.cuit, models.ClienteARCA.nombre).where(
                    models.ClienteARCA.cuit.in_(cuits)
                )
            ).all()
        )
        if cuits
        else {}
    )
    por_cuit = [
        {
            "cuit": f.cuit,
            "nombre": nombres.get(f.cuit),
            "eventos": f.eventos,
            "resueltos": int(f.resueltos or 0),
            "ultima": f.ultima.isoformat() if f.ultima else None,
        }
        for f in filas
    ]
    return {
        "total_eventos": total_eventos,               # cuántas veces apareció el captcha (en general)
        "cuentas_distintas": cuentas_distintas,       # en cuántas cuentas DISTINTAS apareció
        "total_clientes": total_clientes,
        "pct_cuentas_afectadas": (
            round(100 * cuentas_distintas / total_clientes, 2) if total_clientes else 0.0
        ),
        "eventos_resueltos": resueltos,               # los que CapSolver pasó y el login entró
        "eventos_no_resueltos": total_eventos - resueltos,
        "dias_ventana": dias,
        "eventos_en_ventana": eventos_periodo,
        "cuentas_en_ventana": cuentas_periodo,
        "por_cuit": por_cuit,
    }


@router.get("/sincronizaciones/fallidas", response_model=list[AdminSyncFallidaOut])
def sincronizaciones_fallidas(db: Session = Depends(get_db), limite: int = 50):
    """Últimas sincronizaciones fallidas (vista de ops) con el motivo técnico crudo, el cliente
    afectado, su contador y si el cliente ya se sincronizó bien DESPUÉS (estado actual)."""
    filas = db.execute(
        select(
            models.Extraccion,
            models.ClienteARCA.nombre,
            models.Usuario.email,
            models.ClienteARCA.clave_requiere_cambio,
            models.ClienteARCA.clave_invalida,
        )
        .outerjoin(models.ClienteARCA, models.ClienteARCA.cuit == models.Extraccion.cuit)
        .outerjoin(models.Usuario, models.Usuario.id == models.ClienteARCA.usuario_id)
        .where(models.Extraccion.resultado == "fallida")
        .order_by(models.Extraccion.fecha.desc())
        .limit(min(limite, 200))
    ).all()

    # Para resolver "¿se sincronizó bien después?": última extracción EXITOSA por cuit (una query).
    cuits = {e.cuit for e, _, _, _, _ in filas}
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
    for e, nombre, email, clave_requiere_cambio, clave_invalida in filas:
        ok_fecha = ultima_ok.get(e.cuit)
        out.append(
            AdminSyncFallidaOut(
                fecha=_iso(e.fecha) or "",
                cuit=e.cuit,
                cliente=nombre,
                contador_email=email,
                motivo=e.motivo,
                duracion_ms=e.duracion_ms,
                # Resuelto si hubo una sync exitosa POSTERIOR, o si el cliente está en un estado
                # CONOCIDO y ya avisado al contador (AFIP le pide cambiar la Clave Fiscal, o su clave no
                # es válida y hay que corregirla): no es un incidente abierto de ops, la pelota está en
                # el contador/cliente. Ver clave_requiere_cambio / clave_invalida.
                resuelto=(
                    (ok_fecha is not None and ok_fecha > e.fecha)
                    or bool(clave_requiere_cambio)
                    or bool(clave_invalida)
                ),
                ultima_sync_ok=_iso(ok_fecha),
            )
        )
    return out


@router.get("/clientes/nombre-sin-confirmar", response_model=list[AdminAvisoNombreOut])
def clientes_nombre_sin_confirmar(db: Session = Depends(get_db)):
    """Clientes cuyo nombre quedó en el placeholder 'Titular <CUIT>' (no se pudo leer el nombre real
    al darlos de alta). Es un AVISO, no un fallo: se resuelve renombrándolo a mano desde la ficha.
    Se evalúa sobre el nombre EFECTIVO (la edición manual del contador gana sobre el dato crudo), así
    un cliente ya renombrado deja de aparecer. Al leerse del estado YA persistido, sólo cuenta a los
    clientes con el alta terminada (no a uno a mitad de carga)."""
    filas = db.execute(
        select(models.ClienteARCA, models.Usuario.email).outerjoin(
            models.Usuario, models.Usuario.id == models.ClienteARCA.usuario_id
        )
    ).all()

    out = []
    for c, email in filas:
        edic = json.loads(c.edicion_json) if c.edicion_json else {}
        nombre = (edic.get("nombre") or c.nombre or "").strip()
        if nombre.lower().startswith("titular"):
            out.append(
                AdminAvisoNombreOut(cuit=c.cuit, cliente=nombre or None, contador_email=email)
            )
    return out


@router.get("/clientes", response_model=list[AdminClienteOut])
def todos_los_clientes(db: Session = Depends(get_db)):
    """TODOS los clientes de TODAS las cuentas (vista global read-only del superadmin). Cada uno trae
    el MISMO dato que ve su contador (régimen, categoría, facturación, última sync) + de quién es y
    cuántos comprobantes tiene cacheados. Es sólo lectura: no modifica nada (leer no dispara ningún
    scraping, los datos ya están en la base)."""
    # Conteo de comprobantes por cuit en UNA sola query (evita N counts).
    conteos = dict(
        db.execute(
            select(models.ComprobanteEmitido.cuit, func.count()).group_by(
                models.ComprobanteEmitido.cuit
            )
        ).all()
    )
    filas = db.execute(
        select(models.ClienteARCA, models.Usuario)
        .outerjoin(models.Usuario, models.Usuario.id == models.ClienteARCA.usuario_id)
        .order_by(models.Usuario.email, models.ClienteARCA.nombre)
    ).all()
    datos = datos_cartera(db, [c for c, _ in filas])
    out: list[AdminClienteOut] = []
    for c, u in filas:
        base = construir_cliente_out(db, c, datos[c.cuit])
        out.append(
            AdminClienteOut(
                **base.model_dump(),
                contador_id=u.id if u else None,
                contador_email=u.email if u else None,
                contador_nombre=(f"{u.nombre} {u.apellido}".strip() if u else None),
                cantidad_comprobantes=conteos.get(c.cuit, 0),
            )
        )
    return out


@router.get("/usuarios/{usuario_id}/ficha", response_model=AdminContadorFichaOut)
def ficha_contador(usuario_id: int, db: Session = Depends(get_db)):
    """Ficha completa de un contador (read-only): sus datos + un resumen agregado (clientes,
    comprobantes, facturado 12m total, sincronizaciones con problemas) + la lista de sus clientes
    con el mismo detalle que la vista global. Leer no dispara scraping: todo sale de la base."""
    u = db.get(models.Usuario, usuario_id)
    if u is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada.")
    clientes_arca = db.scalars(
        select(models.ClienteARCA)
        .where(models.ClienteARCA.usuario_id == usuario_id)
        .order_by(models.ClienteARCA.nombre)
    ).all()
    cuits = [c.cuit for c in clientes_arca]
    conteos: dict[str, int] = {}
    if cuits:
        conteos = dict(
            db.execute(
                select(models.ComprobanteEmitido.cuit, func.count())
                .where(models.ComprobanteEmitido.cuit.in_(cuits))
                .group_by(models.ComprobanteEmitido.cuit)
            ).all()
        )
    clientes_out: list[AdminClienteOut] = []
    facturado_total = 0.0
    con_comps = 0
    problemas = 0
    datos = datos_cartera(db, clientes_arca)
    for c in clientes_arca:
        base = construir_cliente_out(db, c, datos[c.cuit])
        facturado_total += sum(m.emitidasNetas for m in base.historial_mensual)
        if base.tiene_comprobantes:
            con_comps += 1
        if base.resultado_ultima_extraccion == "fallida":
            problemas += 1
        clientes_out.append(
            AdminClienteOut(
                **base.model_dump(),
                contador_id=u.id,
                contador_email=u.email,
                contador_nombre=f"{u.nombre} {u.apellido}".strip(),
                cantidad_comprobantes=conteos.get(c.cuit, 0),
            )
        )
    # WhatsApp activo = canal prendido en la config + teléfono cargado (lo que exige el motor de
    # alertas para enviar). Mismo criterio que alertas.evaluar_y_notificar().
    cfg = json.loads(u.config_json) if u.config_json else {}
    notif = cfg.get("notificaciones") or {}
    whatsapp_activo = bool(notif.get("activo")) and bool(u.telefono)
    resumen = AdminContadorResumen(
        total_clientes=len(clientes_arca),
        clientes_con_comprobantes=con_comps,
        comprobantes_total=sum(conteos.values()),
        facturado_12m_total=facturado_total,
        syncs_problemas=problemas,
        whatsapp_activo=whatsapp_activo,
    )
    return AdminContadorFichaOut(
        usuario=_admin_usuario_out(u, len(clientes_arca)),
        resumen=resumen,
        clientes=clientes_out,
    )


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


@router.post(
    "/usuarios/{usuario_id}/restablecer-password", response_model=ResetPasswordAdminOut
)
def restablecer_password(
    usuario_id: int,
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(admin_actual),
):
    """Genera una contraseña temporal para un contador y la fija (soporte: cuando no puede entrar y
    no le llega el email de recuperación). La devuelve UNA sola vez para que el admin se la pase; no
    se guarda en claro. Invalida cualquier enlace de recuperación pendiente. Queda en la auditoría."""
    target = db.get(models.Usuario, usuario_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada.")
    temporal = generar_password_temporal()
    target.password_hash = hashear_password(temporal)
    # Un reset pendiente quedaría obsoleto: lo limpiamos.
    target.reset_token_hash = None
    target.reset_token_exp = None
    _registrar(db, admin, "restablecer_password", target)  # sin loguear la clave
    db.commit()
    return ResetPasswordAdminOut(password_temporal=temporal)


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
    # Es un admin entrando "como" otro: el token lleva el claim 'adm' y marcamos la instancia para
    # que el flag de facturación salga habilitado (el admin puede probar facturando en cualquier cliente).
    target._imp_admin = True  # type: ignore[attr-defined]
    return ImpersonarOut(token=crear_token(target.id, imp_admin=True), usuario=_usuario_out(target))


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
