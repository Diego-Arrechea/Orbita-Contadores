"""App FastAPI: CORS para el front + router de clientes. Crea las tablas al iniciar."""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401 — registra los modelos para create_all
from .config import settings
from .db import Base, asegurar_columnas, engine
from .routers import (
    admin,
    admin_sync,
    auth,
    clientes,
    configuracion,
    contabilidad,
    equipo,
    facturacion,
    indicadores,
    iva,
    movimientos,
    notificaciones,
    onboarding,
    suscripciones,
    vencimientos,
)
from .services.scheduler import detener_scheduler, iniciar_scheduler

Base.metadata.create_all(bind=engine)
asegurar_columnas()  # migración ligera: agrega columnas nuevas a tablas existentes


def refrescar_escala_monotributo() -> None:
    """Deja la escala del monotributo en la vigente. Corre en un hilo aparte al levantar la app: si
    la tabla pública no responde, quedan los valores de referencia y no se demora el arranque."""
    try:
        from .data.categorias import aplicar_montos_oficiales
        from .services.categorias_afip import montos_categorias

        if aplicar_montos_oficiales(montos_categorias()):
            from .data.categorias import CATEGORIAS

            logging.getLogger("orbita").info(
                "Escala del monotributo actualizada (tope Cat. A $%s)", f"{CATEGORIAS[0].tope_anual:,.0f}"
            )
    except Exception:  # noqa: BLE001 — sin escala vigente seguimos con la de referencia
        logging.getLogger("orbita").warning("No se pudo actualizar la escala del monotributo", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # El sync continuo lo hace el contenedor worker (app/worker). El scheduler diario in-process
    # queda apagado por defecto para no duplicar el trabajo; se puede reactivar con SCHEDULER_ENABLED.
    threading.Thread(target=refrescar_escala_monotributo, daemon=True).start()
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
    # Para que el front pueda leer la marca de "esta sesión ya no sirve" (ver security.py).
    expose_headers=["X-Orbita-Sesion"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(admin_sync.router)
app.include_router(clientes.router)
app.include_router(configuracion.router)
app.include_router(contabilidad.router)
app.include_router(equipo.router)
app.include_router(facturacion.router)
app.include_router(indicadores.router)
app.include_router(iva.router)
app.include_router(movimientos.router)
app.include_router(notificaciones.router)
app.include_router(onboarding.router)
app.include_router(suscripciones.router)
app.include_router(suscripciones.router_admin)
app.include_router(vencimientos.router)


@app.get("/")
def root():
    return {"ok": True, "servicio": "orbita-backend"}
