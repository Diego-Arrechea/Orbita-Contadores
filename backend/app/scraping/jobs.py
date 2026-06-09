"""Registro en memoria de jobs de monitoreo (bootstrap de certs). Thread-safe.

MVP: los jobs viven en memoria (se pierden si el backend reinicia). Suficiente para el flujo
de onboarding, que es de corta vida.
"""
from __future__ import annotations

import threading
import uuid

_lock = threading.Lock()
_jobs: dict[str, dict] = {}


def crear_job() -> str:
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {
            "estado": "en_proceso",  # en_proceso | terminado | error
            "progreso": 0,
            "mensaje": "Iniciando…",
            "resultados": [],  # [{cuit, nombre, ok, error?}]
            "error": None,
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


def obtener(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
