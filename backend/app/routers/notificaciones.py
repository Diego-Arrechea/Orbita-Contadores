"""Notificaciones por WhatsApp. La configuración (si recibe, ventana horaria, nivel y tipos) vive en
la cuenta del contador (config_json.notificaciones) y se edita desde Configuración. Acá sólo queda la
vista previa, que NO envía: sirve para que el contador vea qué alertas tiene y cuáles serían nuevas."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import usuario_actual
from ..services import alertas, whatsapp

router = APIRouter(prefix="/api/notificaciones", tags=["notificaciones"])


@router.get("/vista-previa")
def vista_previa(
    db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Qué alertas tiene hoy el contador (ya filtradas por su config) y cuáles serían NUEVAS. No
    envía ni persiste nada: es la misma evaluación que corre el motor, pero de sólo lectura."""
    return alertas.previsualizar(db, usuario)


@router.post("/prueba")
def enviar_prueba(usuario: models.Usuario = Depends(usuario_actual)):
    """Manda un WhatsApp de ejemplo al teléfono del contador logueado, para que confirme que el canal
    funciona y que su número está bien. No depende de la config de alertas (sirve aunque las tenga
    apagadas)."""
    if not whatsapp.configurado():
        raise HTTPException(
            status_code=503,
            detail="El envío por WhatsApp todavía no está disponible. Probá de nuevo más tarde.",
        )
    destino = (usuario.telefono or "").strip()
    if not destino:
        raise HTTPException(
            status_code=400,
            detail="Tu cuenta no tiene un teléfono cargado. Agregalo en Configuración → Cuenta.",
        )
    mensaje = (
        f"🔔 *Órbita* — prueba de alertas\n\n"
        f"Hola {usuario.nombre}, así te van a llegar las novedades de tu cartera.\n"
        f"Ejemplo: \"Comercial Aragón SRL superó el tope de su categoría\".\n\n"
        f"_Mensaje de prueba, podés ignorarlo._"
    )
    try:
        whatsapp.enviar_whatsapp(destino, mensaje)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail="No se pudo enviar la prueba. Probá de nuevo en un momento."
        ) from e
    return {"enviado": True, "destino": destino}
