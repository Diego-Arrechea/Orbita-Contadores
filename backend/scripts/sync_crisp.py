"""
sync_crisp.py — crea en Crisp el contacto de TODOS los contadores que ya están en la base.

Sirve para poblar el CRM de Crisp con las cuentas existentes (las que se dieron de alta antes
de conectar Crisp). De ahí en más, cada registro nuevo ya crea su contacto solo (ver
app/routers/auth.py → crisp.intentar_sincronizar). Es idempotente: correrlo de nuevo no duplica
contactos (los que ya existen se completan, no se recrean).

    cd backend
    .venv\\Scripts\\python -m scripts.sync_crisp

Requiere las credenciales de Crisp en backend/.env (CRISP_WEBSITE_ID, CRISP_TOKEN_IDENTIFIER,
CRISP_TOKEN_KEY). Si no están, el script avisa y no hace nada.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from app import models
from app.db import SessionLocal
from app.services import crisp

# La consola de Windows suele venir en cp1252 y no traga emojis (✅/❌); forzamos UTF-8 para que
# los prints no rompan (no afecta nada más).
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # pragma: no cover
    pass


def main() -> None:
    if not crisp._configurado():
        raise SystemExit(
            "Crisp no está configurado: completá CRISP_WEBSITE_ID, CRISP_TOKEN_IDENTIFIER y "
            "CRISP_TOKEN_KEY en backend/.env (ver .env.example) y volvé a correr."
        )

    db = SessionLocal()
    try:
        usuarios = list(db.scalars(select(models.Usuario).order_by(models.Usuario.id)))
        if not usuarios:
            print("No hay usuarios en la base. Nada para sincronizar.")
            return

        print(f"Sincronizando {len(usuarios)} contacto(s) con Crisp...\n")
        creados = existentes = fallidos = 0
        for u in usuarios:
            try:
                estado = crisp.sincronizar_contacto(u)
                marca = {"creado": "✅ creado   ", "ya_existia": "• ya existía"}.get(estado, estado)
                print(f"  {marca}  {u.email} — {u.nombre} {u.apellido} · {u.estudio}")
                creados += estado == "creado"
                existentes += estado == "ya_existia"
            except Exception as e:  # noqa: BLE001 — seguimos con el resto y reportamos al final
                fallidos += 1
                print(f"  ❌ FALLÓ     {u.email}: {e}")

        print(f"\nListo: {creados} creado(s), {existentes} ya existía(n), {fallidos} con error.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
