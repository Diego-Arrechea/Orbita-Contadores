"""Endpoints de clientes y sus comprobantes (protegidos: cada contador ve sólo lo suyo)."""
from __future__ import annotations

import datetime as dt
import json
import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, distinct, func, select, update
from sqlalchemy.orm import Session

from .. import models
from ..crypto import cifrar
from ..db import SessionLocal, get_db
from ..schemas import (
    TIPOS_NOTA_CREDITO,
    ClaveClienteIn,
    ClienteOut,
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
from ..security import usuario_actual
from ..services import comunicaciones as comunicaciones_svc
from ..services import sincronizacion
from ..services.scheduler import estado_scheduler

router = APIRouter(prefix="/api", tags=["clientes"])


def _iso_utc(d: dt.datetime) -> str:
    """Serializa un timestamp marcándolo como UTC. SQLite guarda func.now() (=CURRENT_TIMESTAMP)
    en UTC pero lo devuelve naive (sin tz); sin el offset, el front lo interpreta como hora local
    y muestra 3 h de más. Le pegamos UTC para que `new Date()` lo convierta a la hora del contador."""
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.isoformat()


def _historial_12m(db: Session, cuit: str) -> tuple[list[HistorialMesOut], bool]:
    """Agrega los comprobantes del cliente en los últimos 12 meses calendario (cronológico) para
    alimentar % tope, ratio de gastos y proyección del dashboard sin bajar el detalle.
    Devuelve (historial, tiene_algun_comprobante). El front lo consume con la misma forma que
    derivarHistorial(). Notas de Crédito se RESTAN del mes (idéntico criterio al front)."""
    hoy = dt.date.today()
    primer_mes_idx = hoy.year * 12 + (hoy.month - 1) - 11  # primer mes de la ventana de 12
    desde = dt.date(primer_mes_idx // 12, primer_mes_idx % 12 + 1, 1)
    filas = db.execute(
        select(
            models.ComprobanteEmitido.fecha,
            models.ComprobanteEmitido.direccion,
            models.ComprobanteEmitido.cbte_tipo,
            models.ComprobanteEmitido.imp_total,
        ).where(
            models.ComprobanteEmitido.cuit == cuit,
            models.ComprobanteEmitido.fecha >= desde,
        )
    ).all()
    # ¿Hay AL MENOS un comprobante? (independiente de la ventana, para el semáforo 'sin datos').
    tiene = db.scalar(
        select(models.ComprobanteEmitido.id)
        .where(models.ComprobanteEmitido.cuit == cuit)
        .limit(1)
    ) is not None
    por_mes: dict[str, dict[str, float]] = {}
    for fecha, direccion, cbte_tipo, imp_total in filas:
        mes = f"{fecha.year:04d}-{fecha.month:02d}"
        e = por_mes.setdefault(
            mes, {"brutas": 0.0, "nc": 0.0, "recibidas": 0.0, "ncRecibidas": 0.0}
        )
        es_nc = cbte_tipo in TIPOS_NOTA_CREDITO
        monto = float(imp_total)
        if direccion == "emitido":
            if es_nc:
                e["nc"] += monto
            else:
                e["brutas"] += monto
        elif direccion == "recibido":
            if es_nc:
                e["ncRecibidas"] += monto
            else:
                e["recibidas"] += monto
    historial = [
        HistorialMesOut(
            mes=mes,
            emitidasBrutas=e["brutas"],
            notasCredito=e["nc"],
            emitidasNetas=e["brutas"] - e["nc"],
            recibidas=e["recibidas"] - e["ncRecibidas"],
            recibidasComputables=e["recibidas"] - e["ncRecibidas"],
        )
        for mes, e in sorted(por_mes.items())
    ]
    return historial, tiene


def _agro_facturacion(db: Session, cuit: str, factura_agro: bool) -> tuple[float, float]:
    """(total, 12m) de las Liquidaciones Electrónicas del agro del cliente (suma de Importe Bruto). El
    12m usa la MISMA ventana de 12 meses calendario que el historial. Devuelve (0, 0) si el cliente no
    factura agropecuario (evita la query para el 99% de la cartera)."""
    if not factura_agro:
        return 0.0, 0.0
    hoy = dt.date.today()
    primer_mes_idx = hoy.year * 12 + (hoy.month - 1) - 11
    desde = dt.date(primer_mes_idx // 12, primer_mes_idx % 12 + 1, 1)
    filas = db.execute(
        select(models.LiquidacionAgro.fecha_comprobante, models.LiquidacionAgro.importe_bruto).where(
            models.LiquidacionAgro.cuit == cuit
        )
    ).all()
    total = doce = 0.0
    for fecha, imp in filas:
        v = float(imp or 0)
        total += v
        if fecha and fecha >= desde:
            doce += v
    return total, doce


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


def _cliente_propio(db: Session, cuit: str, usuario: models.Usuario) -> models.ClienteARCA:
    """Devuelve el cliente sólo si pertenece al usuario logueado; si no, 404 (sin revelar que existe)."""
    cliente = db.get(models.ClienteARCA, cuit)
    if cliente is None or cliente.usuario_id != usuario.id:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return cliente


def construir_cliente_out(db: Session, c: models.ClienteARCA) -> ClienteOut:
    """Arma el ClienteOut de un cliente: combina el dato crudo de ARCA con el override manual del
    contador (edicion_json), el régimen resuelto, el historial 12m y la última extracción. Lo usan
    tanto la lista del contador (listar_clientes) como la vista global del panel superadmin."""
    ult = sincronizacion.ultima_extraccion(db, c.cuit)
    tipos_emit = set(
        db.scalars(
            select(distinct(models.ComprobanteEmitido.cbte_tipo)).where(
                models.ComprobanteEmitido.cuit == c.cuit,
                models.ComprobanteEmitido.direccion == "emitido",
            )
        ).all()
    )
    # Ediciones manuales del contador (override): ganan sobre el dato crudo de ARCA. Viven en
    # edicion_json (separado), así sobreviven a la sincronización que pisa las columnas crudas.
    edic = json.loads(c.edicion_json) if c.edicion_json else {}
    historial, tiene_comps = _historial_12m(db, c.cuit)
    agro_total, agro_12m = _agro_facturacion(db, c.cuit, c.factura_agro)
    return ClienteOut(
        cuit=c.cuit,
        nombre=edic.get("nombre") or c.nombre,
        # Régimen autoritativo del padrón (c.regimen) combinado con el inferido de los
        # comprobantes; nunca asume monotributo sin evidencia (ver resolver_regimen).
        regimen=resolver_regimen(c.regimen, clasificar_regimen(tipos_emit)),
        categoria=edic.get("categoria") or c.categoria,
        actividad=edic.get("tipoActividad") or c.actividad,
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
        ultima_extraccion=_iso_utc(ult.fecha) if ult else None,
        resultado_ultima_extraccion=ult.resultado if ult else None,
        motivo_ultima_extraccion=ult.motivo if ult else None,
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
    clientes = db.scalars(
        select(models.ClienteARCA).where(models.ClienteARCA.usuario_id == usuario.id)
    ).all()
    return [construir_cliente_out(db, c) for c in clientes]


@router.put("/clientes/{cuit}/edicion")
def editar_cliente(
    cuit: str,
    datos: EdicionClienteIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
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
    usuario: models.Usuario = Depends(usuario_actual),
):
    """Prende/apaga el monitoreo del cliente. Desactivado (activo=false): el motor de sincronización
    lo saltea (deja de actualizar sus datos) y en la lista aparece atenuado como "Desactivado". Los
    datos ya guardados se conservan; volver a activarlo lo reincorpora al ciclo de actualización."""
    cliente = _cliente_propio(db, cuit, usuario)
    cliente.activo = datos.activo
    db.add(cliente)
    db.commit()
    return {"ok": True, "activo": cliente.activo}


@router.put("/clientes/{cuit}/clave")
def actualizar_clave_cliente(
    cuit: str,
    datos: ClaveClienteIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_actual),
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
            models.ClienteARCA.usuario_id == usuario.id,
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


@router.delete("/clientes/{cuit}")
def eliminar_cliente(
    cuit: str, db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_actual)
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


def _correr_sync_todos(job_id: str, usuario_id: int) -> None:
    """Worker en thread: sincroniza SECUENCIALMENTE (uno por uno, para no abrir N navegadores a la
    vez) todos los clientes del contador, reportando progreso en el job. Un cliente que falla no
    frena al resto. Usa su propia sesión de DB porque la del request ya se cerró."""
    db = SessionLocal()
    try:
        clientes = db.execute(
            select(models.ClienteARCA.cuit, models.ClienteARCA.nombre).where(
                models.ClienteARCA.usuario_id == usuario_id,
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
    total = db.scalar(
        select(func.count())
        .select_from(models.ClienteARCA)
        .where(models.ClienteARCA.usuario_id == usuario.id)
    )
    job_id = jobs.crear_job()
    threading.Thread(target=_correr_sync_todos, args=(job_id, usuario.id), daemon=True).start()
    return {"job_id": job_id, "total": total or 0}


@router.get("/sync/estado")
def estado_sync(_usuario: models.Usuario = Depends(usuario_actual)):
    """Estado del auto-sync: si el scheduler está activo y cuándo es el próximo disparo."""
    return estado_scheduler()


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
    return [
        ComprobanteOut(
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
        )
        for c in comps
    ]


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
    usuario: models.Usuario = Depends(usuario_actual),
):
    """El contador abrió la comunicación: baja el detalle completo (ARCA la marca leída al pedirlo) y
    la marca vista en Órbita (apaga el punto rojo). Devuelve la comunicación ya con el detalle."""
    _cliente_propio(db, cuit, usuario)
    com = comunicaciones_svc.marcar_vista(db, cuit, id_com)
    if com is None:
        raise HTTPException(status_code=404, detail="Comunicación no encontrada")
    return _com_out(com)
