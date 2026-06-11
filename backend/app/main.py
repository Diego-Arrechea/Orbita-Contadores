"""App FastAPI: CORS para el front + router de clientes. Crea las tablas al iniciar."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401 — registra los modelos para create_all
from .config import settings
from .db import Base, asegurar_columnas, engine
from .routers import (
    admin,
    auth,
    clientes,
    configuracion,
    movimientos,
    notificaciones,
    onboarding,
)
from .services.scheduler import detener_scheduler, iniciar_scheduler

Base.metadata.create_all(bind=engine)
asegurar_columnas()  # migración ligera: agrega columnas nuevas a tablas existentes


@asynccontextmanager
async def lifespan(app: FastAPI):
    # El sync continuo lo hace el contenedor worker (app/worker). El scheduler diario in-process
    # queda apagado por defecto para no duplicar el trabajo; se puede reactivar con SCHEDULER_ENABLED.
    if settings.scheduler_enabled:
        iniciar_scheduler(settings.sync_hour)
    yield
    detener_scheduler()


app = FastAPI(title="Órbita Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # dominios de producción (CORS_ORIGINS en .env)
    allow_origin_regex=r"http://localhost:\d+",  # cualquier puerto local (Vite usa 5173/5174)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(clientes.router)
app.include_router(configuracion.router)
app.include_router(movimientos.router)
app.include_router(notificaciones.router)
app.include_router(onboarding.router)


@app.get("/")
def root():
    return {"ok": True, "servicio": "orbita-backend"}
