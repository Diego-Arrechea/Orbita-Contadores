"""Onboarding del contador: listar representados + conectar (guardar clave cifrada + sincronizar)."""
from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException

from .. import models
from ..crypto import cifrar
from ..db import SessionLocal
from ..schemas import JobOut, MonitorearIn, OnboardingIn, RepresentadoOut
from ..security import usuario_actual
from ..scraping import jobs
from ..scraping import onboarding as scraping
from ..services import sincronizacion

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


# def (no async): el scraping usa Playwright sync, que debe correr fuera del event loop.
@router.post("/representados", response_model=list[RepresentadoOut])
def listar_representados(datos: OnboardingIn, _usuario: models.Usuario = Depends(usuario_actual)):
    """Loguea con la clave del contador y devuelve sus CUITs operables (él + representados)."""
    try:
        return scraping.listar_representados(datos.cuit, datos.clave)
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
        cont = db.get(models.Contador, datos.cuit)
        if cont is None:
            cont = models.Contador(cuit=datos.cuit, clave_cifrada=cifrar(datos.clave.encode()))
            db.add(cont)
        else:
            cont.clave_cifrada = cifrar(datos.clave.encode())  # refresca por si cambió
        db.commit()
    finally:
        db.close()

    job_id = jobs.crear_job()
    seleccionados = [(s.cuit, s.nombre) for s in datos.seleccionados]
    threading.Thread(
        target=_correr_monitoreo, args=(job_id, datos.cuit, seleccionados, usuario.id), daemon=True
    ).start()
    return {"job_id": job_id}


@router.get("/monitorear/{job_id}", response_model=JobOut)
def progreso_monitoreo(job_id: str, _usuario: models.Usuario = Depends(usuario_actual)):
    job = jobs.obtener(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job no encontrado.")
    return job


def _correr_monitoreo(
    job_id: str, cuit_contador: str, seleccionados: list[tuple], usuario_id: int
) -> None:
    """Por cada cliente: lo registra (asociado al contador) y sincroniza su histórico."""
    total = len(seleccionados)
    for i, (cuit_cliente, nombre) in enumerate(seleccionados):
        base = int(i / total * 100)
        span = 100 / total

        def on_prog(idx: int, n: int, msg: str, _b: int = base, _s: float = span, _i: int = i) -> None:
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
                            cuit_contador=cuit_contador,
                            usuario_id=usuario_id,
                        )
                    )
                else:
                    cli.nombre = nombre
                    cli.cuit_contador = cuit_contador
                    cli.usuario_id = usuario_id
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
        except Exception as e:  # noqa: BLE001
            jobs.agregar_resultado(
                job_id, {"cuit": cuit_cliente, "nombre": nombre, "ok": False, "error": str(e)}
            )

    jobs.actualizar(job_id, estado="terminado", progreso=100, mensaje="Listo")
