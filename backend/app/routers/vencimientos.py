"""Recordatorios de vencimiento a los clientes del contador.

Fase 1 (esta): sólo la carga masiva de contactos del cliente final (email/teléfono), que hoy no
existen en `clientes_arca` (ARCA no los provee). El front descarga una planilla con los clientes de
la cartera, el contador la completa, y acá se importan las filas ya parseadas (mismo enfoque que la
conciliación: el archivo se parsea en el browser y sólo viajan las filas). El armado y envío del
mail mensual se agregan en un paso posterior.

Protegido y multi-tenant: cada contador sólo toca los clientes de su cartera (reusa ids_cartera).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

import datetime as dt

from .. import models
from ..db import get_db
from ..schemas import (
    ImportarContactosIn,
    ImportarContactosResumenOut,
    PrevisualizarVencimientosOut,
    PruebaVencimientoIn,
    PruebaVencimientoOut,
    VencimientoClienteOut,
)
from ..security import ids_cartera, requiere_permiso, usuario_actual
from ..services import vencimientos as vencimientos_svc
from .clientes import _cliente_propio

router = APIRouter(prefix="/api/vencimientos", tags=["vencimientos"])

# Validación de email deliberadamente laxa: alcanza para descartar celdas obviamente mal cargadas
# (sin @ o sin dominio) sin rechazar direcciones válidas raras. La verdad la da el servidor de mail.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.post("/contactos/importar", response_model=ImportarContactosResumenOut)
def importar_contactos(
    datos: ImportarContactosIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("editar_cliente")),
):
    """Carga masiva de email/teléfono de los clientes desde la planilla completada por el contador.

    Tolerante a celdas vacías (no tocan ese campo) y a filas de clientes ajenos (se reportan como
    error, no rompen la importación). Guarda sólo los contactos de clientes de la cartera del
    contador. Idempotente: reimportar la misma planilla deja el mismo estado."""
    ids = ids_cartera(db, usuario)
    # Índice CUIT → cliente de la cartera visible, para resolver cada fila en O(1) sin N queries.
    por_cuit: dict[str, models.ClienteARCA] = {
        c.cuit: c
        for c in db.scalars(
            select(models.ClienteARCA).where(models.ClienteARCA.usuario_id.in_(ids))
        )
    }

    actualizados = 0
    errores: list[dict] = []
    for i, fila in enumerate(datos.filas, start=1):
        cuit = re.sub(r"\D", "", fila.cuit or "")
        if len(cuit) != 11:
            errores.append({"fila": i, "cuit": fila.cuit or "", "motivo": "El CUIT no es válido."})
            continue
        cliente = por_cuit.get(cuit)
        if cliente is None:
            errores.append(
                {"fila": i, "cuit": cuit, "motivo": "Este CUIT no está entre tus clientes."}
            )
            continue
        email = (fila.email or "").strip()
        telefono = (fila.telefono or "").strip()
        if email and not _EMAIL_RE.match(email):
            errores.append(
                {"fila": i, "cuit": cuit, "motivo": f"El email «{email}» no tiene un formato válido."}
            )
            continue
        # Celda vacía = no se toca ese campo (permite completar sólo lo que falta sin borrar lo cargado).
        cambio = False
        if email:
            cliente.email_cliente = email
            cambio = True
        if telefono:
            cliente.telefono_cliente = telefono
            cambio = True
        if cambio:
            actualizados += 1

    db.commit()
    return ImportarContactosResumenOut(actualizados=actualizados, errores=errores)


@router.get("/previsualizar", response_model=PrevisualizarVencimientosOut)
def previsualizar(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
):
    """A quién le llegaría el recordatorio este mes y quién queda afuera (y por qué). Solo lectura,
    no envía nada. Recorre la cartera visible; sólo clientes bajo monitoreo (activos)."""
    hoy = dt.datetime.now(dt.timezone.utc).date()
    ids = ids_cartera(db, usuario)
    clientes = db.scalars(
        select(models.ClienteARCA).where(
            models.ClienteARCA.usuario_id.in_(ids),
            models.ClienteARCA.activo.is_(True),
        )
    ).all()

    lista: list[VencimientoClienteOut] = []
    sin_vencimiento = 0
    for c in clientes:
        if not c.prox_venc_fecha:  # no monotributista / todavía sin próximo vencimiento
            sin_vencimiento += 1
            continue
        activos = c.venc_avisos is not False  # None/True = incluido; False = excluido a mano
        # La frescura del importe sólo importa (y sólo consulta la DB) para los que realmente
        # recibirían: activos y con email. Para el resto no se muestra importe igual.
        fresco = (
            vencimientos_svc.importe_fresco(db, c.cuit, hoy)
            if (activos and c.email_cliente)
            else False
        )
        lista.append(
            VencimientoClienteOut(
                cuit=c.cuit,
                nombre=c.nombre,
                email=c.email_cliente,
                fecha=c.prox_venc_fecha,
                importe=(
                    float(c.prox_venc_importe)
                    if (fresco and c.prox_venc_importe is not None)
                    else None
                ),
                importe_fresco=fresco,
                avisos_activos=activos,
            )
        )

    return PrevisualizarVencimientosOut(
        mes=vencimientos_svc.nombre_mes(hoy.month),
        clientes=lista,
        sin_vencimiento_total=sin_vencimiento,
    )


@router.post("/prueba", response_model=PruebaVencimientoOut)
def enviar_prueba_vencimiento(
    datos: PruebaVencimientoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("editar_cliente")),
):
    """Manda a la casilla del CONTADOR el recordatorio de vencimiento de un cliente, tal como le
    llegaría a él, para previsualizarlo antes de automatizar. Nunca envía al cliente final. Devuelve
    además el contenido armado, así la app lo muestra aunque el envío real no esté configurado."""
    cliente = _cliente_propio(db, datos.cuit, usuario)
    return PruebaVencimientoOut(**vencimientos_svc.enviar_prueba(db, cliente, usuario.email))
