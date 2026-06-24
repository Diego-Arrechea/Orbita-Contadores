"""Registro en memoria de jobs de monitoreo (bootstrap de certs). Thread-safe.

MVP: los jobs viven en memoria (se pierden si el backend reinicia). Suficiente para el flujo
de onboarding, que es de corta vida.
"""
from __future__ import annotations

import threading
import uuid

_lock = threading.Lock()
_jobs: dict[str, dict] = {}


def crear_job(usuario_id: int | None = None) -> str:
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {
            "estado": "en_proceso",  # en_proceso | terminado | error | cancelado
            "progreso": 0,
            "mensaje": "Iniciando…",
            "resultados": [],  # [{cuit, nombre, ok, error?}]
            "error": None,
            "usuario_id": usuario_id,  # dueño del job (para validar quién puede cancelarlo)
            "cancelado": False,  # lo prende el contador; el worker lo chequea y aborta
        }
    return job_id


def actualizar(job_id: str, **campos) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(campos)


def agregar_resultado(job_id: str, resultado: dict) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id]["resultados"].append(resultado)


def cancelar(job_id: str) -> None:
    """Marca el job para cancelar. El worker lo chequea en sus checkpoints y aborta."""
    with _lock:
        if job_id in _jobs:
            _jobs[job_id]["cancelado"] = True


def esta_cancelado(job_id: str) -> bool:
    with _lock:
        job = _jobs.get(job_id)
        return bool(job and job.get("cancelado"))


def obtener(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
