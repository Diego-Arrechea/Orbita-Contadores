"""Configuración del contador (ventanas de recategorización, umbrales de alerta, inflación) guardada
EN LA CUENTA. Antes vivía en localStorage del navegador; ahora se persiste como un blob JSON en
usuarios.config_json, por usuario. El merge es PARCIAL: el front manda sólo lo que cambió y completa
el resto con sus defaults, así que el PUT sólo pisa los campos que vinieron."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import ConfiguracionIn, ConfiguracionOut
from ..security import usuario_actual

router = APIRouter(prefix="/api", tags=["configuracion"])


@router.get("/configuracion", response_model=ConfiguracionOut)
def obtener_configuracion(
    usuario: models.Usuario = Depends(usuario_actual),
) -> ConfiguracionOut:
    """La configuración guardada del contador (todos los campos None si nunca guardó nada)."""
    datos = json.loads(usuario.config_json) if usuario.config_json else {}
    return ConfiguracionOut(**datos)


@router.put("/configuracion", response_model=ConfiguracionOut)
def guardar_configuracion(
    datos: ConfiguracionIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
) -> ConfiguracionOut:
    """Mergea (parcial) los cambios sobre lo ya guardado: sólo pisa los campos que vinieron."""
    actual: dict = json.loads(usuario.config_json) if usuario.config_json else {}
    actual.update(datos.model_dump(exclude_none=True))
    usuario.config_json = json.dumps(actual, ensure_ascii=False)
    db.add(usuario)
    db.commit()
    return ConfiguracionOut(**actual)
