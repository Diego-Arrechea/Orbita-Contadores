"""Endpoints de conciliación bancaria: importar extractos, listar movimientos y clasificarlos.
Protegidos: cada contador opera sólo sobre sus propios clientes (reusa _cliente_propio)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..schemas import ClasificarIn, ImportarMovimientosIn, ImportarResumenOut, MovimientoOut
from ..security import requiere_permiso, usuario_actual
from ..services import conciliacion
from .clientes import _cliente_propio

router = APIRouter(prefix="/api", tags=["movimientos"])


def _mov_out(m: models.MovimientoBancario) -> MovimientoOut:
    """Serializa un movimiento al shape camelCase que consume el front."""
    return MovimientoOut(
        id=str(m.id),
        fecha=m.fecha.isoformat(),
        monto=float(m.monto),
        fuente=m.fuente,
        cuitOriginante=m.cuit_originante,
        nombreOriginante=m.nombre_originante,
        descripcion=m.descripcion,
        comprobanteMatcheadoId=m.comprobante_matcheado_id,
        matchConfianza=m.match_confianza,
        marcadoComo=m.marcado_como,
        marcadoPorContador=m.marcado_por,
        marcadoEn=m.marcado_en.isoformat() if m.marcado_en else None,
    )


@router.post("/clientes/{cuit}/movimientos/importar", response_model=ImportarResumenOut)
def importar_movimientos(
    cuit: str,
    datos: ImportarMovimientosIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("conciliacion")),
):
    """Importa las acreditaciones de un extracto (filas ya parseadas por el front) y las cruza con
    los comprobantes emitidos reales del cliente. Idempotente: re-subir el mismo archivo no duplica."""
    _cliente_propio(db, cuit, usuario)
    res = conciliacion.importar(db, cuit, datos.fuente, datos.filas)
    return ImportarResumenOut(
        importados=res["importados"],
        duplicadosOmitidos=res["duplicados_omitidos"],
        debitosOmitidos=res["debitos_omitidos"],
        matcheadosAuto=res["matcheados_auto"],
        pendientes=res["pendientes"],
        movimientos=[_mov_out(m) for m in res["movimientos"]],
    )


@router.get("/clientes/{cuit}/movimientos", response_model=list[MovimientoOut])
def listar_movimientos(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
):
    """Todos los movimientos del cliente (más reciente primero)."""
    _cliente_propio(db, cuit, usuario)
    return [_mov_out(m) for m in conciliacion.listar(db, cuit)]


@router.post("/clientes/{cuit}/movimientos/reconciliar")
def reconciliar_movimientos(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("conciliacion")),
):
    """Re-corre el matcher sobre los pendientes (útil tras sincronizar comprobantes nuevos)."""
    _cliente_propio(db, cuit, usuario)
    return {"reconciliados": conciliacion.reconciliar_pendientes(db, cuit)}


@router.post("/clientes/{cuit}/movimientos/{mov_id}/clasificar", response_model=MovimientoOut)
def clasificar_movimiento(
    cuit: str,
    mov_id: int,
    datos: ClasificarIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("conciliacion")),
):
    """Decisión manual del contador sobre un movimiento: venta/no-venta o match forzado."""
    _cliente_propio(db, cuit, usuario)
    try:
        mov = conciliacion.clasificar(
            db,
            cuit,
            mov_id,
            marcado_como=datos.marcadoComo,
            comprobante_id=datos.comprobanteId,
            contador_nombre=usuario.nombre,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _mov_out(mov)


@router.delete("/clientes/{cuit}/movimientos/{mov_id}")
def eliminar_movimiento(
    cuit: str,
    mov_id: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("conciliacion")),
):
    """Borra una fila mal importada."""
    _cliente_propio(db, cuit, usuario)
    mov = db.get(models.MovimientoBancario, mov_id)
    if mov is None or mov.cuit != cuit:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    db.delete(mov)
    db.commit()
    return {"eliminado": mov_id}
