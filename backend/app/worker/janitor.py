"""Limpieza de perfiles temporales de Chromium. Cada scrape crea un `mkdtemp(prefix="orbita_mc_"/
"orbita_mt_")` y lo borra al terminar; si el proceso crashea, el perfil queda. El janitor barre los
que tengan más de una hora (ninguna sync dura tanto) para que no se acumule disco en el contenedor."""
from __future__ import annotations

import shutil
import tempfile
import time
from pathlib import Path

PREFIJOS = ("orbita_mc_", "orbita_mt_")
EDAD_MIN_SEG = 3600  # sólo borra perfiles de más de 1h (no toca uno en uso)


def limpiar_perfiles_viejos() -> int:
    """Borra los perfiles temporales huérfanos. Devuelve cuántos eliminó."""
    raiz = Path(tempfile.gettempdir())
    ahora = time.time()
    borrados = 0
    for prefijo in PREFIJOS:
        for d in raiz.glob(f"{prefijo}*"):
            try:
                if d.is_dir() and ahora - d.stat().st_mtime > EDAD_MIN_SEG:
                    shutil.rmtree(d, ignore_errors=True)
                    borrados += 1
            except OSError:
                pass  # desapareció o sin permiso: lo ignoramos
    return borrados
