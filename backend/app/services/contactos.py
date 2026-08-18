"""Mail de contacto del cliente FINAL: quién puede usarse y quién no.

El mail que un contribuyente tiene registrado muchas veces NO es suyo, sino el del ESTUDIO que le
hace los trámites. Medido sobre un estudio real de la cartera: 7 de sus 12 clientes tenían registrado
el mismo mail con el que el contador entra a Órbita. Usar ese dato para el recordatorio de
vencimientos sería avisarle al contador del vencimiento de su propio cliente, así que un mail sólo se
toma como contacto cuando es plausiblemente DEL CLIENTE:

  - no es el mail de acceso de ningún usuario de Órbita, y
  - no se repite entre los clientes del mismo estudio (si figura en dos fichas, es de un tercero).

El que no pasa el filtro no se guarda: ese cliente queda sin mail y el contador lo carga a mano (en
la ficha o por el import masivo). Lo que cargó el contador NO se pisa nunca.

La regla se evalúa sobre TODO el estudio junto (`recalcular_estudio`), no cliente por cliente: un
mail parece propio hasta que aparece en un segundo cliente, y ahí hay que sacarlo también del primero.
"""

from __future__ import annotations

import json
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models

# Marca de quién completó `email_cliente`. 'padron' = lo eligió la sincronización (recalculable);
# NULL con mail cargado = lo puso el contador a mano y es intocable.
ORIGEN_PADRON = "padron"


def candidatos(cliente: models.ClienteARCA) -> list[str]:
    """Mails registrados del cliente (normalizados, sin repetidos, en el orden en que vinieron)."""
    try:
        datos = json.loads(cliente.emails_padron_json or "[]")
    except ValueError:
        return []
    out: list[str] = []
    for e in datos if isinstance(datos, list) else []:
        mail = str(e).strip().lower()
        if "@" in mail and mail not in out:
            out.append(mail)
    return out


def _mails_de_usuarios(db: Session) -> set[str]:
    """Mails de acceso de los usuarios de Órbita (contadores y empleados): nunca son del cliente."""
    return {
        (e or "").strip().lower()
        for e in db.execute(select(models.Usuario.email)).scalars().all()
        if e
    }


def recalcular_estudio(db: Session, usuario_id: int | None) -> int:
    """Reevalúa el contacto de TODOS los clientes de un estudio y devuelve cuántos cambiaron.

    Es idempotente y se corrige sola: si un mail que parecía propio aparece después en otro cliente,
    esta pasada se lo saca a los dos. NO commitea (lo hace el caller, dentro de su transacción)."""
    if usuario_id is None:
        return 0
    clientes = (
        db.execute(select(models.ClienteARCA).where(models.ClienteARCA.usuario_id == usuario_id))
        .scalars()
        .all()
    )
    vetados = _mails_de_usuarios(db)
    # En cuántos clientes del estudio figura cada mail (una vez por cliente, aunque lo repita).
    veces = Counter(mail for c in clientes for mail in set(candidatos(c)))

    cambios = 0
    for c in clientes:
        # Lo cargado por el contador manda: acá sólo se toca lo que puso la sincronización.
        if c.email_cliente and c.email_cliente_origen != ORIGEN_PADRON:
            continue
        elegido = next((m for m in candidatos(c) if m not in vetados and veces[m] == 1), None)
        if (c.email_cliente or None) == elegido:
            continue
        c.email_cliente = elegido
        c.email_cliente_origen = ORIGEN_PADRON if elegido else None
        cambios += 1
    return cambios
