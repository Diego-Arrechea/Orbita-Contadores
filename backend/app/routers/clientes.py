"""Endpoints de clientes y sus comprobantes (protegidos: cada contador ve sólo lo suyo)."""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import case, delete, distinct, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..crypto import cifrar, descifrar
from ..db import SessionLocal, get_db
from ..schemas import (
    TIPOS_NOTA_CREDITO,
    ClaveClienteIn,
    ClienteOut,
    ComprobanteManualIn,
    ComprobanteOut,
    ComunicacionOut,
    EdicionClienteIn,
    EstadoClienteIn,
    ExtraccionOut,
    HistorialMesOut,
    JobOut,
    LiquidacionAgroOut,
    LiquidacionesAgroOut,
    RemuneracionMesOut,
    RemuneracionOut,
    clasificar_regimen,
    nombre_tipo,
    resolver_regimen,
)
from ..scraping import jobs
from ..security import ids_cartera, requiere_permiso, usuario_actual
from ..services import comunicaciones as comunicaciones_svc
from ..services import sincronizacion
from ..services.scheduler import estado_scheduler

router = APIRouter(prefix="/api", tags=["clientes"])
log = logging.getLogger("orbita.clientes")


def _iso_utc(d: dt.datetime) -> str:
    """Serializa un timestamp marcándolo como UTC. SQLite guarda func.now() (=CURRENT_TIMESTAMP)
    en UTC pero lo devuelve naive (sin tz); sin el offset, el front lo interpreta como hora local
    y muestra 3 h de más. Le pegamos UTC para que `new Date()` lo convierta a la hora del contador."""
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.isoformat()


def _inicio_ventana_12m(meses: int = 12) -> dt.date:
    """Primer día del primer mes de una ventana de `meses` meses calendario que termina este mes (12
    por defecto = la que usa la lista/front). La ficha pide MÁS meses para poder evaluar la
    recategorización sobre períodos semestrales anteriores (que empiezan antes de los últimos 12)."""
    hoy = dt.date.today()
    primer_mes_idx = hoy.year * 12 + (hoy.month - 1) - (meses - 1)
    return dt.date(primer_mes_idx // 12, primer_mes_idx % 12 + 1, 1)


def _mes_expr(db: Session):
    """Expresión SQL que agrupa la fecha del comprobante como 'YYYY-MM', según el motor de la
    conexión (Postgres en prod, SQLite en dev): no hay una función de fecha portable entre ambos."""
    col = models.ComprobanteEmitido.fecha
    if db.get_bind().dialect.name == "postgresql":
        return func.to_char(col, "YYYY-MM")
    return func.strftime("%Y-%m", col)


def datos_cartera(
    db: Session, clientes: list[models.ClienteARCA], meses_historial: int = 12
) -> dict[str, dict]:
    """Precalcula, en ~5 queries para TODA la lista, lo que construir_cliente_out necesita por
    cliente: historial 12m agregado por mes, si tiene comprobantes, los tipos emitidos, la última
    extracción y la facturación agro. Antes esto eran 4-5 queries POR cliente (y los comprobantes
    crudos del año viajaban a Python para sumarse acá): la lista tardaba proporcional a
    clientes × comprobantes. Las Notas de Crédito se RESTAN del mes (idéntico criterio al front)."""
    datos: dict[str, dict] = {
        c.cuit: {"historial": [], "tiene": False, "tipos": set(), "ult": None, "agro": (0.0, 0.0)}
        for c in clientes
    }
    cuits = list(datos)
    if not cuits:
        return datos
    desde = _inicio_ventana_12m(meses_historial)
    comp = models.ComprobanteEmitido
    mes = _mes_expr(db).label("mes")
    es_nc = comp.cbte_tipo.in_(TIPOS_NOTA_CREDITO)
    # Historial 12m: la DB devuelve a lo sumo 12 meses × 2 direcciones por cliente, ya sumados.
    filas = db.execute(
        select(
            comp.cuit,
            mes,
            comp.direccion,
            func.sum(case((es_nc, comp.imp_total), else_=0)).label("nc"),
            func.sum(case((es_nc, 0), else_=comp.imp_total)).label("resto"),
        )
        .where(comp.cuit.in_(cuits), comp.fecha >= desde)
        .group_by(comp.cuit, mes, comp.direccion)
    ).all()
    por_cliente: dict[str, dict[str, dict[str, float]]] = {}
    for cuit, mes_s, direccion, nc, resto in filas:
        e = por_cliente.setdefault(cuit, {}).setdefault(
            mes_s, {"brutas": 0.0, "nc": 0.0, "recibidas": 0.0, "ncRecibidas": 0.0}
        )
        if direccion == "emitido":
            e["nc"] += float(nc or 0)
            e["brutas"] += float(resto or 0)
        elif direccion == "recibido":
            e["ncRecibidas"] += float(nc or 0)
            e["recibidas"] += float(resto or 0)
    for cuit, meses in por_cliente.items():
        datos[cuit]["historial"] = [
            HistorialMesOut(
                mes=m,
                emitidasBrutas=e["brutas"],
                notasCredito=e["nc"],
                emitidasNetas=e["brutas"] - e["nc"],
                recibidas=e["recibidas"] - e["ncRecibidas"],
                recibidasComputables=e["recibidas"] - e["ncRecibidas"],
            )
            for m, e in sorted(meses.items())
        ]
    # ¿Hay AL MENOS un comprobante? (independiente de la ventana, para el semáforo 'sin datos').
    for cuit in db.scalars(select(distinct(comp.cuit)).where(comp.cuit.in_(cuits))):
        datos[cuit]["tiene"] = True
    # Tipos de comprobante emitidos (alimenta la inferencia de régimen).
    for cuit, tipo in db.execute(
        select(comp.cuit, comp.cbte_tipo)
        .where(comp.cuit.in_(cuits), comp.direccion == "emitido")
        .distinct()
    ):
        datos[cuit]["tipos"].add(tipo)
    # Última extracción de cada cliente: una sola query con función de ventana (Postgres y
    # SQLite ≥3.25) en vez de un ORDER BY ... LIMIT 1 por cliente.
    ext = models.Extraccion
    rn = (
        func.row_number()
        .over(partition_by=ext.cuit, order_by=(ext.fecha.desc(), ext.id.desc()))
        .label("rn")
    )
    sub = select(ext.cuit, ext.fecha, ext.resultado, ext.motivo, rn).where(ext.cuit.in_(cuits)).subquery()
    for cuit, fecha, resultado, motivo in db.execute(
        select(sub.c.cuit, sub.c.fecha, sub.c.resultado, sub.c.motivo).where(sub.c.rn == 1)
    ):
        datos[cuit]["ult"] = (fecha, resultado, motivo)
    # Facturación agro (total, 12m): sólo de los que facturan agropecuario (el 99% de la cartera se
    # saltea la query). Fecha NULL: cuenta en el total pero no en los 12m (mismo criterio de siempre).
    agro_cuits = [c.cuit for c in clientes if c.factura_agro]
    if agro_cuits:
        liq = models.LiquidacionAgro
        for cuit, total, doce in db.execute(
            select(
                liq.cuit,
                func.sum(liq.importe_bruto),
                func.sum(case((liq.fecha_comprobante >= desde, liq.importe_bruto), else_=0)),
            )
            .where(liq.cuit.in_(agro_cuits))
            .group_by(liq.cuit)
        ):
            datos[cuit]["agro"] = (float(total or 0), float(doce or 0))
    return datos


def _remuneracion(c: models.ClienteARCA) -> RemuneracionOut | None:
    """Arma la remuneración de relación de dependencia desde `remuneraciones_json`. None si no hay."""
    if not c.remuneraciones_json:
        return None
    try:
        d = json.loads(c.remuneraciones_json)
    except (ValueError, TypeError):
        return None
    meses = [
        RemuneracionMesOut(
            periodo=m.get("periodo", ""), bruto=float(m.get("bruto") or 0),
            incluyeSac=bool(m.get("incluye_sac")),
        )
        for m in d.get("remuneraciones", [])
    ]
    return RemuneracionOut(
        empleadores=[e.get("razon_social", "") for e in d.get("empleadores", []) if e.get("razon_social")],
        totalBruto=float(d.get("total_bruto") or 0),
        periodoDesde=d.get("periodo_desde"),
        periodoHasta=d.get("periodo_hasta"),
        meses=meses,
    )


def _actividades(c: models.ClienteARCA) -> list[ActividadOut]:
    """Actividades declaradas del padrón desde `actividades_json`. [] si no hay o el JSON está roto."""
    if not c.actividades_json:
        return []
    try:
        data = json.loads(c.actividades_json)
    except (ValueError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    return [
        ActividadOut(
            codigo=a.get("codigo"), descripcion=a.get("descripcion"), periodo=a.get("periodo")
        )
        for a in data
        if isinstance(a, dict)
    ]


def _cliente_propio(db: Session, cuit: str, usuario: models.Usuario) -> models.ClienteARCA:
    """Devuelve el cliente sólo si está en la cartera visible del usuario logueado (los propios y,
    para un titular con equipo, los de sus empleados); si no, 404 (sin revelar que existe)."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None or cliente.usuario_id not in ids_cartera(db, usuario):
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return cliente


def _motivo_amigable(motivo: str | None) -> str | None:
    """Traduce el motivo TÉCNICO de una sincronización fallida a copy de dominio para el contador
    (regla de producto: la copy visible nunca menciona el mecanismo). El motivo crudo se conserva
    para operaciones en el panel admin; acá sólo se reescribe lo que ve el usuario. Lo no cubierto
    pasa igual."""
    if not motivo:
        return motivo
    m = motivo.lower()
    # Adhesión de Mis Comprobantes: el cliente aún no tiene habilitada la consulta de sus
    # comprobantes. Con el alta automática esto se resuelve solo en las próximas actualizaciones.
    if "mcmp" in m or "adhesión de web" in m or "adhesion de web" in m:
        return (
            "Estamos habilitando la consulta de comprobantes emitidos y recibidos de este cliente. "
            "Se completa automáticamente en las próximas actualizaciones."
        )
    return motivo


def construir_cliente_out(
    db: Session, c: models.ClienteARCA, datos: dict | None = None, meses_historial: int = 12
) -> ClienteOut:
    """Arma el ClienteOut de un cliente: combina el dato crudo de ARCA con el override manual del
    contador (edicion_json), el régimen resuelto, el historial 12m y la última extracción. Lo usan
    tanto la lista del contador (listar_clientes) como la vista global del panel superadmin.

    `datos` es la entrada de este cliente en `datos_cartera()`: al armar una LISTA, calculala una
    vez para todos y pasala acá (sin eso, cada cliente dispara sus propias queries)."""
    if datos is None:
        datos = datos_cartera(db, [c], meses_historial=meses_historial)[c.cuit]
    ult = datos["ult"]  # (fecha, resultado, motivo) | None
    tipos_emit = datos["tipos"]
    # Ediciones manuales del contador (override): ganan sobre el dato crudo de ARCA. Viven en
    # edicion_json (separado), así sobreviven a la sincronización que pisa las columnas crudas.
    edic = json.loads(c.edicion_json) if c.edicion_json else {}
    historial, tiene_comps = datos["historial"], datos["tiene"]
    agro_total, agro_12m = datos["agro"]
    return ClienteOut(
        cuit=c.cuit,
        nombre=edic.get("nombre") or c.nombre,
        # Régimen autoritativo del padrón (c.regimen) combinado con el inferido de los
        # comprobantes; nunca asume monotributo sin evidencia (ver resolver_regimen).
        regimen=resolver_regimen(c.regimen, clasificar_regimen(tipos_emit)),
        categoria=edic.get("categoria") or c.categoria,
        actividad=edic.get("tipoActividad") or c.actividad,
        actividades=_actividades(c),
        prox_recategorizacion=c.prox_recategorizacion,
        recat_ventana_desde=c.recat_ventana_desde,
        recat_ventana_hasta=c.recat_ventana_hasta,
        recat_mostrar_alerta=c.recat_mostrar_alerta,
        cuota_estado=edic.get("estadoCuotaMesActual") or c.cuota_estado,
        cuota_deuda=float(c.cuota_deuda) if c.cuota_deuda is not None else None,
        cuota_saldo_favor=float(c.cuota_saldo_favor) if c.cuota_saldo_favor is not None else None,
        prox_venc_fecha=c.prox_venc_fecha,
        prox_venc_importe=float(c.prox_venc_importe) if c.prox_venc_importe is not None else None,
        debito_automatico=c.debito_automatico,
        meses_adeudados=c.meses_adeudados,
        facturacion_12m=float(c.facturacion_12m) if c.facturacion_12m is not None else None,
        tope_categoria=float(c.tope_categoria) if c.tope_categoria is not None else None,
        facturometro_actualizado=c.facturometro_actualizado,
        ultima_extraccion=_iso_utc(ult[0]) if ult else None,
        resultado_ultima_extraccion=ult[1] if ult else None,
        motivo_ultima_extraccion=_motivo_amigable(ult[2]) if ult else None,
        notas=edic.get("notas"),
        fecha_inicio=edic.get("fechaInicio"),
        # Relación de dependencia: el override manual del contador (True/False) gana; si no lo marcó
        # (None), cae al valor auto-detectado de la columna. None final = no se sabe.
        relacion_dependencia=(
            edic["relacionDependencia"]
            if edic.get("relacionDependencia") is not None
            else c.relacion_dependencia
        ),
        remuneracion=_remuneracion(c),
        historial_mensual=historial,
        tiene_comprobantes=tiene_comps,
        tiene_facturacion=bool(c.cert_cifrado and c.key_cifrado),
        clave_requiere_cambio=bool(c.clave_requiere_cambio),
        clave_invalida=bool(c.clave_invalida),
        factura_agro=bool(c.factura_agro),
        facturacion_agro_12m=agro_12m,
        facturacion_agro_total=agro_total,
        activo=bool(c.activo),
    )


@router.get("/clientes", response_model=list[ClienteOut])
def listar_clientes(
    db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """La cartera visible del usuario: sus clientes y, si es titular con equipo, también los de sus
    empleados (con el responsable anotado, para "Gestión de usuarios" y la columna de la lista)."""
    ids = ids_cartera(db, usuario)
    clientes = db.scalars(
        select(models.ClienteARCA).where(models.ClienteARCA.usuario_id.in_(ids))
    ).all()
    datos = datos_cartera(db, clientes)
    out = [construir_cliente_out(db, c, datos[c.cuit]) for c in clientes]
    if len(ids) > 1:  # titular con equipo: anotar quién es el responsable de cada cliente
        nombres = {
            u.id: (f"{u.nombre} {u.apellido}".strip() or u.email)
            for u in db.scalars(select(models.Usuario).where(models.Usuario.id.in_(ids)))
        }
        for o, c in zip(out, clientes):
            o.responsable_id = c.usuario_id
            o.responsable = nombres.get(c.usuario_id)
    return out


@router.get("/clientes/{cuit}", response_model=ClienteOut)
def detalle_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Un cliente puntual con el MISMO dato que la lista. Lo usa la ficha: antes bajaba la cartera
    completa (con todo su costo) sólo para quedarse con uno."""
    cliente = _cliente_propio(db, cuit, usuario)
    # La ficha pide 26 meses de historial (vs 12 de la lista): alcanza para evaluar la
    # recategorización sobre períodos semestrales anteriores (que empiezan antes de los últimos 12).
    out = construir_cliente_out(db, cliente, meses_historial=26)
    ids = ids_cartera(db, usuario)
    if len(ids) > 1:  # titular con equipo: anotar el responsable, igual que en la lista
        u = db.get(models.Usuario, cliente.usuario_id)
        out.responsable_id = cliente.usuario_id
        out.responsable = (f"{u.nombre} {u.apellido}".strip() or u.email) if u else None
    return out


@router.put("/clientes/{cuit}/edicion")
def editar_cliente(
    cuit: str,
    datos: EdicionClienteIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("editar_cliente")),
):
    """Guarda (merge parcial) las ediciones manuales del contador sobre un cliente. Sólo pisa los
    campos que vinieron; el resto del override —y el dato crudo de ARCA— queda intacto. El override
    se re-aplica en listar_clientes (gana sobre ARCA)."""
    cliente = _cliente_propio(db, cuit, usuario)
    payload = datos.model_dump(exclude_none=True)
    # `factura_agro` es una columna real que lee el motor (no un override en edicion_json), así que
    # la seteamos aparte. Encenderla: el mantenimiento del motor le baja las liquidaciones en la
    # próxima pasada. Apagarla a mano: además marcamos `agro_chequeado_en` para que la detección
    # automática no la vuelva a prender (respetamos la decisión del contador).
    factura_agro = payload.pop("facturaAgro", None)
    if factura_agro is not None:
        cliente.factura_agro = bool(factura_agro)
        if not factura_agro and cliente.agro_chequeado_en is None:
            cliente.agro_chequeado_en = dt.datetime.now(dt.timezone.utc)
    actual: dict = json.loads(cliente.edicion_json) if cliente.edicion_json else {}
    actual.update(payload)
    cliente.edicion_json = json.dumps(actual, ensure_ascii=False)
    db.add(cliente)
    db.commit()
    return {"ok": True}


@router.put("/clientes/{cuit}/activo")
def cambiar_activo_cliente(
    cuit: str,
    datos: EstadoClienteIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("editar_cliente")),
):
    """Prende/apaga el monitoreo del cliente. Desactivado (activo=false): el motor de sincronización
    lo saltea (deja de actualizar sus datos) y en la lista aparece atenuado como "Desactivado". Los
    datos ya guardados se conservan; volver a activarlo lo reincorpora al ciclo de actualización."""
    cliente = _cliente_propio(db, cuit, usuario)
    cliente.activo = datos.activo
    # Decisión manual del contador: el estado pasa a ser propio, deja de contar como baja en cascada
    # (así una futura reactivación de la cuenta no lo revierte). Ver routers/admin.py.
    cliente.desactivado_en_cascada = False
    db.add(cliente)
    db.commit()
    return {"ok": True, "activo": cliente.activo}


@router.put("/clientes/{cuit}/clave")
def actualizar_clave_cliente(
    cuit: str,
    datos: ClaveClienteIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("actualizar_clave")),
):
    """Reemplaza la clave fiscal con la que se sincroniza este cliente (para cuando el cliente la
    cambia en ARCA). La clave vive cifrada en la `CredencialARCA` de su `cuit_credencial` —el CUIT
    con el que se loguea este cliente—; si ese CUIT representa a otros, todos pasan a usar la nueva
    clave. Apaga los avisos de clave ("debe cambiar la clave" y "revisá su Clave Fiscal") en los
    clientes afectados de este contador (la clave es de esa cuenta, no de un cliente puntual); si
    quedara mal, la próxima sincronización vuelve a marcar el que corresponda."""
    cliente = _cliente_propio(db, cuit, usuario)
    clave = datos.clave.strip()
    if not clave:
        raise HTTPException(status_code=400, detail="La clave no puede estar vacía.")
    cuit_cred = cliente.cuit_credencial
    credencial = db.get(models.CredencialARCA, cuit_cred)
    if credencial is None:
        db.add(models.CredencialARCA(cuit=cuit_cred, clave_cifrada=cifrar(clave.encode())))
    else:
        credencial.clave_cifrada = cifrar(clave.encode())
    db.execute(
        update(models.ClienteARCA)
        .where(
            models.ClienteARCA.usuario_id.in_(ids_cartera(db, usuario)),
            models.ClienteARCA.cuit_credencial == cuit_cred,
        )
        .values(clave_requiere_cambio=False, clave_invalida=False)
    )
    db.commit()
    # Re-probar la sincronización YA con la clave nueva, sin esperar al motor continuo. El contador
    # acaba de corregir la clave y quiere saber en el momento si quedó bien o sigue fallando; si no
    # disparásemos acá, el cliente recién se reintentaría cuando el worker lo agarre por vencido.
    # Corre en un thread (la sync tarda) y devuelve job_id para seguir el progreso desde la ficha.
    # El advisory lock por CUIT serializa si el worker justo lo toma a la vez → sin doble login.
    job_id = jobs.crear_job()
    threading.Thread(target=_correr_sync, args=(job_id, cuit), daemon=True).start()
    return {"ok": True, "job_id": job_id}


@router.get("/clientes/{cuit}/clave")
def ver_clave_guardada(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("actualizar_clave")),
):
    """Devuelve la clave fiscal GUARDADA de un cliente, para mostrarla al contador cuando va a
    actualizarla. EXPOSICIÓN MÍNIMA: sólo se entrega si el cliente está en estado de error de clave
    (AFIP forzó el cambio o la clave quedó inválida) — así no se puede espiar la clave de un cliente
    sano. Requiere el permiso 'actualizar_clave' (el mismo que para cambiarla) y pertenencia. Se
    deja traza de quién la consultó."""
    cliente = _cliente_propio(db, cuit, usuario)
    if not (cliente.clave_invalida or cliente.clave_requiere_cambio):
        raise HTTPException(
            status_code=403,
            detail="La clave guardada solo puede verse cuando el cliente tiene un problema de clave.",
        )
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None or not credencial.clave_cifrada:
        raise HTTPException(status_code=404, detail="Este cliente no tiene una clave guardada.")
    log.info("usuario %s consultó la clave guardada del cliente %s", usuario.id, cuit)
    return {"clave": descifrar(credencial.clave_cifrada).decode()}


@router.delete("/clientes/{cuit}")
def eliminar_cliente(
    cuit: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("eliminar_cliente")),
):
    """Borra el cliente y TODO su cache de comprobantes (emitidos + recibidos) en una sola
    transacción. Los datos en ARCA no se tocan: se vuelven a traer si se carga de nuevo. El
    contador (su clave cifrada) NO se borra: puede seguir teniendo otros clientes."""
    cliente = _cliente_propio(db, cuit, usuario)
    res = db.execute(
        delete(models.ComprobanteEmitido).where(models.ComprobanteEmitido.cuit == cuit)
    )
    # Borrar TODO lo que referencia al cliente por FK antes de borrarlo. En Postgres las FKs se
    # fuerzan (a diferencia de SQLite en dev, que por default las ignora), así que si quedan filas
    # huérfanas en extracciones / movimientos_bancarios el DELETE del cliente revienta con una
    # ForeignKeyViolation → 500. Ver models.py: estas dos tablas tienen FK a clientes_arca.cuit.
    db.execute(delete(models.Extraccion).where(models.Extraccion.cuit == cuit))
    db.execute(delete(models.MovimientoBancario).where(models.MovimientoBancario.cuit == cuit))
    db.delete(cliente)
    db.commit()
    return {"cuit": cuit, "comprobantes_eliminados": res.rowcount}


def _correr_sync(job_id: str, cuit: str) -> None:
    """Worker en thread: sincroniza un cliente (comprobantes + padrón) reportando progreso en el
    job. Usa su propia sesión de DB porque la del request ya se cerró al responder el job_id."""
    db = SessionLocal()
    try:
        jobs.actualizar(job_id, progreso=10, mensaje="Trayendo comprobantes…")
        n = sincronizacion.sincronizar(db, cuit)
        jobs.actualizar(job_id, progreso=70, mensaje="Actualizando datos del padrón…")
        try:
            sincronizacion.sincronizar_padron(db, cuit)
        except Exception:  # noqa: BLE001 — el padrón no aplica o falló; los comprobantes ya están
            pass
        jobs.actualizar(
            job_id,
            estado="terminado",
            progreso=100,
            mensaje="Listo",
            resultados=[{"cuit": cuit, "ok": True, "comprobantes": n}],
        )
    except Exception as e:  # noqa: BLE001
        jobs.actualizar(
            job_id, estado="error", progreso=100, mensaje="No se pudo sincronizar", error=str(e)[:300]
        )
    finally:
        db.close()


@router.post("/clientes/{cuit}/sincronizar")
def sincronizar_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Dispara, en un thread, la sincronización COMPLETA (comprobantes + padrón) y devuelve un job_id
    para seguir el progreso. Corre en background: sigue aunque el front navegue o recargue la página."""
    _cliente_propio(db, cuit, usuario)
    job_id = jobs.crear_job()
    threading.Thread(target=_correr_sync, args=(job_id, cuit), daemon=True).start()
    return {"job_id": job_id}


@router.get("/sincronizaciones/{job_id}", response_model=JobOut)
def progreso_sincronizacion(job_id: str, _usuario: models.Usuario = Depends(usuario_actual)):
    """Progreso de una sincronización en background (para el indicador del header)."""
    job = jobs.obtener(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Sincronización no encontrada.")
    return job


def _correr_sync_todos(job_id: str, usuario_ids: list[int]) -> None:
    """Worker en thread: sincroniza SECUENCIALMENTE (uno por uno, para no abrir N navegadores a la
    vez) todos los clientes de la cartera (para un titular con equipo, la de todo el equipo),
    reportando progreso en el job. Un cliente que falla no frena al resto. Usa su propia sesión de
    DB porque la del request ya se cerró."""
    db = SessionLocal()
    try:
        clientes = db.execute(
            select(models.ClienteARCA.cuit, models.ClienteARCA.nombre).where(
                models.ClienteARCA.usuario_id.in_(usuario_ids),
                models.ClienteARCA.activo.is_(True),  # los desactivados no se sincronizan
            )
        ).all()
        total = len(clientes)
        if total == 0:
            jobs.actualizar(
                job_id, estado="terminado", progreso=100, mensaje="No hay clientes para sincronizar"
            )
            return
        for i, (cuit, nombre) in enumerate(clientes):
            etiqueta = nombre or cuit
            base = int(i / total * 100)
            span = max(1, 100 // total)
            jobs.actualizar(
                job_id,
                progreso=base,
                mensaje=f"Sincronizando {etiqueta} ({i + 1} de {total})…",
            )

            # Progreso DENTRO del cliente actual: el scraping reporta cada tramo y lo mapeamos a la
            # franja [base, base+span] del progreso global, con el cliente actual en el mensaje.
            def _prog(idx, n_pasos, msg, _b=base, _s=span, _e=etiqueta, _i=i):
                jobs.actualizar(
                    job_id,
                    progreso=min(99, _b + int((idx / max(1, n_pasos)) * _s)),
                    mensaje=f"{_e} ({_i + 1} de {total}) · {msg}",
                )

            try:
                n = sincronizacion.sincronizar(db, cuit, on_progress=_prog)
                try:
                    sincronizacion.sincronizar_padron(db, cuit)
                except Exception:  # noqa: BLE001 — el padrón es best-effort y no frena nada
                    pass
                jobs.agregar_resultado(
                    job_id, {"cuit": cuit, "nombre": nombre, "ok": True, "comprobantes": n}
                )
            except Exception as e:  # noqa: BLE001 — un cliente que falla no frena al resto
                jobs.agregar_resultado(
                    job_id, {"cuit": cuit, "nombre": nombre, "ok": False, "error": str(e)[:300]}
                )
        jobs.actualizar(job_id, estado="terminado", progreso=100, mensaje="Listo")
    except Exception as e:  # noqa: BLE001
        jobs.actualizar(
            job_id, estado="error", progreso=100, mensaje="No se pudo sincronizar", error=str(e)[:300]
        )
    finally:
        db.close()


@router.post("/sincronizar-todos")
def sincronizar_todos_endpoint(
    db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Dispara, en un thread, la sincronización SECUENCIAL de TODOS los clientes del contador y
    devuelve un job_id para seguir el progreso (mismo registro de jobs que el sync por-cliente).
    Corre en background: sigue aunque el front navegue o recargue la página."""
    ids = ids_cartera(db, usuario)
    total = db.scalar(
        select(func.count())
        .select_from(models.ClienteARCA)
        .where(models.ClienteARCA.usuario_id.in_(ids))
    )
    job_id = jobs.crear_job()
    threading.Thread(target=_correr_sync_todos, args=(job_id, ids), daemon=True).start()
    return {"job_id": job_id, "total": total or 0}


@router.get("/sync/estado")
def estado_sync(_usuario: models.Usuario = Depends(usuario_actual)):
    """Estado del auto-sync: si el scheduler está activo y cuándo es el próximo disparo."""
    return estado_scheduler()


def _comprobante_out(c: models.ComprobanteEmitido) -> ComprobanteOut:
    """Mapea un ComprobanteEmitido al shape que consume el frontend (camelCase)."""
    return ComprobanteOut(
        id=f"{c.cuit}-{c.direccion}-{c.punto_venta}-{c.cbte_tipo}-{c.numero}",
        direccion=c.direccion,
        tipo=nombre_tipo(c.cbte_tipo),
        cbteTipo=c.cbte_tipo,
        fechaEmision=c.fecha.isoformat(),
        puntoVenta=c.punto_venta,
        numero=str(c.numero).zfill(8),
        monto=float(c.imp_total),  # pesos (canónico)
        moneda=c.moneda or "ARS",
        cotizacion=float(c.cotizacion) if c.cotizacion is not None else 1.0,
        # Filas viejas (pre-migración) no tienen imp_total_origen: caen al imp_total.
        montoOrigen=float(c.imp_total_origen) if c.imp_total_origen is not None else float(c.imp_total),
        contraparteNombre=c.contraparte_nombre or "—",
        contraparteCuit=c.doc_nro,
        tienePdf=bool(c.cae_vto),  # emitido desde la app → tiene representación impresa
        origen=c.origen or "arca",
    )


@router.get("/clientes/{cuit}/comprobantes", response_model=list[ComprobanteOut])
def comprobantes_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    _cliente_propio(db, cuit, usuario)
    comps = db.scalars(
        select(models.ComprobanteEmitido)
        .where(models.ComprobanteEmitido.cuit == cuit)
        .order_by(models.ComprobanteEmitido.fecha.desc())
    ).all()
    return [_comprobante_out(c) for c in comps]


@router.post(
    "/clientes/{cuit}/comprobantes/manual", response_model=ComprobanteOut, status_code=201
)
def crear_comprobante_manual(
    cuit: str,
    datos: ComprobanteManualIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("editar_cliente")),
):
    """Carga MANUAL de un comprobante que no figura en Mis Comprobantes: una venta con talonario en
    papel o una compra/gasto (p. ej. un ticket) que no llegó por los canales electrónicos. Queda
    marcado `origen='manual'` para distinguirlo, protegerlo del re-sync y poder borrarlo."""
    _cliente_propio(db, cuit, usuario)
    comp = models.ComprobanteEmitido(
        cuit=cuit,
        direccion=datos.direccion,
        cbte_tipo=datos.cbte_tipo,
        punto_venta=datos.punto_venta,
        numero=datos.numero,
        fecha=datos.fecha,
        imp_total=datos.importe_total,
        imp_total_origen=datos.importe_total,
        moneda="ARS",
        cotizacion=1,
        doc_nro=datos.contraparte_cuit,
        contraparte_nombre=datos.contraparte_nombre,
        origen="manual",
    )
    db.add(comp)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Ya existe un comprobante con ese tipo, punto de venta y número para este cliente.",
        )
    db.refresh(comp)
    return _comprobante_out(comp)


@router.delete("/clientes/{cuit}/comprobantes/manual/{direccion}/{punto_venta}/{cbte_tipo}/{numero}")
def eliminar_comprobante_manual(
    cuit: str,
    direccion: str,
    punto_venta: int,
    cbte_tipo: int,
    numero: int,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("editar_cliente")),
):
    """Borra un comprobante cargado a mano. Sólo se pueden borrar los de `origen='manual'`: los
    traídos de Mis Comprobantes son un cache que se rehace solo, no se tocan desde acá."""
    _cliente_propio(db, cuit, usuario)
    comp = db.scalar(
        select(models.ComprobanteEmitido).where(
            models.ComprobanteEmitido.cuit == cuit,
            models.ComprobanteEmitido.direccion == direccion,
            models.ComprobanteEmitido.punto_venta == punto_venta,
            models.ComprobanteEmitido.cbte_tipo == cbte_tipo,
            models.ComprobanteEmitido.numero == numero,
        )
    )
    if comp is None or comp.origen != "manual":
        raise HTTPException(status_code=404, detail="No se encontró un comprobante manual para borrar.")
    db.delete(comp)
    db.commit()
    return {"ok": True}


@router.get("/clientes/{cuit}/liquidaciones-agro", response_model=LiquidacionesAgroOut)
def liquidaciones_agro_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Apartado de Facturación Agropecuaria: las Liquidaciones Electrónicas del sector primario
    cacheadas del cliente + su total bruto. Vacío si no le aplica."""
    cliente = _cliente_propio(db, cuit, usuario)
    liqs = db.scalars(
        select(models.LiquidacionAgro)
        .where(models.LiquidacionAgro.cuit == cuit)
        .order_by(models.LiquidacionAgro.fecha_comprobante.desc().nullslast())
    ).all()
    return LiquidacionesAgroOut(
        facturaAgro=cliente.factura_agro,
        totalBruto=float(sum(float(x.importe_bruto or 0) for x in liqs)),
        liquidaciones=[
            LiquidacionAgroOut(
                id=x.liq_id,
                direccion=x.direccion,
                tipo=x.tipo_liq or nombre_tipo(x.cbte_tipo),
                cbteTipo=x.cbte_tipo,
                puntoVenta=x.punto_venta,
                numero=str(x.numero).zfill(8),
                fechaComprobante=x.fecha_comprobante.isoformat() if x.fecha_comprobante else None,
                contraparteCuit=x.cuit_contraparte or "",
                sistema=x.sistema or "",
                importeBruto=float(x.importe_bruto or 0),
            )
            for x in liqs
        ],
    )


@router.get("/clientes/{cuit}/deuda")
def deuda_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Detalle de deuda CCMA cacheado (cálculo más reciente). null si nunca se consultó."""
    cliente = _cliente_propio(db, cuit, usuario)
    detalle = json.loads(cliente.deuda_detalle) if cliente.deuda_detalle else None
    return {"deuda_detalle": detalle}


@router.post("/clientes/{cuit}/deuda")
def sincronizar_deuda_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Consulta la CCMA en vivo (Estado de cuenta → cálculo de deuda) y cachea el detalle."""
    cliente = _cliente_propio(db, cuit, usuario)
    try:
        res = sincronizacion.sincronizar_deuda(db, cuit)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    db.refresh(cliente)
    # Devolvemos lo que quedó GUARDADO (detalle real o marcador {no_aplica}); así GET y POST son
    # simétricos y la recarga muestra lo mismo. `ok` = la consulta dio un resultado (no un fallo).
    detalle = json.loads(cliente.deuda_detalle) if cliente.deuda_detalle else None
    ok = bool(res.get("deuda_detalle") or res.get("no_aplica"))
    return {"deuda_detalle": detalle, "ok": ok}


@router.get("/clientes/{cuit}/constancia")
def constancia_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Constancia de inscripción OFICIAL del cliente, traída en vivo, como HTML listo para abrir e
    imprimir/guardar en PDF desde el navegador (trae verificador y vigencia del día). Sólo titular."""
    cliente = _cliente_propio(db, cuit, usuario)
    credencial = db.get(models.CredencialARCA, cliente.cuit_credencial)
    if credencial is None:
        raise HTTPException(
            status_code=400,
            detail="Este cliente no tiene una clave cargada para consultar su constancia.",
        )
    clave = descifrar(credencial.clave_cifrada).decode()
    from ..arca import motor

    try:
        html = motor.constancia(credencial.cuit, clave, cuit_objetivo=cuit)
    except Exception as e:  # noqa: BLE001 — error de red/sesión con ARCA
        raise HTTPException(
            status_code=502,
            detail="No se pudo obtener la constancia en este momento. Probá de nuevo en unos minutos.",
        ) from e
    if not html:
        raise HTTPException(
            status_code=502,
            detail="No se pudo obtener la constancia de este cliente en este momento.",
        )
    return Response(content=html, media_type="text/html; charset=utf-8")


@router.get("/clientes/{cuit}/extracciones", response_model=list[ExtraccionOut])
def extracciones_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Bitácora de sincronizaciones del cliente, de la más reciente a la más vieja."""
    _cliente_propio(db, cuit, usuario)
    exts = db.scalars(
        select(models.Extraccion)
        .where(models.Extraccion.cuit == cuit)
        .order_by(models.Extraccion.fecha.desc(), models.Extraccion.id.desc())
    ).all()
    return [
        ExtraccionOut(
            id=str(e.id),
            fecha=_iso_utc(e.fecha),
            resultado=e.resultado,
            motivo=e.motivo,
            duracionMs=e.duracion_ms,
            comprobantes=e.comprobantes,
        )
        for e in exts
    ]


# --- Domicilio Fiscal Electrónico (comunicaciones) ---------------------------


def _com_out(c: models.ComunicacionDFE) -> ComunicacionOut:
    return ComunicacionOut(
        id=c.id_comunicacion,
        fechaPublicacion=_iso_utc(c.fecha_publicacion) if c.fecha_publicacion else None,
        fechaVencimiento=_iso_utc(c.fecha_vencimiento) if c.fecha_vencimiento else None,
        sistema=c.sistema,
        organismo=c.organismo,
        asunto=c.asunto,
        detalle=c.detalle,
        prioridad=c.prioridad,
        tieneAdjunto=c.tiene_adjunto,
        leidaArca=c.leida_arca,
        vista=c.vista_por_contador,
    )


@router.get("/clientes/{cuit}/comunicaciones", response_model=list[ComunicacionOut])
def comunicaciones_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Comunicaciones del Domicilio Fiscal Electrónico cacheadas del cliente (más reciente primero).
    Lee de la DB (lo trae la sincronización), no consulta en vivo."""
    _cliente_propio(db, cuit, usuario)
    return [_com_out(c) for c in comunicaciones_svc.listar(db, cuit)]


@router.post("/clientes/{cuit}/comunicaciones/sincronizar", response_model=list[ComunicacionOut])
def sincronizar_comunicaciones_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
):
    """Trae en vivo las comunicaciones del DFE y las cachea. Pensado para el motor de sync; expuesto
    también acá para poder refrescar a demanda (y para probar en desarrollo sin esperar al worker)."""
    _cliente_propio(db, cuit, usuario)
    try:
        comunicaciones_svc.sincronizar_comunicaciones(db, cuit)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return [_com_out(c) for c in comunicaciones_svc.listar(db, cuit)]


@router.post("/clientes/{cuit}/comunicaciones/{id_com}/marcar-vista", response_model=ComunicacionOut)
def marcar_comunicacion_vista(
    cuit: str,
    id_com: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(requiere_permiso("comunicaciones")),
):
    """El contador abrió la comunicación: baja el detalle completo (ARCA la marca leída al pedirlo) y
    la marca vista en Órbita (apaga el punto rojo). Devuelve la comunicación ya con el detalle."""
    _cliente_propio(db, cuit, usuario)
    com = comunicaciones_svc.marcar_vista(db, cuit, id_com)
    if com is None:
        raise HTTPException(status_code=404, detail="Comunicación no encontrada")
    return _com_out(com)
