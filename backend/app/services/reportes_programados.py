"""Envíos programados del reporte por mail (pedido de un contador, 8-oct-2026).

Una programación manda el reporte a uno o varios clientes (cada uno recibe el suyo, a su mail) una
vez en una fecha y hora, o repetido: todos los meses un día, o todas las semanas un día, a una hora
(hora de Argentina). El worker (`worker/loop._quizas_reportes`) la procesa cada minuto: arma el
reporte con los datos de ese momento (services/reporte_auto.py, espejo de la pantalla) y lo manda
igual que "Enviar ahora" (services/reporte_mail.py).

Antes de mandar se "reclama" la programación (se corre `proximo_envio` y se confirma): si el worker
se corta a mitad de un envío, como mucho falta algún mail; nunca sale dos veces el mismo.
"""
from __future__ import annotations

import calendar
import datetime as dt
import json
import logging
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..security import ids_cartera, usuario_puede
from . import demo as demo_svc
from . import reporte_auto, reporte_mail

log = logging.getLogger("orbita.reportes_programados")

TZ_AR = reporte_auto.TZ_AR
MAX_CLIENTES = 100
FRECUENCIAS = ("unica", "mensual", "semanal")
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_HORA_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ProgramacionInvalida(ValueError):
    """Datos de la programación que no corresponden (el mensaje es para el contador)."""


def _en_ar(fecha: dt.date, hora: str) -> dt.datetime:
    h, m = (int(x) for x in hora.split(":"))
    return dt.datetime(fecha.year, fecha.month, fecha.day, h, m, tzinfo=TZ_AR)


def proximo_envio(
    *, frecuencia: str, hora: str, fecha: str | None, dia_mes: int | None, dia_semana: int | None,
    despues: dt.datetime,
) -> dt.datetime | None:
    """Primer envío estrictamente posterior a `despues` (None = no hay más)."""
    base = despues.astimezone(TZ_AR)
    if frecuencia == "unica":
        cuando = _en_ar(dt.date.fromisoformat(fecha), hora)
        return cuando if cuando > despues else None
    if frecuencia == "mensual":
        y, m = base.year, base.month
        for _ in range(14):
            dia = min(dia_mes, calendar.monthrange(y, m)[1])  # 31 / 30 en febrero → último día
            cuando = _en_ar(dt.date(y, m, dia), hora)
            if cuando > despues:
                return cuando
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        return None
    if frecuencia == "semanal":
        d = base.date()
        for i in range(8):
            dia = d + dt.timedelta(days=i)
            if dia.weekday() == dia_semana:
                cuando = _en_ar(dia, hora)
                if cuando > despues:
                    return cuando
        return None
    return None


def validar(db: Session, usuario: models.Usuario, datos: dict) -> dict:
    """Normaliza y valida lo que manda el front. Devuelve los campos listos para guardar."""
    frecuencia = datos.get("frecuencia")
    if frecuencia not in FRECUENCIAS:
        raise ProgramacionInvalida("Elegí cada cuánto se envía.")
    hora = str(datos.get("hora") or "")
    if not _HORA_RE.match(hora):
        raise ProgramacionInvalida("La hora no es válida.")
    fecha = dia_mes = dia_semana = None
    if frecuencia == "unica":
        try:
            fecha = dt.date.fromisoformat(str(datos.get("fecha") or "")).isoformat()
        except ValueError:
            raise ProgramacionInvalida("Elegí la fecha del envío.")
    elif frecuencia == "mensual":
        dia_mes = datos.get("dia_mes")
        if not isinstance(dia_mes, int) or not 1 <= dia_mes <= 31:
            raise ProgramacionInvalida("Elegí el día del mes.")
    else:
        dia_semana = datos.get("dia_semana")
        if not isinstance(dia_semana, int) or not 0 <= dia_semana <= 6:
            raise ProgramacionInvalida("Elegí el día de la semana.")
    destinos_in = datos.get("destinos") or []
    if not destinos_in:
        raise ProgramacionInvalida("Agregá al menos un cliente.")
    if len(destinos_in) > MAX_CLIENTES:
        raise ProgramacionInvalida(f"Un envío puede tener hasta {MAX_CLIENTES} clientes.")
    cartera = set(ids_cartera(db, usuario))
    destinos, vistos = [], set()
    for d in destinos_in:
        cuit = "".join(ch for ch in str(d.get("cuit") or "") if ch.isdigit())
        destino = str(d.get("destino") or "").strip()
        cliente = db.get(models.ClienteARCA, cuit) if cuit else None
        if cliente is None or cliente.usuario_id not in cartera:
            raise ProgramacionInvalida("Uno de los clientes no está en tu cartera.")
        if not _EMAIL_RE.match(destino) or len(destino) > 200:
            raise ProgramacionInvalida(f"Revisá el mail de {cliente.nombre}.")
        if cuit in vistos:
            continue
        vistos.add(cuit)
        destinos.append({"cuit": cuit, "destino": destino})
    campos = {
        "frecuencia": frecuencia, "hora": hora, "fecha": fecha, "dia_mes": dia_mes,
        "dia_semana": dia_semana,
    }
    proximo = proximo_envio(**campos, despues=dt.datetime.now(dt.timezone.utc))
    if proximo is None:
        raise ProgramacionInvalida("La fecha y hora del envío ya pasaron.")
    mensaje = str(datos.get("mensaje") or "")[:4000]
    return {
        **campos,
        "destinos_json": json.dumps(destinos, ensure_ascii=False),
        "mensaje": mensaje,
        "copia_a_mi": bool(datos.get("copia_a_mi", True)),
        "proximo_envio": proximo,
    }


def serializar(db: Session, p: models.ReporteProgramado) -> dict:
    destinos = json.loads(p.destinos_json or "[]")
    nombres = {
        c.cuit: c.nombre
        for c in db.scalars(
            select(models.ClienteARCA).where(models.ClienteARCA.cuit.in_([d["cuit"] for d in destinos]))
        )
    }
    iso = lambda x: x.astimezone(dt.timezone.utc).isoformat() if x else None  # noqa: E731
    return {
        "id": p.id,
        "frecuencia": p.frecuencia,
        "fecha": p.fecha,
        "hora": p.hora,
        "dia_mes": p.dia_mes,
        "dia_semana": p.dia_semana,
        "destinos": [{**d, "nombre": nombres.get(d["cuit"], d["cuit"])} for d in destinos],
        "mensaje": p.mensaje or "",
        "copia_a_mi": p.copia_a_mi,
        "activo": p.activo,
        "proximo_envio": iso(p.proximo_envio),
        "ultimo_envio_en": iso(p.ultimo_envio_en),
        "ultimo_resultado": json.loads(p.ultimo_resultado_json) if p.ultimo_resultado_json else None,
        "creado_en": iso(p.creado_en),
    }


def _enviar_uno(db: Session, usuario: models.Usuario, cartera: set[int], d: dict, p: models.ReporteProgramado) -> dict:
    cliente = db.get(models.ClienteARCA, d["cuit"])
    res = {"cuit": d["cuit"], "nombre": cliente.nombre if cliente else d["cuit"], "destino": d["destino"]}
    if cliente is None or cliente.usuario_id not in cartera:
        return {**res, "ok": False, "error": "El cliente ya no está en la cartera."}
    try:
        mail = reporte_auto.armar_reporte(
            db, usuario, cliente,
            observaciones=p.mensaje or "",
            estudio=usuario.estudio or "Tu estudio contable",
            incluir_movimientos=usuario_puede(db, usuario, "conciliacion"),
        )
        enviado = reporte_mail.enviar(
            usuario=usuario, cliente=cliente, destino=d["destino"], copia_a_mi=p.copia_a_mi,
            asunto=mail["asunto"], html=mail["html"], texto=mail["texto"], limitar=False,
        )
    except Exception as e:  # noqa: BLE001 — un cliente con problemas no frena al resto
        log.warning("reporte programado %s, cliente %s: %s", p.id, d["cuit"], e, exc_info=True)
        return {**res, "ok": False, "error": "No se pudo armar o enviar el reporte."}
    if not enviado:
        return {**res, "ok": False, "error": "El servidor de correo no aceptó el mail."}
    cliente.reporte_enviado_en = dt.datetime.now(dt.timezone.utc)
    cliente.reporte_enviado_a = d["destino"]
    db.commit()
    return {**res, "ok": True, "error": None}


def procesar_pendientes(db: Session, ahora: dt.datetime | None = None, limite: int = 20) -> dict:
    """Manda las programaciones vencidas. Lo llama el worker cada minuto."""
    ahora = ahora or dt.datetime.now(dt.timezone.utc)
    resumen = {"programaciones": 0, "enviados": 0, "fallidos": 0}
    pendientes = db.scalars(
        select(models.ReporteProgramado)
        .where(
            models.ReporteProgramado.activo.is_(True),
            models.ReporteProgramado.proximo_envio.is_not(None),
            models.ReporteProgramado.proximo_envio <= ahora,
        )
        .order_by(models.ReporteProgramado.proximo_envio)
        .limit(limite)
        .with_for_update(skip_locked=True)
    ).all()
    # Reclamar: correr el próximo envío ANTES de mandar (ver docstring del módulo).
    for p in pendientes:
        siguiente = proximo_envio(
            frecuencia=p.frecuencia, hora=p.hora, fecha=p.fecha, dia_mes=p.dia_mes,
            dia_semana=p.dia_semana, despues=max(ahora, p.proximo_envio),
        )
        p.proximo_envio = siguiente
        if siguiente is None:
            p.activo = False
    db.commit()
    for p in pendientes:
        usuario = db.get(models.Usuario, p.usuario_id)
        destinos = json.loads(p.destinos_json or "[]")
        if usuario is None or not usuario.activo or demo_svc.es_demo(db, usuario):
            resultado = [
                {**d, "nombre": d["cuit"], "ok": False, "error": "La cuenta no puede enviar reportes."}
                for d in destinos
            ]
        else:
            cartera = set(ids_cartera(db, usuario))
            resultado = [_enviar_uno(db, usuario, cartera, d, p) for d in destinos]
        p.ultimo_envio_en = dt.datetime.now(dt.timezone.utc)
        p.ultimo_resultado_json = json.dumps(resultado, ensure_ascii=False)
        db.commit()
        resumen["programaciones"] += 1
        resumen["enviados"] += sum(1 for r in resultado if r["ok"])
        resumen["fallidos"] += sum(1 for r in resultado if not r["ok"])
    return resumen
