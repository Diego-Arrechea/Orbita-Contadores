"""Notificaciones por WhatsApp. Por ahora: un envío de prueba para validar el canal (Twilio)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import usuario_actual
from ..services import alertas, whatsapp

router = APIRouter(prefix="/api/notificaciones", tags=["notificaciones"])


class PruebaIn(BaseModel):
    # Opcional: si no se manda, usa el teléfono del contador logueado.
    numero: str | None = None


@router.post("/prueba")
def enviar_prueba(datos: PruebaIn, usuario: models.Usuario = Depends(usuario_actual)):
    """Manda un WhatsApp de prueba (alerta de ejemplo) al número indicado o al del contador."""
    if not whatsapp.configurado():
        raise HTTPException(
            status_code=503,
            detail="WhatsApp no está configurado: faltan las credenciales de Twilio en backend/.env.",
        )
    destino = (datos.numero or usuario.telefono or "").strip()
    if not destino:
        raise HTTPException(status_code=400, detail="No hay número de destino.")

    mensaje = (
        f"🔔 *Órbita* — alerta de prueba\n\n"
        f"Hola {usuario.nombre}, así te van a llegar las alertas de tu cartera.\n"
        f"Ejemplo: \"Comercial Aragón SRL está al 92% del tope de su categoría\".\n\n"
        f"_Mensaje de prueba, podés ignorarlo._"
    )
    try:
        sid = whatsapp.enviar_whatsapp(destino, mensaje)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"No se pudo enviar: {e}") from e
    return {"enviado": True, "destino": destino, "sid": sid}


@router.post("/evaluar")
def evaluar(db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)):
    """Evalúa las alertas de dato-directo del contador logueado y le manda el resumen por WhatsApp.
    Es el mismo flujo que corre el sync diario, pero acotado a vos (para probar al instante)."""
    if not whatsapp.configurado():
        raise HTTPException(
            status_code=503,
            detail="WhatsApp no está configurado: faltan las credenciales de Twilio en backend/.env.",
        )
    return alertas.evaluar_y_notificar(db, solo_usuario_id=usuario.id)
