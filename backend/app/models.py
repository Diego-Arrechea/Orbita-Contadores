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


class Contador(Base):
    """Credencial de acceso a ARCA (CUIT + clave fiscal, cifrada con Fernet) usada para sincronizar
    'Mis Comprobantes' automáticamente.

    OJO — el nombre es histórico y ENGAÑOSO: esto NO es la clave del contador-usuario de Órbita. El
    contador NUNCA carga su propia clave fiscal ni su CUIT: carga las credenciales (CUIT + clave
    fiscal) de sus CLIENTES, y eso es lo que se guarda acá. `cuit` es el de esa credencial de cliente."""

    __tablename__ = "contadores"

    cuit: Mapped[str] = mapped_column(String(11), primary_key=True)
    clave_cifrada: Mapped[bytes] = mapped_column(LargeBinary)
    creado_en: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Usuario(Base):
    """El contador registrado en Órbita: su login propio (email + contraseña hasheada).
    Distinto de `Contador`, que guarda la clave fiscal de ARCA para el scraping. El `cuit` de
    acá puede coincidir con el de un `Contador`, pero son tablas independientes a propósito."""

    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nombre: Mapped[str] = mapped_column(String(80))
    apellido: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    telefono: Mapped[str] = mapped_column(String(30))
    dni: Mapped[str] = mapped_column(String(10))
    cuit: Mapped[str] = mapped_column(String(11), unique=True, index=True)
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
    # Cuenta habilitada. False = el contador no puede iniciar sesión ni operar (la deshabilita un
    # admin desde el panel). El chequeo vive en login y en usuario_actual.
    activo: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
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
    # Fin del período de prueba GRATIS (30 días). Se setea al registrarse; las cuentas previas a la
    # feature se backfillean a 30 días desde la migración (ver db._migrar_usuarios). Informativo: se
    # muestra el conteo en el header. NULL = sin trial definido (no debería pasar tras la migración).
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
    cuit_contador: Mapped[str] = mapped_column(
        String(11), ForeignKey("contadores.cuit"), index=True
    )
    # Dueño en Órbita: el contador-usuario que administra este cliente. Distinto de cuit_contador,
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
    # Estado de la cuota (CCMA) y próximo vencimiento (portal Monotributo). Nullable: sólo titular
    # monotributista; para representados / no-monotributistas quedan en None.
    cuota_estado: Mapped[str | None] = mapped_column(String(12), nullable=True)  # al-dia | con-deuda
    cuota_deuda: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    cuota_saldo_favor: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    prox_venc_fecha: Mapped[str | None] = mapped_column(String(20), nullable=True)
    prox_venc_importe: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    debito_automatico: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
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
    # Ediciones MANUALES del contador (nombre/categoría/actividad/fecha inicio/estado cuota/notas) en
    # JSON. Va SEPARADO de las columnas crudas a propósito: la sincronización de ARCA pisa nombre/
    # categoría/etc., pero el override del contador vive acá y se re-aplica al devolver el cliente
    # (gana sobre el dato de ARCA). Ver routers/clientes.py. Nullable = sin ediciones.
    edicion_json: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    tipo: Mapped[str] = mapped_column(String(20))  # tope | recategorizacion | ventana | exclusion | cuota | vencimiento | sync
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
