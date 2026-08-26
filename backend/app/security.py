"""Seguridad de la sesión de contadores: hashing de contraseñas (bcrypt), tokens JWT (PyJWT) y
equipo del estudio (visibilidad por responsable + permisos de empleados)."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import secrets

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .config import (
    contabilidad_habilitada_para,
    facturacion_habilitada_para,
    iva_habilitada_para,
    settings,
)
from .db import get_db
from .services import demo as demo_svc
from .services import suscripciones as suscripciones_svc

ALGORITMO = "HS256"
_bearer = HTTPBearer(auto_error=False)

# Los 403 que dejan a la cuenta SIN acceso a la app (no los de "esta sección no entra en tu plan")
# viajan con esta cabecera: el front la usa para cerrar la sesión y mandar al login con el motivo,
# en vez de dejar al usuario adentro chocándose contra errores en cada pantalla. Va expuesta en el
# CORS del main (expose_headers), si no el browser no la deja leer.
CABECERA_SESION_CERRADA = {"X-Orbita-Sesion": "cerrada"}

MENSAJE_CUENTA_DESHABILITADA = (
    "Tu cuenta fue deshabilitada. Escribinos a orbitaglobalclientes@gmail.com para reactivarla."
)

# Copy para el EMPLEADO cuyo estudio dejó de tener los usuarios del equipo contratados. Le hablamos
# de lo que puede hacer (avisarle al titular), no de planes ni de cobranza: el estado comercial del
# estudio no es asunto suyo y no queremos que se entere del monto ni del vencimiento.
MENSAJE_EQUIPO_SIN_PLAN = (
    "Tu estudio no tiene habilitados los usuarios del equipo en este momento, así que tu acceso "
    "quedó suspendido. Avisale a quien administra la cuenta del estudio para reactivarlo."
)


def _secret() -> str:
    """Secreto para firmar/verificar los JWT. Cae a FERNET_KEY si no hay JWT_SECRET."""
    secret = settings.jwt_secret or settings.fernet_key
    if not secret:
        raise RuntimeError(
            "Falta JWT_SECRET (o FERNET_KEY) en backend/.env para firmar los tokens de sesión."
        )
    return secret


def hashear_password(password: str) -> str:
    # bcrypt opera sobre <= 72 bytes; truncamos por las dudas (el schema ya valida la longitud).
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verificar_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))
    except ValueError:
        return False


def hashear_reset_token(token: str) -> str:
    """sha256 (hex) del token de recuperación. En la DB guardamos sólo este hash, nunca el token
    en claro: así una filtración de la base no permite restablecer contraseñas."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generar_reset_token() -> tuple[str, str]:
    """Token de recuperación de un solo uso. Devuelve (token_claro, token_hash): el claro viaja en
    el enlace del email; el hash se persiste en `Usuario.reset_token_hash`."""
    token = secrets.token_urlsafe(32)
    return token, hashear_reset_token(token)


def hashear_email_token(token: str) -> str:
    """sha256 (hex) del token de confirmación de email. Mismo criterio que el de reset: en la DB
    guardamos sólo este hash, nunca el token en claro."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generar_email_token() -> tuple[str, str]:
    """Token de confirmación de email de un solo uso. Devuelve (token_claro, token_hash): el claro
    viaja en el enlace del correo; el hash se persiste en `Usuario.email_token_hash`."""
    token = secrets.token_urlsafe(32)
    return token, hashear_email_token(token)


def generar_password_temporal() -> str:
    """Contraseña temporal legible para el reset desde el panel admin (cumple el mínimo de 8)."""
    return secrets.token_urlsafe(9)


def crear_token(usuario_id: int, imp_admin: bool = False) -> str:
    ahora = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": str(usuario_id),
        "iat": ahora,
        "exp": ahora + dt.timedelta(minutes=settings.jwt_expire_minutes),
    }
    # 'adm' = la sesión es una impersonación hecha por un ADMIN: lleva su privilegio (p. ej. facturar
    # para probar en cualquier cliente), aunque el contador impersonado no esté habilitado.
    if imp_admin:
        payload["adm"] = True
    return jwt.encode(payload, _secret(), algorithm=ALGORITMO)


def usuario_actual(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.Usuario:
    """Dependencia FastAPI: valida el header `Authorization: Bearer <token>` y devuelve el
    contador logueado. Lanza 401 si el token falta, es inválido, expiró o el usuario no existe."""
    no_autorizado = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Sesión inválida o expirada.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if cred is None:
        raise no_autorizado
    try:
        payload = jwt.decode(cred.credentials, _secret(), algorithms=[ALGORITMO])
        usuario_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as e:
        raise no_autorizado from e
    usuario = db.get(models.Usuario, usuario_id)
    if usuario is None:
        raise no_autorizado
    if not usuario.activo:
        # Cuenta inhabilitada por un administrador: corta la sesión aunque el token siga vigente.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=MENSAJE_CUENTA_DESHABILITADA,
            headers=CABECERA_SESION_CERRADA,
        )
    # Marca transitoria (no se persiste): la sesión es una impersonación hecha por un admin.
    usuario._imp_admin = bool(payload.get("adm"))  # type: ignore[attr-defined]
    motivo = acceso_suspendido(db, usuario)
    if motivo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=motivo,
            headers=CABECERA_SESION_CERRADA,
        )
    return usuario


# --- Qué puede usar la cuenta: el plan de la suscripción -----------------------------------------
# El acceso a cada función sale de `services.suscripciones.funciones_de_usuario()` (plan + estado +
# excepciones por cuenta). Los gates de abajo lo combinan con lo que ya existía:
#   acceso = rollout del backend (allowlist)  Y  plan de la suscripción  Y  permiso del equipo
# El rollout sigue siendo el interruptor maestro de una feature nueva (nada se abre por subir de
# plan si todavía no está abierta); el plan es la palanca COMERCIAL, por cuenta.
#
# Los usuarios del estudio se evalúan con la suscripción de su titular (la resuelve el servicio).
# Los ADMIN de Órbita pueden todo. Al impersonar, el acceso refleja el de la cuenta impersonada:
# es justamente lo que un admin necesita para verificar un cambio de plan.

# Copy único para todos los 403 por plan: el contador ve siempre lo mismo, sin detalles internos.
MENSAJE_SIN_FUNCION = (
    "Esta sección no está incluida en el plan de tu estudio. Escribinos y la habilitamos."
)


def funciones_usuario(db: Session, usuario: models.Usuario) -> dict[str, bool]:
    """{clave: True/False} para todo el catálogo de funciones. Se cachea en el objeto de la request
    (vive lo que dura la sesión de la request) para no re-consultar en cada gate."""
    cache = getattr(usuario, "_funciones", None)
    if cache is None:
        cache = suscripciones_svc.funciones_de_usuario(db, usuario)
        usuario._funciones = cache  # type: ignore[attr-defined]
    return cache


def usuario_puede(db: Session, usuario: models.Usuario, clave: str) -> bool:
    """¿El plan de esta cuenta incluye la función `clave`?"""
    return bool(funciones_usuario(db, usuario).get(clave, False))


def requiere_funcion(clave: str):
    """Fábrica de dependencias FastAPI: como `usuario_actual`, pero además exige que el plan de la
    cuenta incluya la función `clave` (403 si no). El front esconde la sección con el mismo dato
    (UsuarioOut.funciones); esto la cierra de verdad."""

    def _dep(
        usuario: models.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)
    ) -> models.Usuario:
        if not usuario_puede(db, usuario, clave):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=MENSAJE_SIN_FUNCION
            )
        return usuario

    return _dep


def acceso_suspendido(db: Session, usuario: models.Usuario) -> str | None:
    """¿Esta cuenta quedó SIN acceso a la app? Devuelve el motivo (texto para el usuario) o None.

    Hoy el único caso son los usuarios del equipo ("Gestión de usuarios") cuando el estudio
    deja de tener contratada la función `usuarios`: el titular sigue entrando y ve toda la cartera
    —incluidos los clientes que tenía repartidos—, pero sus empleados no.

    Es un estado DERIVADO, no una baja: no tocamos `Usuario.activo`. Así el empleado vuelve solo
    cuando el estudio recupera la función, sin que nadie tenga que acordarse de reactivarlo uno por
    uno; y cubre también el caso en que la cuenta se degrada sola por vencimiento (ahí no hay
    ninguna acción del admin a la que engancharse). La baja administrativa (`activo=False`) sigue
    siendo cosa aparte y manda antes que esto.

    Excepción: una impersonación hecha por un admin (claim 'adm') entra igual, para que soporte
    pueda mirar la cuenta aunque esté suspendida."""
    if not es_empleado(usuario) or getattr(usuario, "_imp_admin", False):
        return None
    if usuario_puede(db, usuario, "usuarios"):
        return None
    return MENSAJE_EQUIPO_SIN_PLAN


def usuario_puede_facturar(db: Session, usuario: models.Usuario) -> bool:
    """¿Puede emitir comprobantes? Hace falta el rollout (FACTURACION_EMAILS + admins + impersonación
    de admin, para que un admin pueda probar facturando en cualquier cliente al 'entrar como') Y que
    el plan de la cuenta incluya la facturación."""
    rollout = facturacion_habilitada_para(usuario.email, usuario.rol) or bool(
        getattr(usuario, "_imp_admin", False)
    )
    return rollout and usuario_puede(db, usuario, "facturacion")


def usuario_puede_iva(db: Session, usuario: models.Usuario) -> bool:
    """¿Puede ver el apartado de IVA? Rollout (IVA_EMAILS + admins) Y plan que lo incluya. NO lleva
    el bonus de impersonación: al 'entrar como' otra cuenta, el IVA refleja el acceso REAL de esa
    cuenta, así el admin ve exactamente lo que ve el contador después de cambiarle el plan."""
    return iva_habilitada_para(usuario.email, usuario.rol) and usuario_puede(db, usuario, "iva")


def usuario_iva(
    usuario: models.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)
) -> models.Usuario:
    """Dependencia FastAPI: como `usuario_actual`, pero además exige que la cuenta tenga habilitado el
    apartado de IVA (403 si no). Cierra los endpoints de IVA por detrás del gate del front."""
    if not usuario_puede_iva(db, usuario):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MENSAJE_SIN_FUNCION)
    return usuario


def usuario_puede_contabilidad(db: Session, usuario: models.Usuario) -> bool:
    """¿Puede ver el apartado de Contabilidad? Rollout (CONTABILIDAD_EMAILS + admins) Y plan que lo
    incluya. Como el de IVA, NO lleva el bonus de impersonación: al 'entrar como' otra cuenta
    refleja el acceso REAL de esa cuenta."""
    return contabilidad_habilitada_para(usuario.email, usuario.rol) and usuario_puede(
        db, usuario, "contabilidad"
    )


def usuario_contabilidad(
    usuario: models.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)
) -> models.Usuario:
    """Dependencia FastAPI: como `usuario_actual`, pero además exige que la cuenta tenga habilitado
    el apartado de Contabilidad (403 si no)."""
    if not usuario_puede_contabilidad(db, usuario):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MENSAJE_SIN_FUNCION)
    return usuario


def usuario_puede_suscripcion(usuario: models.Usuario) -> bool:
    """¿Puede ver el apartado "Mi suscripción"? Por ahora NO se les muestra a los contadores: sólo
    lo ve el equipo de Órbita (rol admin) y las sesiones impersonadas por un admin (claim 'adm' del
    token), para poder mirar la pantalla tal como la vería el contador. Mismo bonus de impersonación
    que facturación; al revés que IVA/Contabilidad, que reflejan el acceso real de la cuenta."""
    return usuario.rol == "admin" or bool(getattr(usuario, "_imp_admin", False))


def admin_actual(usuario: models.Usuario = Depends(usuario_actual)) -> models.Usuario:
    """Dependencia FastAPI: exige que el usuario logueado sea administrador (panel superadmin).
    Reusa `usuario_actual` (token válido + cuenta activa) y además chequea el rol."""
    if usuario.rol != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenés permisos para acceder a esta sección.",
        )
    return usuario


# --- Equipo del estudio ("Gestión de usuarios") --------------------------------------------------
# El titular crea cuentas de EMPLEADO (Usuario.titular_id = su id) y les asigna clientes: cada
# cliente sigue teniendo UN responsable (ClienteARCA.usuario_id). El empleado ve/opera sólo sus
# asignados; el titular ve toda la cartera del equipo. Los permisos acotan qué ACCIONES puede hacer
# el empleado sobre sus asignados (se enforcan acá, no sólo en el front).

# Permisos disponibles para empleados (clave → descripción para devs; los labels de UI viven en el
# front). Default: TODOS habilitados; el titular los apaga por empleado (Usuario.permisos_json).
PERMISOS_EQUIPO = (
    "nuevo_cliente",      # dar de alta clientes (quedan asignados a él)
    "editar_cliente",     # editar la ficha (notas, categoría manual, pausar/reactivar)
    "eliminar_cliente",   # borrar un cliente y su historial
    "actualizar_clave",   # reemplazar la clave con la que se consultan los datos del cliente
    "facturar",           # emitir comprobantes (se suma al gate general de facturación)
    "conciliacion",       # importar extractos y clasificar movimientos
    "comunicaciones",     # abrir el detalle de comunicaciones fiscales (las marca leídas en ARCA)
)


def es_empleado(usuario: models.Usuario) -> bool:
    """¿La cuenta es un empleado creado desde "Gestión de usuarios"? (ve sólo sus asignados)."""
    return usuario.titular_id is not None


def permisos_efectivos(usuario: models.Usuario) -> dict[str, bool]:
    """Permisos del usuario con los defaults aplicados (clave ausente = habilitado). Para cuentas
    plenas (no-empleado) devuelve todo en True."""
    guardado: dict = {}
    if es_empleado(usuario) and usuario.permisos_json:
        try:
            guardado = json.loads(usuario.permisos_json)
        except ValueError:
            guardado = {}
    return {clave: bool(guardado.get(clave, True)) for clave in PERMISOS_EQUIPO}


def tiene_permiso(usuario: models.Usuario, clave: str) -> bool:
    if not es_empleado(usuario):
        return True
    return permisos_efectivos(usuario).get(clave, True)


def requiere_permiso(clave: str):
    """Fábrica de dependencias FastAPI: como `usuario_actual`, pero además exige el permiso `clave`
    (403 si el titular se lo apagó al empleado). Para cuentas plenas es transparente."""

    def _dep(usuario: models.Usuario = Depends(usuario_actual)) -> models.Usuario:
        if not tiene_permiso(usuario, clave):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tu cuenta no tiene habilitada esta función. Pedile al titular del "
                "estudio que la active.",
            )
        return usuario

    return _dep


def titular_actual(usuario: models.Usuario = Depends(usuario_actual)) -> models.Usuario:
    """Dependencia FastAPI: exige una cuenta PLENA (no empleado) para administrar el equipo
    ("Gestión de usuarios"). Cualquier contador puede crear su equipo; un empleado no."""
    if es_empleado(usuario):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenés permisos para acceder a esta sección.",
        )
    return usuario


def ids_cartera(db: Session, usuario: models.Usuario) -> list[int]:
    """Los `usuario_id` cuyos clientes puede ver esta cuenta: los propios y, si tiene equipo, los de
    todos sus empleados (incluidos los desactivados: sus clientes no desaparecen de la vista del
    titular). Para un empleado o un contador sin equipo devuelve sólo su id."""
    ids = [usuario.id]
    if not es_empleado(usuario):
        ids += list(
            db.scalars(select(models.Usuario.id).where(models.Usuario.titular_id == usuario.id))
        )
    return ids


def bloquear_si_demo(db: Session, usuario: models.Usuario, accion: str = "") -> None:
    """Corta una acción que saldría hacia afuera (traer datos del organismo, emitir, dar de alta un
    cliente) cuando la cuenta es de DEMOSTRACIÓN: su cartera es de ejemplo y no existe ante ARCA.
    `accion` completa el mensaje ("no se dan de alta clientes nuevos"). Ver services/demo.py."""
    if not demo_svc.es_demo(db, usuario):
        return
    detalle = "Esta es una cuenta de demostración: su cartera es de ejemplo y ya viene cargada."
    if accion:
        detalle = f"{detalle} {accion}"
    raise HTTPException(status_code=409, detail=detalle)
