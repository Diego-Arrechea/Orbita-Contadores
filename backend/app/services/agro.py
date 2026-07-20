"""Sincronización de las Liquidaciones Electrónicas del sector primario (agro).

Aparte de 'Mis Comprobantes': estas liquidaciones (Hacienda y Carne, Lechería, Tabaco, Azúcar)
NO aparecen ahí — las emite el comprador/acopiador y el productor las recibe. Son la venta real
del cliente y se suman a su facturación. Se traen del servicio LSP (arca/afip.py::lsp_consultar +
lsp_pdf) y se cachea acá. Sync SEMANAL (aparecen rara vez). Ver la memoria `facturacion-agropecuaria`.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..arca import motor
from ..crypto import descifrar


def _parse_fecha(f: str | None) -> dt.date | None:
    """'dd/mm/aaaa' -> date. None/'' -> None."""
    if not f or "/" not in f:
        return None
    try:
        d, m, y = f.split("/")
        return dt.date(int(y), int(m), int(d))
    except (ValueError, TypeError):
        return None


def _upsert(db: Session, cuit: str, crudos: list[dict], con_importe: bool) -> tuple[int, int, int]:
    """Inserta/actualiza las liquidaciones (dedup por liq_id). Devuelve (procesadas, nuevas,
    sin_importe). En modo DETECCIÓN (`con_importe=False`) el importe viene en None: NO se pisa el
    importe ya guardado (una fila existente conserva su valor) y una fila nueva arranca en 0 (se
    llena después con la sync que sí baja el PDF)."""
    ahora = dt.datetime.now(dt.timezone.utc)
    procesadas = nuevas = sin_importe = 0
    for c in crudos:
        liq_id = str(c.get("liq_id") or "")
        if not liq_id:
            continue
        bruto = c.get("importe_bruto")  # None = no se descargó (detección) o el PDF falló
        if con_importe and bruto is None:
            sin_importe += 1  # se pidió el importe pero el PDF no se pudo leer
        existe = db.scalar(
            select(models.LiquidacionAgro).where(
                models.LiquidacionAgro.cuit == cuit,
                models.LiquidacionAgro.liq_id == liq_id,
            )
        )
        campos = dict(
            sector=c.get("sector", "hacienda"),
            direccion=c.get("direccion", "receptor"),
            cbte_tipo=int(c.get("cbte_tipo") or 0),
            tipo_liq=(c.get("tipo_liq") or "")[:80],
            punto_venta=int(c.get("punto_venta") or 0),
            numero=int(c.get("numero") or 0),
            cuit_contraparte=str(c.get("cuit_contraparte") or ""),
            fecha_comprobante=_parse_fecha(c.get("fecha_comprobante")),
            fecha_emision=_parse_fecha(c.get("fecha_emision")),
            sistema=(c.get("sistema") or "")[:4],
            sincronizado_en=ahora,
        )
        if existe:
            for k, v in campos.items():
                setattr(existe, k, v)
            if bruto is not None:  # sólo pisamos el importe si esta corrida lo trajo
                existe.importe_bruto = bruto
        else:
            db.add(
                models.LiquidacionAgro(
                    cuit=cuit, liq_id=liq_id,
                    importe_bruto=bruto if bruto is not None else 0, **campos,
                )
            )
            nuevas += 1
        procesadas += 1
    return procesadas, nuevas, sin_importe


def sincronizar_agro(
    db: Session,
    cuit: str,
    *,
    sector: str = "hacienda",
    marcar_flag: bool = True,
    con_importe: bool = True,
    on_progress=None,
) -> dict:
    """Trae y cachea las liquidaciones del agro del cliente. Devuelve
    {tiene, procesadas, nuevas, sin_importe, total_bruto}.

    `marcar_flag`: si hay liquidaciones, prende `cliente.factura_agro` (útil en la barrida inicial
    de detección; NUNCA lo apaga: un flag puesto a mano por el contador se respeta).
    `con_importe=False`: modo DETECCIÓN (sólo grilla, sin bajar PDFs) → mucho más liviano para no
    gatillar el rate-limit; el importe se llena después con una corrida `con_importe=True`."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        raise ValueError(f"Cliente {cuit} no registrado")
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise ValueError(f"El cliente {cuit} no tiene una credencial con clave guardada")
    clave = descifrar(credencial.clave_cifrada).decode()

    crudos = motor.liquidaciones_agro(
        credencial.cuit, clave, cuit, sector=sector, con_importe=con_importe, on_progress=on_progress
    )
    procesadas, nuevas, sin_importe = _upsert(db, cuit, crudos, con_importe)
    tiene = procesadas > 0
    if tiene and marcar_flag and not cliente.factura_agro:
        cliente.factura_agro = True
    db.commit()

    total_bruto = float(
        db.scalar(
            select(func.coalesce(func.sum(models.LiquidacionAgro.importe_bruto), 0)).where(
                models.LiquidacionAgro.cuit == cuit
            )
        )
        or 0
    )
    return {
        "tiene": tiene,
        "procesadas": procesadas,
        "nuevas": nuevas,
        "sin_importe": sin_importe,
        "total_bruto": total_bruto,
    }


def _total_bruto(db: Session, cuit: str) -> float:
    return float(
        db.scalar(
            select(func.coalesce(func.sum(models.LiquidacionAgro.importe_bruto), 0)).where(
                models.LiquidacionAgro.cuit == cuit
            )
        )
        or 0
    )


def sincronizar_agro_si_corresponde(
    db: Session, cuit: str, *, sector: str = "hacienda", dias: int = 7
) -> dict | None:
    """Mantenimiento SEMANAL de un cliente YA marcado (`factura_agro`): re-sincroniza CON importe si
    pasó `dias` desde la última, o si todavía le faltan los importes (total 0 → recién detectado en
    modo liviano). Devuelve None si no correspondía (no marcado, o ya al día). Estas liquidaciones
    aparecen rara vez, así que la pasada normal es semanal."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None or not cliente.factura_agro:
        return None
    pendiente_importe = _total_bruto(db, cuit) == 0  # detectado liviano pero sin importes aún
    if not pendiente_importe:
        ultima = db.scalar(
            select(func.max(models.LiquidacionAgro.sincronizado_en)).where(
                models.LiquidacionAgro.cuit == cuit
            )
        )
        if ultima is not None:
            if ultima.tzinfo is None:  # Postgres aware; SQLite naive → normalizamos a UTC
                ultima = ultima.replace(tzinfo=dt.timezone.utc)
            if ultima > dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=dias):
                return None  # al día y dentro de la ventana semanal
    # Ya está marcado: no re-evaluamos el flag. CON importe (baja los PDFs, ráfaga aislada).
    return sincronizar_agro(db, cuit, sector=sector, marcar_flag=False, con_importe=True)


# Backoff entre reintentos de la consulta LSP (servicio `serviciosjava2/lsp-web` del agro). ARCA
# rate-limitea ese host por VOLUMEN de IP; el diseño anterior reintentaba la consulta fallida en CADA
# pasada del worker, así que la detección pendiente de toda la cartera (cientos de clientes que nunca
# llegaban a marcarse "chequeado" porque la consulta fallaba) martillaba el servicio y mantenía el
# bloqueo permanente → los agropecuarios legítimos nunca bajaban sus liquidaciones. El backoff corta
# ese bucle: un intento fallido no se reintenta hasta pasado el cooldown, bajando el volumen por debajo
# del umbral del WAF. Marcados (el contador los espera) reintentan diario; la detección masiva, semanal.
COOLDOWN_MARCADO = dt.timedelta(days=1)
COOLDOWN_DETECCION = dt.timedelta(days=7)


def _en_cooldown(ultimo: dt.datetime | None, ahora: dt.datetime, ventana: dt.timedelta) -> bool:
    """True si `ultimo` (última consulta LSP, éxito o fallo) cae dentro de `ventana` desde `ahora`."""
    if ultimo is None:
        return False
    if ultimo.tzinfo is None:  # Postgres aware; SQLite naive → normalizamos a UTC
        ultimo = ultimo.replace(tzinfo=dt.timezone.utc)
    return ultimo > ahora - ventana


def paso_worker(db: Session, cuit: str, *, sector: str = "hacienda") -> dict | None:
    """Entrada del motor 24/7 para el agro: DETECCIÓN GRADUAL + mantenimiento, repartido en el ciclo
    normal (reemplaza la barrida masiva, que gatillaba el rate-limit del WAF de ARCA).

    Todo intento de consulta LSP sella `agro_ultimo_intento` (éxito o fallo) y respeta un cooldown
    (ver COOLDOWN_*): así un fallo por bloqueo de ARCA NO se reintenta en la próxima pasada sino recién
    pasado el cooldown. Esto evita que la detección pendiente de toda la cartera martille el servicio y
    lo mantenga bloqueado (era la causa de que los agropecuarios legítimos no bajaran sus liquidaciones).

    - Cliente marcado (`factura_agro`) → mantenimiento (sincronizar_agro_si_corresponde). Si todavía le
      faltan los importes (total 0) reintenta como mucho cada COOLDOWN_MARCADO (antes: cada pasada).
    - Nunca chequeado (`agro_chequeado_en` NULL) → DETECCIÓN una vez, LIVIANA (sólo grilla, sin PDFs).
      Marca la fecha SÓLO si salió bien; si falla, queda NULL pero no se reintenta hasta COOLDOWN_DETECCION.
    - Ya chequeado y sin liquidaciones → no hace nada (no vuelve a chequear).
    """
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None:
        return None
    ahora = dt.datetime.now(dt.timezone.utc)

    if cliente.factura_agro:
        # Marcado: mantenimiento. Mientras siga sin importes (total 0) el mantenimiento reintenta en
        # cada pasada → bajo bloqueo eso martilla; backoff diario. Con importes ya al día, el gate
        # semanal de sincronizar_agro_si_corresponde manda (no lo tocamos).
        if _total_bruto(db, cuit) == 0 and _en_cooldown(cliente.agro_ultimo_intento, ahora, COOLDOWN_MARCADO):
            return None
        cliente.agro_ultimo_intento = ahora
        db.commit()
        return sincronizar_agro_si_corresponde(db, cuit, sector=sector)

    if cliente.agro_chequeado_en is not None:
        return None  # ya se chequeó y no es agropecuario
    # Detección liviana. Backoff: no reintentar la detección hasta pasado el cooldown (el reintento en
    # cada pasada de toda la cartera pendiente era lo que auto-gatillaba el bloqueo de ARCA).
    if _en_cooldown(cliente.agro_ultimo_intento, ahora, COOLDOWN_DETECCION):
        return None
    cliente.agro_ultimo_intento = ahora
    db.commit()
    # Si sincronizar_agro levanta (bloqueo/ARCA), NO marcamos chequeado → reintenta pasado el cooldown.
    res = sincronizar_agro(db, cuit, sector=sector, marcar_flag=True, con_importe=False)
    cliente.agro_chequeado_en = ahora
    db.commit()
    return res
