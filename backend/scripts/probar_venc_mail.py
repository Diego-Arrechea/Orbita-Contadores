"""Envía un mail de PRUEBA del recordatorio de vencimiento a una casilla, para ver cómo llega REAL.

No toca la base: arma un cliente de ejemplo y manda el mail con el mismo builder que usa el job.

Uso (desde backend/, con el venv):
  1) Configurá SMTP en backend/.env (o export en el entorno):
     SMTP_HOST=smtp.gmail.com  SMTP_PORT=587
     SMTP_USER=orbitaglobalclientes@gmail.com  SMTP_PASSWORD=<app-password>
     SMTP_FROM="Órbita <orbitaglobalclientes@gmail.com>"
  2) Corré:
     .venv/Scripts/python.exe scripts/probar_venc_mail.py ulises25103@gmail.com

Podés pasar --solo-fecha para ver la versión degradada (sin importe).
"""
from __future__ import annotations

import datetime as dt
import sys

from app import models
from app.config import settings
from app.services import vencimientos as v


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    destino = args[0] if args else "ulises25103@gmail.com"
    fresco = "--solo-fecha" not in sys.argv  # con importe salvo que se pida degradado

    if not (settings.smtp_host and settings.smtp_user):
        print(
            "SMTP sin configurar. Seteá SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM en\n"
            "backend/.env (o en el entorno) y volvé a correr. No se envió nada."
        )
        return

    cliente = models.ClienteARCA(
        cuit="20111111112",
        nombre="Juan Pérez",
        prox_venc_fecha="20/07/2026",
        prox_venc_importe=32500,
        email_cliente=destino,
    )
    armado = v.armar_mail(cliente, dt.date.today(), fresco)
    if armado is None:
        print("El cliente de ejemplo no tiene vencimiento; nada para enviar.")
        return
    asunto, html, texto = armado
    ok = v.email_svc.enviar_email(destino, asunto, html, texto)
    print(f"Enviado={ok} → {destino}\nAsunto: {asunto}\n\n{texto}")


if __name__ == "__main__":
    main()
