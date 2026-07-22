"""Modelos ORM (SQLAlchemy 2.0)."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class CredencialARCA(Base):
    """Credencial de acceso a ARCA (CUIT + clave fiscal del CLIENTE, cifrada con Fernet) usada para
    sincronizar 'Mis Comprobantes' automáticamente.

    OJO — el `cuit` es SIEMPRE de un CLIENTE, NUNCA del contador-usuario de Órbita: el contador
    NUNCA carga su propia clave fiscal ni su CUIT, carga las credenciales (CUIT + clave fiscal) de
    sus CLIENTES, y eso es lo que se guarda acá.

    La tabla física sigue llamándose `contadores` por historia (así se creó en prod); renombrarla
    exigiría una migración con downtime, así que sólo se corrigió el nombre en el código."""

    __tablename__ = "contadores"

    cuit: Mapped[str] = mapped_column(String(11), primary_key=True)
    clave_cifrada: Mapped[bytes] = mapped_column(LargeBinary)
    creado_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Usuario(Base):
    """El contador registrado en Órbita: su login propio (email + contraseña hasheada).
    Distinto de `CredencialARCA`, que guarda la clave fiscal de ARCA (de un CLIENTE) para el
    scraping. El `cuit` de acá puede coincidir con el de una `CredencialARCA`, pero son tablas
    independientes a propósito."""

    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(80))
    apellido: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    telefono: Mapped[str] = mapped_column(String(30))
    dni: Mapped[str] = mapped_column(String(10))
    # Nullable: las cuentas de EMPLEADO (creadas por el titular desde "Gestión de usuarios") no
    # cargan CUIT; el registro normal sigue exigiéndolo (lo valida RegistroIn). unique tolera
    # múltiples NULL tanto en SQLite como en Postgres.
    cuit: Mapped[str | None] = mapped_column(String(11), unique=True, index=True, nullable=True)
    estudio: Mapped[str] = mapped_column(String(120))
    matricula: Mapped[str | None] = mapped_column(String(40), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    acepto_terminos: Mapped[bool] = mapped_column(Boolean, default=False)
    # Preferencias del contador (ventanas de recategorización, umbrales, inflación) en JSON. Antes
    # vivían en localStorage del navegador; ahora se guardan en la cuenta. NULL = usa los defaults
    # del front. Ver routers/configuracion.py.
    config_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Aviso de lanzamiento de las alertas: cuántos ingresos más se le muestra el modal "ya podés
    # configurar tus alertas" (baja de a 1 por sesión; 0 = no mostrar). Se sembró en 2 para los
    # contadores que ya existían al lanzar la feature; los nuevos arrancan en 0. Ver auth.py.
    aviso_alertas_pendiente: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Rol del usuario en Órbita. 'contador' = cuenta normal (ve sólo sus clientes); 'admin' = acceso
    # al panel superadmin (gestiona todas las cuentas). Ver routers/admin.py + security.admin_actual.
    rol: Mapped[str] = mapped_column(String(20), default="contador", server_default="contador")
    # Equipo del estudio ("Gestión de usuarios"): si está seteado, esta cuenta es un EMPLEADO creado
    # por el titular `titular_id` y ve/opera SÓLO los clientes que tiene asignados (los que llevan su
    # usuario_id). NULL = cuenta plena (titular o contador independiente): ve lo suyo y, si creó
    # empleados, también los clientes de todo su equipo. Ver security.ids_cartera.
    titular_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("usuarios.id"), nullable=True, index=True
    )
    # Permisos del EMPLEADO (JSON {clave: bool}; ver security.PERMISOS_EQUIPO). Ausente/NULL = todos
    # habilitados (default). Sólo aplica a empleados: para cuentas plenas se ignora (pueden todo).
    # Los edita el titular desde "Gestión de usuarios"; se enforcan en los endpoints (requiere_permiso).
    permisos_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Cuenta habilitada. False = el contador no puede iniciar sesión ni operar (la deshabilita un
    # admin desde el panel). El chequeo vive en login y en usuario_actual.
    activo: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # True = esta cuenta se deshabilitó AUTOMÁTICAMENTE al dar de baja a su titular (baja en cascada),
    # no por una decisión directa sobre ella. Sólo se marca en cuentas de EMPLEADO. Permite revertir
    # SÓLO estas al reactivar al titular, sin resucitar empleados que el titular ya había desactivado
    # a mano. Ver routers/admin.py (_cascada_desactivar/_cascada_reactivar).
    desactivado_en_cascada: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0"
    )
    # Última vez que el contador inició sesión (para el panel admin). NULL = nunca entró.
    ultimo_acceso: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Última vez que el contador cerró la app (para el panel admin): cierre de sesión explícito o
    # cierre/recarga de la pestaña (best-effort vía POST /auth/logout). NULL = nunca registrado.
    ultimo_logout: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    creado_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # LEGACY: fin del período de prueba gratis. La feature se retiró; ya no se setea ni se lee.
    # Se conserva la columna sólo para no tener que dropearla en prod (queda siempre NULL en cuentas
    # nuevas). No usar.
    trial_fin: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Recuperación de contraseña ("olvidé mi contraseña"). Guardamos SÓLO el sha256 del token que
    # viaja en el enlace (nunca el token en claro) + su expiración. Single-use: se limpian al
    # restablecer. NULL/NULL = sin reset pendiente. Ver routers/auth.py + security.py.
    reset_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reset_token_exp: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Confirmación de email. email_confirmado=False hasta que el contador abre el enlace que le
    # mandamos al registrarse. Enforcement SUAVE: NO bloquea login ni el uso de la app; sólo dispara
    # un banner en el front pidiendo que confirme. Mismo patrón single-use que el reset: guardamos
    # SÓLO el sha256 del token + su expiración (NULL/NULL = sin confirmación pendiente).
    email_confirmado: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    email_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    email_token_exp: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ClienteARCA(Base):
    """Un cliente monitoreado. Se sincroniza vía 'Mis Comprobantes' con la clave fiscal del CLIENTE
    (CUIT + clave que carga el contador; el contador NUNCA usa su propia clave). Ya no usa
    certificado: el scraping va con cuit+clave."""

    __tablename__ = "clientes_arca"

    cuit: Mapped[str] = mapped_column(String(11), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(200))
    # CUIT de la credencial ARCA (de un CLIENTE) con cuya clave fiscal se sincroniza este cliente:
    # para un titular coincide con su propio `cuit`; para un representado es el CUIT del que lo
    # representa. La columna física sigue llamándose `cuit_contador` por historia (evita migración).
    cuit_credencial: Mapped[str] = mapped_column(
        "cuit_contador", String(11), ForeignKey("contadores.cuit"), index=True
    )
    # Dueño en Órbita: el contador-usuario que administra este cliente. Distinto de cuit_credencial,
    # que es el CUIT de la credencial ARCA (del CLIENTE) con cuya clave fiscal se sincroniza — NO la
    # clave del contador. Nullable por datos previos al multi-tenant.
    usuario_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("usuarios.id"), nullable=True, index=True
    )
    # Régimen impositivo AUTORITATIVO, traído del padrón de ARCA (fuente oficial). 'monotributo'
    # si figura en el padrón de Monotributo; 'no_monotributo' si el padrón confirma que NO lo es
    # (RI / exento / empleado / consumidor final). None = todavía no se consultó el padrón (en ese
    # caso el régimen se infiere de los comprobantes que emite). Ver services/sincronizacion.py.
    regimen: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Padrón de Monotributo (real, traído del portal Monotributo). Nullable: si el cliente no es
    # monotributista (p. ej. Responsable Inscripto) o aún no se trajo, quedan en None.
    categoria: Mapped[str | None] = mapped_column(String(2), nullable=True)
    actividad: Mapped[str | None] = mapped_column(String(20), nullable=True)  # comercio | servicios
    prox_recategorizacion: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # Ventana de recategorización REAL, traída del padrón de ARCA (fechas oficiales, ISO aaaa-mm-dd):
    # `recat_ventana_desde` abre la ventana, `recat_ventana_hasta` es la fecha límite para recategorizar.
    # Reemplazan el calendario hardcodeado (5/8 y 5/2) que el front generaba solo: cuando ARCA prorroga
    # una fecha, ésta manda. `recat_mostrar_alerta` = si ARCA marca que corresponde recategorizar (aún
    # bajo estudio si es por-cliente o de calendario). Nullable: sólo titular monotributista.
    recat_ventana_desde: Mapped[str | None] = mapped_column(String(20), nullable=True)
    recat_ventana_hasta: Mapped[str | None] = mapped_column(String(20), nullable=True)
    recat_mostrar_alerta: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Estado de la cuota (CCMA) y próximo vencimiento (portal Monotributo). Nullable: sólo titular
    # monotributista; para representados / no-monotributistas quedan en None.
    cuota_estado: Mapped[str | None] = mapped_column(String(12), nullable=True)  # al-dia | con-deuda
    cuota_deuda: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    cuota_saldo_favor: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    prox_venc_fecha: Mapped[str | None] = mapped_column(String(20), nullable=True)
    prox_venc_importe: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    debito_automatico: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Cuántos meses SEGUIDOS de monotributo adeuda hoy (de la Consulta de Saldos de la CCMA). 0 = al
    # día; None = no se sabe / no aplica (no monotributista). Alimenta la alerta de deuda por meses.
    meses_adeudados: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # ¿El cliente tiene relación de dependencia (trabajo en blanco)? Dato relevante para el contador:
    # parte de las compras a "consumidor final" pueden quedar justificadas por el haber percibido.
    # Esta columna guarda el valor DETECTADO automáticamente por "Aportes en Línea": True/False según
    # tenga remuneraciones informadas al SIPA (ver services/aportes.py). El contador puede marcarlo a
    # mano: ese override vive en edicion_json (clave relacionDependencia) y gana sobre esta columna
    # al momento de mostrar. Ver clientes.py y la memoria `aportes-en-linea-misaportes`.
    relacion_dependencia: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Remuneración del empleado en relación de dependencia (servicio "Aportes en Línea"/MisAportes),
    # JSON serializado: {empleadores:[{razon_social,cuit}], remuneraciones:[{periodo,bruto,incluye_sac}],
    # total_bruto, periodo_desde, periodo_hasta, actualizado_en}. Alimenta el respaldo de gastos en la
    # ficha. None = no consultado / sin relación de dependencia. Ver services/aportes.py.
    remuneraciones_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Cuándo el motor chequeó por ÚLTIMA vez "Aportes en Línea" (relación de dependencia). NULL = nunca:
    # el worker lo consulta una vez (baja cadencia) y setea la fecha; los que tienen relación de
    # dependencia se refrescan semanal, los que no, se re-chequean cada ~30 días (pueden empezar a
    # trabajar en blanco). Mismo patrón que agro_chequeado_en. Ver services/aportes.py::paso_worker.
    aportes_chequeado_en: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Facturómetro del portal Monotributo: ingresos brutos de los últimos 12 meses según ARCA
    # (facturacion_12m), tope oficial de la categoría actual (tope_categoria) y la fecha de corte que
    # informa ARCA (facturometro_actualizado, dd/mm/aaaa). Numerador y denominador OFICIALES del gauge
    # facturación-vs-tope. Nullable: sólo titular monotributista con facturómetro.
    facturacion_12m: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    tope_categoria: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    facturometro_actualizado: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Detalle de deuda de la CCMA (JSON serializado): totales, desglose capital/intereses y el
    # ledger de movimientos por período. Lo llena scraping/ccma.py vía sincronización. Nullable.
    deuda_detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Contacto del cliente FINAL (no confundir con el email/teléfono del CONTADOR, que viven en
    # Usuario). Lo carga el contador a mano (en la ficha) o por importación masiva desde un Excel;
    # ARCA no lo provee. Alimenta el recordatorio mensual de vencimientos por mail. Sólo se usa el
    # mail; el teléfono se guarda para un canal futuro (hoy no se envía nada por ahí). `venc_avisos`
    # = opt-out por cliente: None/True lo incluye en los recordatorios, False lo excluye. Nullable.
    email_cliente: Mapped[str | None] = mapped_column(String(200), nullable=True)
    telefono_cliente: Mapped[str | None] = mapped_column(String(40), nullable=True)
    venc_avisos: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Último período (aaaa-mm) en que se le envió el recordatorio de vencimiento. Hace idempotente el
    # job mensual: si ya se avisó este mes, no se reenvía (sobrevive reinicios/redeploys del worker,
    # a diferencia de un contador en memoria). NULL = nunca se le avisó. Ver services/vencimientos.py.
    venc_notificado_periodo: Mapped[str | None] = mapped_column(String(7), nullable=True)
    # Ediciones MANUALES del contador (nombre/categoría/actividad/fecha inicio/estado cuota/notas) en
    # JSON. Va SEPARADO de las columnas crudas a propósito: la sincronización de ARCA pisa nombre/
    # categoría/etc., pero el override del contador vive acá y se re-aplica al devolver el cliente
    # (gana sobre el dato de ARCA). Ver routers/clientes.py. Nullable = sin ediciones.
    edicion_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Snapshot de los datos fiscales del cliente como EMISOR (domicilio comercial/fiscal, localidad,
    # provincia, CP) traído del padrón durante la sync. JSON serializado. Se usa para imprimir la
    # representación del comprobante emitido (RG 5616). Nullable = todavía no se snapshoteó.
    emisor_fiscal_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Actividades económicas DECLARADAS del cliente en el padrón (código AFIP + descripción + período
    # de alta), traídas durante la sync. JSON serializado: [{codigo, descripcion, periodo}]. La primera
    # (orden 1) es la actividad principal. Se muestra en la ficha ("Situación actual"). Distinto de la
    # columna `actividad` (comercio/servicios, clasificación gruesa). Nullable = todavía no se trajo.
    actividades_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Planes de facilidades de pago del cliente ("Mis Facilidades"), traídos en baja cadencia. JSON:
    # [{nro, tipo, fecha, total, cuotas_total, estado_envio, situacion, vigente}]. Nullable = todavía no
    # se consultó; '[]' = se consultó y no tiene planes. Ver services/facilidades.py.
    facilidades_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Cuándo se consultó por última vez Mis Facilidades (NULL = nunca). El worker lo re-chequea con baja
    # cadencia (los planes casi no cambian). Mismo patrón que agro_chequeado_en / aportes_chequeado_en.
    facilidades_chequeado_en: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Línea de base de alertas: cuándo el motor "fotografió" por primera vez el estado de alertas de
    # este cliente. NULL = todavía no se baselineó → la próxima pasada registra sus alertas vigentes
    # como ya conocidas SIN avisar (anti-spam al alta). Ver services/alertas.py::evaluar_y_notificar.
    alertas_baseline_en: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Certificado de facturación electrónica del cliente (WSFEv1), generado on-demand con la clave del
    # PROPIO cliente (scraping/bootstrap.py → CSR + alias + asociación al WS Facturación Electrónica) y
    # cifrado con Fernet. Sólo se usa para EMITIR comprobantes desde la app; la sincronización sigue
    # yendo por clave fiscal. NULL = todavía no se generó (se genera en la primera emisión).
    cert_cifrado: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_cifrado: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    cert_actualizado_en: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    creado_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # ARCA forzó al cliente a cambiar su Clave Fiscal (campaña de seguridad de AFIP): hasta que el
    # titular la cambie en el sitio de ARCA, ninguna sincronización puede entrar. La sync lo detecta y
    # lo prende (ver services/sincronizacion.py); una sync exitosa lo apaga solo. Se muestra en la
    # lista de clientes para que el contador le avise al cliente. No lo arreglamos nosotros.
    clave_requiere_cambio: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    # La Clave Fiscal guardada del cliente dejó de servir para acceder a su información: ARCA la rechaza
    # (clave mal cargada o que el cliente cambió) o el acceso falla repetidamente. A diferencia de
    # clave_requiere_cambio (AFIP fuerza el cambio), acá el contador lo resuelve cargando la clave
    # correcta desde la ficha. La sync lo prende (ver services/sincronizacion.py) y una sync exitosa lo
    # apaga solo. Se muestra en la lista de clientes.
    clave_invalida: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    # El contribuyente registra irregularidades en el padrón de ARCA: al fijar el contribuyente, ARCA
    # devuelve una pantalla de error ("registra irregularidades... dirigirse a la dependencia... Err:
    # 002") en vez de habilitar la consulta de comprobantes. La sync lo detecta y lo prende (ver
    # services/sincronizacion.py); una sync exitosa lo apaga solo. Se muestra en la lista de clientes
    # para que el contador le avise al cliente que regularice en la dependencia. No lo arreglamos nosotros.
    contribuyente_irregular: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    # Línea de base del Domicilio Fiscal Electrónico: cuándo el motor "fotografió" por primera vez las
    # comunicaciones de este cliente. NULL = todavía no se baselineó → la primera pasada guarda las
    # comunicaciones vigentes como YA VISTAS (sin punto rojo ni alerta); sólo las que aparezcan después
    # cuentan como novedad para el contador. Espeja el criterio de alertas_baseline_en. Ver
    # services/comunicaciones.py.
    dfe_baseline_en: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # ¿El cliente factura por Liquidaciones Electrónicas del sector primario (agro)? Cuando está en
    # True se le sincronizan esas liquidaciones (aparte de Mis Comprobantes) y se muestran en su
    # apartado de Facturación Agropecuaria, sumándose a su facturación. Lo tilda el contador en el
    # alta/ficha, o lo prende solo la barrida inicial si le detecta liquidaciones. Sync SEMANAL
    # (aparecen rara vez). Ver services/agro.py y la memoria `facturacion-agropecuaria`.
    factura_agro: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    # Cuándo el motor chequeó por ÚLTIMA vez si este cliente tiene liquidaciones del agro. NULL =
    # nunca chequeado → en su próxima sync el worker hace la DETECCIÓN una sola vez (liviana, sólo
    # grilla) y setea esta fecha; si no tiene, no vuelve a chequear. Los que SÍ tienen (factura_agro=
    # True) se re-sincronizan semanalmente (ver services/agro.py::paso_worker). Reemplaza la barrida
    # masiva (que gatillaba el rate-limit de ARCA) por detección gradual repartida en el ciclo del motor.
    agro_chequeado_en: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Cuándo se INTENTÓ por última vez consultar el agro (éxito o fallo). Lo usa el backoff de
    # services/agro.py::paso_worker: ante un fallo (ARCA rate-limitea el servicio LSP) NO se reintenta
    # en la próxima pasada sino recién pasado un cooldown (detección semanal, marcados diario). Corta el
    # bucle de reintentos que, multiplicado por toda la cartera, auto-gatillaba el bloqueo de ARCA.
    agro_ultimo_intento: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # ¿El contador tiene activo el monitoreo de este cliente? En False el cliente queda "pausado": el
    # motor de sincronización lo saltea (deja de traer sus datos) y en la lista del contador aparece
    # atenuado como "Desactivado". Lo prende/apaga el propio contador desde la ficha. Default True
    # (un alta nueva entra activa). Distinto de los flags de clave (que los maneja la sync sola).
    activo: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="1", nullable=False
    )
    # True = el monitoreo se pausó AUTOMÁTICAMENTE por una baja en cascada (se deshabilitó al contador
    # del estudio), no porque el contador lo pausara a mano. Externamente es idéntico a una pausa
    # manual (aparece "Desactivado" y el motor lo saltea); internamente distingue el origen para poder
    # despausar SÓLO estos al reactivar la cuenta, respetando lo que el contador pausó por su cuenta.
    # Un toggle manual del monitoreo lo limpia. Ver routers/admin.py (_cascada_desactivar/_reactivar).
    desactivado_en_cascada: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )


class ComprobanteEmitido(Base):
    """Cache local de un comprobante emitido traído de 'Mis Comprobantes'.

    `imp_total` SIEMPRE está en PESOS (valor canónico para sumas/tope/conciliación). Para
    comprobantes en moneda extranjera (p.ej. Factura E de exportación en USD), `imp_total_origen`
    guarda el monto en la moneda original y `cotizacion` el tipo de cambio del día de emisión:
    imp_total = imp_total_origen × cotizacion. Para pesos: moneda='ARS', cotizacion=1 e
    imp_total_origen == imp_total."""

    __tablename__ = "comprobantes_emitidos"
    __table_args__ = (
        UniqueConstraint(
            "cuit", "direccion", "punto_venta", "cbte_tipo", "numero", name="uq_comprobante"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cuit: Mapped[str] = mapped_column(String(11), ForeignKey("clientes_arca.cuit"), index=True)
    direccion: Mapped[str] = mapped_column(String(10), default="emitido", index=True)  # emitido | recibido
    cbte_tipo: Mapped[int] = mapped_column(Integer)
    punto_venta: Mapped[int] = mapped_column(Integer)
    numero: Mapped[int] = mapped_column(Integer)
    fecha: Mapped[dt.date] = mapped_column()
    imp_total: Mapped[float] = mapped_column(Numeric(15, 2))  # SIEMPRE en pesos (canónico)
    moneda: Mapped[str] = mapped_column(String(8), default="ARS")
    cotizacion: Mapped[float] = mapped_column(Numeric(15, 6), default=1)
    imp_total_origen: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    doc_nro: Mapped[str] = mapped_column(String(20), default="")
    contraparte_nombre: Mapped[str] = mapped_column(String(200), default="")
    cae: Mapped[str] = mapped_column(String(20), default="")
    # Vencimiento del CAE (yyyymmdd). Sólo lo tienen los comprobantes EMITIDOS desde la app (lo
    # devuelve FECAESolicitar); los traídos de Mis Comprobantes quedan en "". Necesario para imprimir
    # la representación del comprobante (el vto del CAE va en el pie, RG 5616).
    cae_vto: Mapped[str] = mapped_column(String(10), default="")
    # Condición frente al IVA del RECEPTOR (RG 5616): 1 RI · 4 Exento · 5 Consumidor Final · 6 Monotributo.
    # Sólo en comprobantes emitidos desde la app (es el dato que se eligió al emitir); se imprime en la
    # representación del comprobante. NULL = no registrada (filas previas a esta columna).
    condicion_iva_receptor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Detalle de renglones del comprobante emitido desde la app: JSON [{descripcion, cantidad,
    # precio_unitario}]. NULL = sin desglose (se facturó por importe total, un único renglón). OJO:
    # WSFEv1 (clase C) NO transmite líneas a ARCA —el comprobante ante ARCA es sólo el total—; este
    # detalle es exclusivamente para la representación impresa (PDF).
    items_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Origen del dato: 'arca' (traído de Mis Comprobantes o emitido por WSFEv1) | 'manual' (cargado a
    # mano por el contador: factura de talonario en papel, ticket de gasto que no figura en ARCA). El
    # sync PROTEGE los manuales (no los pisa ni los borra) y sólo se eliminan desde la app.
    origen: Mapped[str] = mapped_column(String(10), default="arca", server_default="arca")
    sincronizado_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class LiquidacionAgro(Base):
    """Liquidación Electrónica del sector primario (agro) de un cliente productor.

    Son comprobantes de sectores primarios (Hacienda y Carne, Lechería, Tabaco, Azúcar) que NO
    aparecen en 'Mis Comprobantes': los EMITE el comprador/acopiador y el productor los RECIBE
    (`direccion='receptor'`, el ~95%), o los emite el propio cliente (`direccion='emisor'`). Son la
    venta real del cliente y se suman a su facturación. `importe_bruto` = la venta bruta (para
    topes de monotributo; se lee del PDF, ver services/liquidacion_pdf.py). `liq_id` es el id de
    AFIP (clave estable para deduplicar). Ver la memoria `facturacion-agropecuaria`."""

    __tablename__ = "liquidaciones_agro"
    __table_args__ = (
        UniqueConstraint("cuit", "liq_id", name="uq_liquidacion_agro"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cuit: Mapped[str] = mapped_column(String(11), ForeignKey("clientes_arca.cuit"), index=True)
    liq_id: Mapped[str] = mapped_column(String(20))  # id de AFIP (getPdf?id=)
    sector: Mapped[str] = mapped_column(String(12), default="hacienda")  # hacienda | lecheria | ...
    direccion: Mapped[str] = mapped_column(String(10), default="receptor")  # receptor | emisor
    cbte_tipo: Mapped[int] = mapped_column(Integer)          # 180-191 (sector pecuario), etc.
    tipo_liq: Mapped[str] = mapped_column(String(80), default="")  # descripción legible de AFIP
    punto_venta: Mapped[int] = mapped_column(Integer, default=0)
    numero: Mapped[int] = mapped_column(Integer, default=0)
    cuit_contraparte: Mapped[str] = mapped_column(String(11), default="")  # emisor (o receptor)
    fecha_comprobante: Mapped[dt.date | None] = mapped_column(nullable=True)
    fecha_emision: Mapped[dt.date | None] = mapped_column(nullable=True)
    sistema: Mapped[str] = mapped_column(String(4), default="")  # WB (web) | WS (web services)
    importe_bruto: Mapped[float] = mapped_column(Numeric(15, 2), default=0)  # venta bruta (del PDF)
    sincronizado_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Extraccion(Base):
    """Bitácora de cada sincronización con ARCA (Mis Comprobantes) de un cliente: cuándo se corrió,
    si salió bien, cuántos comprobantes procesó, cuánto tardó y el motivo si falló."""

    __tablename__ = "extracciones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cuit: Mapped[str] = mapped_column(String(11), ForeignKey("clientes_arca.cuit"), index=True)
    fecha: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    resultado: Mapped[str] = mapped_column(String(10))  # exitosa | fallida
    comprobantes: Mapped[int] = mapped_column(Integer, default=0)
    duracion_ms: Mapped[int] = mapped_column(Integer, default=0)
    motivo: Mapped[str | None] = mapped_column(String(300), nullable=True)


class CaptchaEvento(Base):
    """Métrica: cada vez que ARCA muestra un captcha de imagen en el login de un CUIT. Sirve para
    saber en CUÁNTAS cuentas distintas (y con qué frecuencia) aparece el desafío — si pasa en cuentas
    puntuales o es generalizado. Sin FK a propósito (es dato de métrica; no se borra en cascada con el
    cliente y sobrevive para el histórico)."""

    __tablename__ = "captcha_eventos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cuit: Mapped[str] = mapped_column(String(11), index=True)  # CUIT con el que se logueó (credencial)
    fecha: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    resuelto: Mapped[bool] = mapped_column(Boolean, default=False)  # CapSolver lo pasó y el login entró
    intentos: Mapped[int] = mapped_column(Integer, default=0)  # imágenes resueltas en ese login


class AlertaEnviada(Base):
    """ESTADO de cada alerta notificada por contador, para mandar SÓLO lo nuevo y no reenviar lo ya
    avisado. Clave lógica = (usuario_id, cuit, tipo, severidad). Una alerta vigente con `activa=True`
    ya fue avisada y no se repite; cuando se resuelve se pone `activa=False`, así si reaparece más
    tarde vuelve a contar como nueva. La 'fuente de verdad' de qué alertas existen es el cálculo
    (services/alertas.py); esto sólo registra qué se envió."""

    __tablename__ = "alertas_enviadas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    usuario_id: Mapped[int] = mapped_column(Integer, ForeignKey("usuarios.id"), index=True)
    cuit: Mapped[str] = mapped_column(String(11), index=True)
    tipo: Mapped[str] = mapped_column(String(20))  # tope | recategorizacion | ventana | exclusion | cuota | vencimiento | sync | meses_adeudados
    # Severidad con la que se avisó (urgente | aviso | datos). Forma parte de la clave: si una alerta
    # escala (aviso → urgente) cuenta como nueva y se vuelve a avisar.
    severidad: Mapped[str] = mapped_column(String(10), default="urgente", server_default="urgente")
    # True = alerta vigente ya avisada (no reenviar). False = resuelta (re-armada para futuros avisos).
    activa: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # Valor de la métrica cuando se avisó (ej. % del tope, ratio de gastos, deuda/cuota). Se usa para el
    # RE-AVISO por subida: se re-notifica sólo si el valor actual supera este + el umbral de subida del
    # tipo. NULL en alertas binarias (recategorización, sync, vencimiento) que no tienen magnitud.
    valor: Mapped[float | None] = mapped_column(Numeric(15, 4), nullable=True)
    enviada_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class MovimientoBancario(Base):
    """Una acreditación importada de un extracto bancario o export de billetera (MercadoPago, etc.)
    y cruzada contra los comprobantes EMITIDOS reales del cliente. El cruce automático lo calcula
    el matcher (services/conciliacion.py); acá se persiste el resultado + la decisión del contador
    sobre lo que no matcheó. Sólo se guardan ACREDITACIONES (monto > 0): los débitos se descartan."""

    __tablename__ = "movimientos_bancarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cuit: Mapped[str] = mapped_column(String(11), ForeignKey("clientes_arca.cuit"), index=True)
    fecha: Mapped[dt.date] = mapped_column()
    monto: Mapped[float] = mapped_column(Numeric(15, 2))
    fuente: Mapped[str] = mapped_column(String(12), default="banco")  # banco | mercadopago | otro
    cuit_originante: Mapped[str | None] = mapped_column(String(20), nullable=True)
    nombre_originante: Mapped[str | None] = mapped_column(String(200), nullable=True)
    descripcion: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Resultado del matcher: el id COMPUESTO del comprobante (cuit-direccion-pv-tipo-numero), idéntico
    # al que arma comprobantes_cliente() en routers/clientes.py, para que el front lo cruce directo.
    comprobante_matcheado_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    match_confianza: Mapped[str | None] = mapped_column(String(10), nullable=True)  # alta | media | sugerido
    # Decisión manual del contador sobre un movimiento sin match automático.
    marcado_como: Mapped[str | None] = mapped_column(String(20), nullable=True)  # ingreso-actividad | no-es-venta
    marcado_por: Mapped[str | None] = mapped_column(String(120), nullable=True)
    marcado_en: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lote_id: Mapped[str] = mapped_column(String(40), default="", index=True)  # agrupa una importación
    # Idempotencia: re-subir el mismo extracto no duplica filas (hash de cuit+fecha+monto+desc+originante).
    hash_dedup: Mapped[str] = mapped_column(String(64), index=True, default="")
    importado_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AuditoriaAdmin(Base):
    """Bitácora de acciones sensibles del panel superadmin: quién (admin) hizo qué (activar /
    desactivar / cambiar rol / impersonar) sobre qué cuenta y cuándo. Sólo se escribe; sirve para
    trazabilidad de soporte y seguridad. Ver routers/admin.py."""

    __tablename__ = "auditoria_admin"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[int] = mapped_column(Integer, ForeignKey("usuarios.id"), index=True)
    admin_email: Mapped[str] = mapped_column(String(120), default="")  # desnormalizado (sobrevive borrados)
    accion: Mapped[str] = mapped_column(String(30))  # activar | desactivar | cambiar_rol | impersonar
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # cuenta afectada
    target_email: Mapped[str] = mapped_column(String(120), default="")
    detalle: Mapped[str | None] = mapped_column(String(300), nullable=True)
    fecha: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class ComunicacionDFE(Base):
    """Una comunicación del Domicilio Fiscal Electrónico (DFE / e-ventanilla) de un cliente, cacheada
    localmente. La trae el motor (afip.notificaciones_listar) en la pasada de sync y se upsertea por
    (cuit, id_comunicacion). El estado 'leída' vive en dos planos a propósito:

    - `leida_arca`: cómo figura en ARCA (la marca ARCA sola al pedir el detalle de la comunicación).
    - `vista_por_contador`: si el contador la abrió DESDE Órbita. Es lo que dispara el punto rojo de
      "comunicaciones sin ver". Al abrirla en Órbita pedimos el detalle (→ ARCA la marca leída) y la
      marcamos vista acá. En el primer sync del cliente todas las vigentes nacen `vista=True`
      (baseline anti-spam, ver ClienteARCA.dfe_baseline_en): sólo las nuevas aparecen como novedad."""

    __tablename__ = "comunicaciones_dfe"
    __table_args__ = (
        UniqueConstraint("cuit", "id_comunicacion", name="uq_comunicacion_dfe"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cuit: Mapped[str] = mapped_column(String(11), ForeignKey("clientes_arca.cuit"), index=True)
    # idComunicacion de ARCA (clave del lado de ellos). String por las dudas (a veces viene numérico).
    id_comunicacion: Mapped[str] = mapped_column(String(40))
    fecha_publicacion: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fecha_vencimiento: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sistema: Mapped[str | None] = mapped_column(String(200), nullable=True)  # sistema/organismo publicador
    organismo: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Resumen que trae la lista (el mensaje completo se baja on-demand al abrirla → `detalle`).
    asunto: Mapped[str | None] = mapped_column(String(500), nullable=True)
    prioridad: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tiene_adjunto: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # Mensaje completo, cacheado la primera vez que el contador abre la comunicación (NULL = no bajado).
    detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    leida_arca: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    vista_por_contador: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    sincronizado_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    creado_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class WorkerHeartbeat(Base):
    """Latido del contenedor worker (motor de sync continuo). Fila ÚNICA (id=1) que el worker pisa
    en cada vuelta del loop; el panel admin la lee para saber si el motor está vivo y qué clientes
    está sincronizando ahora. Ver app/worker/loop.py y routers/admin_sync.py."""

    __tablename__ = "worker_heartbeat"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # siempre 1
    actualizado_en: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    en_vuelo: Mapped[str] = mapped_column(Text, default="[]")  # JSON: cuits sincronizándose ahora
    concurrencia: Mapped[int] = mapped_column(Integer, default=0)
    intervalo_horas: Mapped[int] = mapped_column(Integer, default=0)
