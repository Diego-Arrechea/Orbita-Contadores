"""Onboarding del contador: listar representados + conectar (guardar clave cifrada + sincronizar)."""
from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete

from .. import models
from ..crypto import cifrar
from ..db import SessionLocal
from ..schemas import JobOut, MonitorearIn, OnboardingIn, RepresentadoOut
from ..security import usuario_actual
from ..arca import motor
from ..scraping import jobs
from ..services import sincronizacion

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class _CargaCancelada(Exception):
    """El contador canceló el alta: corta el scraping en curso para abortar cuanto antes."""


# def (no async): el scraping usa Playwright sync, que debe correr fuera del event loop.
@router.post("/representados", response_model=list[RepresentadoOut])
def listar_representados(datos: OnboardingIn, _usuario: models.Usuario = Depends(usuario_actual)):
    """Loguea con la clave del contador y devuelve sus CUITs operables (él + representados)."""
    try:
        return motor.listar_representados(datos.cuit, datos.clave)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"No se pudieron leer los representados: {e}"
        ) from e


@router.post("/monitorear")
def monitorear(datos: MonitorearIn, usuario: models.Usuario = Depends(usuario_actual)):
    """Guarda la clave del contador (cifrada), registra los clientes elegidos y dispara, en un
    thread, la PRIMERA sincronización (histórico) de cada uno. Devuelve job_id para el progreso."""
    if not datos.seleccionados:
        raise HTTPException(status_code=400, detail="No hay clientes seleccionados.")

    db = SessionLocal()
    try:
        cred = db.get(models.CredencialARCA, datos.cuit)
        if cred is None:
            cred = models.CredencialARCA(cuit=datos.cuit, clave_cifrada=cifrar(datos.clave.encode()))
            db.add(cred)
        else:
            cred.clave_cifrada = cifrar(datos.clave.encode())  # refresca por si cambió
        db.commit()
    finally:
        db.close()

    job_id = jobs.crear_job(usuario.id)
    seleccionados = [(s.cuit, s.nombre) for s in datos.seleccionados]
    threading.Thread(
        target=_correr_monitoreo,
        args=(job_id, datos.cuit, seleccionados, usuario.id, datos.factura_agro),
        daemon=True,
    ).start()
    return {"job_id": job_id}


@router.get("/monitorear/{job_id}", response_model=JobOut)
def progreso_monitoreo(job_id: str, _usuario: models.Usuario = Depends(usuario_actual)):
    job = jobs.obtener(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado.")
    return job


@router.post("/monitorear/{job_id}/cancelar")
def cancelar_monitoreo(job_id: str, usuario: models.Usuario = Depends(usuario_actual)):
    """Cancela un alta en curso: el worker aborta el trabajo y deshace (borra) los clientes que ESTA
    alta hubiera creado. No toca clientes que ya existían antes."""
    job = jobs.obtener(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado.")
    if job.get("usuario_id") not in (None, usuario.id):
        raise HTTPException(status_code=404, detail="Job no encontrado.")
    jobs.cancelar(job_id)
    return {"job_id": job_id, "cancelado": True}


def _correr_monitoreo(
    job_id: str,
    cuit_credencial: str,
    seleccionados: list[tuple],
    usuario_id: int,
    factura_agro: bool = False,
) -> None:
    """Por cada cliente: lo registra (asociado al contador) y sincroniza su histórico. Si el contador
    cancela el alta, aborta y deshace los clientes que este job hubiera creado. `factura_agro`: si el
    contador lo marcó en el alta, prende el flag agropecuario del cliente (nunca lo apaga)."""
    total = len(seleccionados)
    creados: list[str] = []  # CUITs que ESTE job dio de alta (los borramos si se cancela)
    cancelado = False
    for i, (cuit_cliente, nombre) in enumerate(seleccionados):
        if jobs.esta_cancelado(job_id):
            cancelado = True
            break
        base = int(i / total * 100)
        span = 100 / total

        def on_prog(idx: int, n: int, msg: str, _b: int = base, _s: float = span, _i: int = i) -> None:
            # Checkpoint de cancelación: corta el scraping en curso lo antes posible.
            if jobs.esta_cancelado(job_id):
                raise _CargaCancelada
            pct = _b + int((idx / max(1, n)) * _s)
            jobs.actualizar(
                job_id,
                progreso=min(99, pct),
                mensaje=f"Cliente {_i + 1}/{total} — trayendo {msg}",
            )

        try:
            db = SessionLocal()
            try:
                cli = db.get(models.ClienteARCA, cuit_cliente)
                if cli is None:
                    db.add(
                        models.ClienteARCA(
                            cuit=cuit_cliente,
                            nombre=nombre,
                            cuit_credencial=cuit_credencial,
                            usuario_id=usuario_id,
                            factura_agro=factura_agro,
                        )
                    )
                    creados.append(cuit_cliente)
                else:
                    cli.nombre = nombre
                    cli.cuit_credencial = cuit_credencial
                    cli.usuario_id = usuario_id
                    if factura_agro:  # sólo lo prende; no apaga uno ya marcado (manual o auto)
                        cli.factura_agro = True
                db.commit()
            finally:
                db.close()

            db = SessionLocal()
            try:
                n = sincronizacion.sincronizar(db, cuit_cliente, on_progress=on_prog)
            finally:
                db.close()

            # Categoría/actividad reales del padrón de Monotributo (si es monotributista titular).
            db = SessionLocal()
            try:
                sincronizacion.sincronizar_padron(db, cuit_cliente)
            except Exception:  # noqa: BLE001
                pass
            finally:
                db.close()

            jobs.agregar_resultado(
                job_id, {"cuit": cuit_cliente, "nombre": nombre, "ok": True, "comprobantes": n}
            )
        except _CargaCancelada:
            cancelado = True
            break
        except Exception as e:  # noqa: BLE001
            # El scraper envuelve la _CargaCancelada en RuntimeError; si se canceló, no es un fallo real.
            if jobs.esta_cancelado(job_id):
                cancelado = True
                break
            jobs.agregar_resultado(
                job_id, {"cuit": cuit_cliente, "nombre": nombre, "ok": False, "error": str(e)}
            )

    if cancelado or jobs.esta_cancelado(job_id):
        _deshacer_alta(creados)
        jobs.actualizar(job_id, estado="cancelado", progreso=100, mensaje="Alta cancelada")
        return

    jobs.actualizar(job_id, estado="terminado", progreso=100, mensaje="Listo")


def _deshacer_alta(cuits: list[str]) -> None:
    """Borra los clientes que un alta cancelada había creado, con su cache. Mismo orden FK-safe que
    eliminar_cliente() en routers/clientes.py (en Postgres hay que borrar los hijos primero)."""
    if not cuits:
        return
    db = SessionLocal()
    try:
        for cuit in cuits:
            db.execute(delete(models.ComprobanteEmitido).where(models.ComprobanteEmitido.cuit == cuit))
            db.execute(delete(models.Extraccion).where(models.Extraccion.cuit == cuit))
            db.execute(delete(models.MovimientoBancario).where(models.MovimientoBancario.cuit == cuit))
            db.execute(delete(models.ClienteARCA).where(models.ClienteARCA.cuit == cuit))
        db.commit()
    finally:
        db.close()
