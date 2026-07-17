"""
probar_actividades.py — trae del padrón las ACTIVIDADES declaradas de un cliente y las imprime.

Sirve para verificar (en desarrollo) el extractor de actividades: corre la sync de padrón del CUIT
—que loguea con la clave del cliente y lee /portal/api/persona— y muestra qué actividades salieron.
Como la sync de padrón persiste, tras correrlo la ficha del cliente ("Situación actual") ya muestra
la tarjeta "Actividades declaradas".

    cd backend
    .venv\\Scripts\\python -m scripts.probar_actividades <cuit>

Si NO salieron actividades, el extractor deja en el log de `afip.<cuit>` una línea con las claves del
payload ("actividades: sin lista en el payload de persona (claves: [...])"): con esas claves se ajusta
el nombre del campo en afip.py::actividades. Necesita que el cliente tenga su clave fiscal cargada.
"""
from __future__ import annotations

import logging
import sys

from app import models
from app.db import SessionLocal, asegurar_columnas
from app.services import sincronizacion


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python -m scripts.probar_actividades <cuit>")
    cuit = "".join(c for c in sys.argv[1] if c.isdigit())
    if len(cuit) != 11:
        raise SystemExit(f"CUIT inválido: {sys.argv[1]!r} (tienen que ser 11 dígitos).")

    # Mostrar el log del extractor (INFO) en la consola: incluye la línea con las claves del payload
    # cuando no encuentra la lista, que es lo que sirve para ajustar el nombre del campo.
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")

    # Se corre standalone (sin arrancar la app): aseguramos la columna nueva `actividades_json` por si
    # este es el primer contacto con la DB de dev (main.py corre esto al levantar el backend; acá no).
    asegurar_columnas()

    db = SessionLocal()
    try:
        cliente = db.get(models.ClienteARCA, cuit)
        if cliente is None:
            raise SystemExit(f"No hay ningún cliente con CUIT {cuit} en la base.")
        print(f"Cliente: {cliente.nombre} ({cuit})")
        print("Trayendo el padrón (login + /persona)…\n")

        datos = sincronizacion.sincronizar_padron(db, cuit)
        actividades = datos.get("actividades") or []

        if not actividades:
            print("\n⚠️  No salieron actividades. Mirá el log de arriba: si dice 'sin lista en el "
                  "payload (claves: [...])', esas son las claves reales → ajustar afip.py::actividades.")
            return
        print(f"\n✅ {len(actividades)} actividad(es) declarada(s):")
        for i, a in enumerate(actividades):
            principal = " (principal)" if i == 0 else ""
            codigo = a.get("codigo") or "—"
            desc = a.get("descripcion") or "—"
            periodo = f" · desde {a['periodo']}" if a.get("periodo") else ""
            print(f"  [{codigo}]{principal} {desc}{periodo}")
        print("\nGuardado en la base. Abrí la ficha del cliente → 'Situación actual' para verla.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
