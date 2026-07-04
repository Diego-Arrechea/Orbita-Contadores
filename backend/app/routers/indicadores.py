"""Indicadores macro para el front (hoy: inflación esperada del REM). Detrás del token, como el resto
de la API. Sólo lectura: el dato lo trae y cachea services/indicadores.py."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from .. import models
from ..schemas import CategoriaOficialOut, InflacionEsperadaOut
from ..security import usuario_actual
from ..services.indicadores import inflacion_esperada
from ..services.categorias_afip import montos_categorias

router = APIRouter(prefix="/api/indicadores", tags=["indicadores"])


@router.get("/inflacion", response_model=Optional[InflacionEsperadaOut])
def obtener_inflacion(
    usuario: models.Usuario = Depends(usuario_actual),
) -> Optional[InflacionEsperadaOut]:
    """Inflación mensual esperada (mediana del REM). Devuelve null si la fuente no está disponible."""
    dato = inflacion_esperada()
    if dato is None:
        return None
    return InflacionEsperadaOut(
        mensual=dato.mensual,
        interanual=dato.interanual,
        fecha=dato.fecha,
        fuente=dato.fuente,
    )


@router.get("/categorias", response_model=Optional[list[CategoriaOficialOut]])
def obtener_categorias(
    usuario: models.Usuario = Depends(usuario_actual),
) -> Optional[list[CategoriaOficialOut]]:
    """Escala oficial de Monotributo vigente (categorías A→K con topes y cuotas) de la tabla pública
    de ARCA. Devuelve null si la fuente no está disponible → el front usa su tabla local."""
    cats = montos_categorias()
    if not cats:
        return None
    return [CategoriaOficialOut(**c.__dict__) for c in cats]
