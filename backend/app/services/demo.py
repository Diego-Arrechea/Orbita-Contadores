"""Cuentas de DEMOSTRACIÓN: carteras de ejemplo para mostrar el producto sin datos reales.

Una cuenta marcada `Usuario.demo` tiene clientes ficticios, cargados a mano (ver
`scripts/generar_demo.py`). No existen ante los organismos, así que todo lo que saldría hacia
afuera queda cortado en tres lugares:

  * el motor continuo no los toma (`worker/loop._clientes_vencidos`),
  * el recordatorio de vencimientos no le escribe a sus contactos (`services/vencimientos`),
  * las consultas "en vivo" de la ficha responden con lo que ya está cargado (routers/clientes).

El corte es por CUENTA y no por cliente: así una demo se arma, se recicla y se borra entera, y
ningún cliente de ejemplo puede quedar suelto pidiendo datos que no existen. Los empleados del
estudio heredan la marca del titular (misma cartera).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models


def es_demo(db: Session, usuario: models.Usuario | None) -> bool:
    """¿La cuenta es de demostración? Un empleado lo es si lo es su titular."""
    if usuario is None:
        return False
    if usuario.demo:
        return True
    if usuario.titular_id:
        titular = db.get(models.Usuario, usuario.titular_id)
        return bool(titular is not None and titular.demo)
    return False


def ids_demo(db: Session) -> list[int]:
    """Ids de todas las cuentas de demostración, titulares y sus empleados. Lista vacía en la
    inmensa mayoría de las instalaciones: es el caso normal y no cuesta nada."""
    titulares = list(db.scalars(select(models.Usuario.id).where(models.Usuario.demo.is_(True))))
    if not titulares:
        return []
    empleados = list(
        db.scalars(select(models.Usuario.id).where(models.Usuario.titular_id.in_(titulares)))
    )
    return sorted(set(titulares) | set(empleados))
