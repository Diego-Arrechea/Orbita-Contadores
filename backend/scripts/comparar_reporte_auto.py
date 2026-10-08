"""Vuelca, para una muestra de clientes reales, los MISMOS datos que recibe la pantalla del reporte
(ClienteOut, comprobantes, movimientos, configuración del contador, escala oficial) y el mail que arma
`services/reporte_auto.py`. Del otro lado, `scripts/comparar_reporte_front.ts` (en la raíz del repo)
arma el mail con el código del front a partir de esos datos y compara los dos.

Sólo lectura. Uso (dentro del contenedor del backend):
    python -m scripts.comparar_reporte_auto [cantidad] > /tmp/reporte_muestra.jsonl
"""
from __future__ import annotations

import datetime as dt
import json
import sys

from sqlalchemy import func, select

from app import models
from app.db import SessionLocal
from app.routers.clientes import _comprobante_out, construir_cliente_out
from app.routers.movimientos import _mov_out
from app.security import usuario_puede
from app.services import conciliacion, reporte_auto
from app.data import categorias
from app.schemas import CategoriaOficialOut
from app.services.categorias_afip import montos_categorias

OBS = "Hola, te paso el reporte del mes.\nCualquier duda <consultame> & avisame."


def main(cantidad: int) -> None:
    db = SessionLocal()
    hoy = dt.datetime.now(reporte_auto.TZ_AR).date()
    escala = montos_categorias()
    # El proceso nuevo arranca con la tabla local: le aplicamos la escala oficial, como al backend y
    # al worker, y la pasamos al front (que la recibe de /indicadores/categorias).
    if escala:
        categorias.aplicar_montos_oficiales(escala)
    escala_json = [CategoriaOficialOut(**c.__dict__).model_dump() for c in (escala or [])]
    # Muestra variada: de varios contadores, priorizando clientes con comprobantes, movimientos,
    # carga manual, agro, régimen no monotributo y opciones de reporte propias.
    cm = models.ComprobanteEmitido
    con_manual = set(db.scalars(select(cm.cuit).where(cm.origen == "manual").distinct()))
    con_mov = set(db.scalars(select(models.MovimientoBancario.cuit).distinct()))
    clientes = db.scalars(select(models.ClienteARCA).order_by(func.random())).all()
    elegidos, por_usuario = [], {}
    for c in clientes:
        interesante = (
            c.cuit in con_manual or c.cuit in con_mov or c.factura_agro or c.reporte_config_json
            or (c.regimen and c.regimen != "monotributo")
        )
        if por_usuario.get(c.usuario_id, 0) >= (6 if interesante else 2):
            continue
        por_usuario[c.usuario_id] = por_usuario.get(c.usuario_id, 0) + 1
        elegidos.append(c)
        if len(elegidos) >= cantidad:
            break
    for c in elegidos:
        usuario = db.get(models.Usuario, c.usuario_id)
        movs = usuario_puede(db, usuario, "conciliacion")
        comps = db.scalars(select(cm).where(cm.cuit == c.cuit).order_by(cm.fecha.desc())).all()
        py = reporte_auto.armar_reporte(
            db, usuario, c, observaciones=OBS, estudio=usuario.estudio or "Tu estudio contable",
            incluir_movimientos=movs, hoy=hoy,
        )
        print(json.dumps({
            "cuit": c.cuit,
            "usuario_id": c.usuario_id,
            "estudio": usuario.estudio or "Tu estudio contable",
            "observaciones": OBS,
            "config": json.loads(usuario.config_json) if usuario.config_json else {},
            "escala": escala_json,
            "bk": construir_cliente_out(db, c, meses_historial=26).model_dump(mode="json"),
            "comprobantes": [_comprobante_out(x).model_dump(mode="json") for x in comps],
            "movimientos": [_mov_out(m).model_dump(mode="json") for m in conciliacion.listar(db, c.cuit)] if movs else [],
            "py": py,
        }, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 40)
