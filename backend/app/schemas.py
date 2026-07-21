"""Schemas Pydantic. ComprobanteOut replica el tipo `Comprobante` de src/types/index.ts."""
from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

# Mapa CbteTipo (AFIP, FEParamGetTiposCbte) -> TipoComprobante (Órbita).
# Los nombres de Notas de Crédito CONTIENEN "Nota Crédito" a propósito: así el cálculo las
# detecta para RESTARLAS (derivarHistorial), sin importar la clase (A/B/C/M/FCE/tique).
TIPO_COMPROBANTE: dict[int, str] = {
    # Clase A
    1: "Factura A", 2: "Nota Débito A", 3: "Nota Crédito A", 4: "Recibo A",
    201: "Factura FCE A", 202: "Nota Débito FCE A", 203: "Nota Crédito FCE A",
    # Clase B
    6: "Factura B", 7: "Nota Débito B", 8: "Nota Crédito B", 9: "Recibo B",
    206: "Factura FCE B", 207: "Nota Débito FCE B", 208: "Nota Crédito FCE B",
    # Clase C (monotributo)
    11: "Factura C", 12: "Nota Débito C", 13: "Nota Crédito C", 15: "Recibo C",
    211: "Factura FCE C", 212: "Nota Débito FCE C", 213: "Nota Crédito FCE C",
    # Clase M
    51: "Factura M", 52: "Nota Débito M", 53: "Nota Crédito M", 54: "Recibo M",
    # Exportación
    19: "Factura E", 20: "Nota Débito E", 21: "Nota Crédito E",
    # Controlador fiscal (tiques)
    81: "Tique Factura A", 82: "Tique Factura B", 83: "Tique",
    # Controlador fiscal VIEJO (una sola serie por clase; la NC no discrimina A/B/C).
    109: "Tique C", 110: "Tique Nota Crédito",
    111: "Tique Factura C",
    112: "Tique Nota Crédito A", 113: "Tique Nota Crédito B", 114: "Tique Nota Crédito C",
    115: "Tique Nota Débito A", 116: "Tique Nota Débito B", 117: "Tique Nota Débito C",
}


def nombre_tipo(cbte_tipo: int) -> str:
    return TIPO_COMPROBANTE.get(cbte_tipo, f"Tipo {cbte_tipo}")


# Comprobantes clase C (+ FCE C + tiques C, incluido el controlador fiscal VIEJO 109/110): los
# ÚNICOS que puede emitir un monotributista. Si EMITE algo fuera de este set (clase A/B/M/E), es RI.
# OJO 109 "Tique C": lo emite el monotributista con controlador viejo; sin él la inferencia lo
# marcaba RI cuando el padrón no traía el régimen (caso GARCIA 27316644614).
TIPOS_MONOTRIBUTO: set[int] = {11, 12, 13, 15, 211, 212, 213, 109, 110, 111, 114, 117}


# cbte_tipos de Notas de Crédito (todas las clases + FCE + tiques): se RESTAN al netear el mes,
# igual que hace derivarHistorial en el front (que usa el nombre 'Nota Crédito' para detectarlas).
TIPOS_NOTA_CREDITO: set[int] = {3, 8, 13, 21, 53, 110, 112, 113, 114, 203, 208, 213}


def clasificar_regimen(cbte_tipos_emitidos: set[int]) -> str | None:
    """Deduce el régimen por lo que el contribuyente EMITE: sólo clase C → 'monotributo'; alguna
    otra clase → 'responsable_inscripto'. Sin comprobantes emitidos → None (no hay evidencia)."""
    if not cbte_tipos_emitidos:
        return None
    return "monotributo" if cbte_tipos_emitidos <= TIPOS_MONOTRIBUTO else "responsable_inscripto"


def resolver_regimen(almacenado: str | None, inferido: str | None) -> str | None:
    """Combina el régimen AUTORITATIVO del padrón ARCA (`almacenado`, fuente oficial) con el
    `inferido` de los comprobantes emitidos. Precedencia:
      1) padrón dice monotributo             → 'monotributo'
      2) evidencia dura de RI (emite A/B/M/E) → 'responsable_inscripto'
      3) padrón dice responsable_inscripto   → 'responsable_inscripto'  (del padrón de impuestos: IVA)
      4) padrón dice que NO es monotributista → 'no_monotributo'
      5) inferencia por comprobantes (clase C → monotributo) o None si no hay evidencia.
    Nunca inventa 'monotributo' sin evidencia: None = sin determinar (el front no fabrica categoría).
    """
    if almacenado == "monotributo":
        return "monotributo"
    if inferido == "responsable_inscripto":
        return "responsable_inscripto"
    if almacenado == "responsable_inscripto":
        return "responsable_inscripto"
    if almacenado == "no_monotributo":
        return "no_monotributo"
    return inferido


class ComprobanteOut(BaseModel):
    """Shape EXACTO del `Comprobante` que consume el frontend (camelCase a propósito)."""

    id: str
    direccion: str = "emitido"
    tipo: str
    cbteTipo: int  # noqa: N815 — código numérico ARCA (11 Factura C, 13 NC C…), para descargar el PDF
    fechaEmision: str  # noqa: N815 — matchea el front
    puntoVenta: int  # noqa: N815
    numero: str
    monto: float  # SIEMPRE en pesos (canónico para sumas/tope)
    moneda: str = "ARS"
    cotizacion: float = 1.0
    montoOrigen: float  # noqa: N815 — monto en la moneda original (para mostrar en la lista)
    contraparteNombre: str = "—"  # noqa: N815
    contraparteCuit: str  # noqa: N815
    # True sólo para los comprobantes EMITIDOS desde la app (tienen cae_vto): se les puede generar la
    # representación impresa (PDF). Los traídos de Mis Comprobantes no — su PDF oficial vive en ARCA.
    tienePdf: bool = False  # noqa: N815
    # 'arca' (traído de Mis Comprobantes o emitido por la app) | 'manual' (lo cargó el contador a mano).
    origen: str = "arca"


# cbte_tipos habilitados en la CARGA MANUAL: cualquier tipo REGISTRADO (el catálogo completo), para
# ventas y compras. La app soporta clientes de cualquier régimen (monotributo clase C, RI clase A/B,
# M, exportación E, FCE, tiques), así que no se restringe por dirección.
CBTE_TIPOS_MANUAL: set[int] = set(TIPO_COMPROBANTE)


class ComprobanteManualIn(BaseModel):
    """Alta MANUAL de un comprobante que no figura en Mis Comprobantes (factura de talonario en papel,
    ticket de gasto). `direccion='emitido'` es una venta (suma al facturado); 'recibido' una compra/gasto."""

    direccion: str
    cbte_tipo: int
    fecha: dt.date
    punto_venta: int = 0
    numero: int
    importe_total: float  # en pesos (canónico)
    contraparte_nombre: str = ""
    contraparte_cuit: str = ""

    @field_validator("direccion")
    @classmethod
    def _direccion_valida(cls, v: str) -> str:
        if v not in ("emitido", "recibido"):
            raise ValueError("La dirección debe ser 'emitido' o 'recibido'.")
        return v

    @field_validator("importe_total")
    @classmethod
    def _importe_positivo(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("El importe debe ser mayor a 0.")
        return round(v, 2)

    @field_validator("punto_venta", "numero")
    @classmethod
    def _no_negativo(cls, v: int) -> int:
        if v < 0:
            raise ValueError("El punto de venta y el número no pueden ser negativos.")
        return v

    @field_validator("contraparte_cuit")
    @classmethod
    def _solo_digitos(cls, v: str) -> str:
        return "".join(ch for ch in v if ch.isdigit())

    @model_validator(mode="after")
    def _tipo_registrado(self) -> "ComprobanteManualIn":
        if self.cbte_tipo not in CBTE_TIPOS_MANUAL:
            raise ValueError("El tipo de comprobante no está registrado.")
        return self


class LiquidacionAgroOut(BaseModel):
    """Una Liquidación Electrónica del sector primario (agro) para la ficha del cliente (camelCase)."""

    id: str  # liq_id de AFIP
    direccion: str  # receptor | emisor
    tipo: str  # descripción legible (p.ej. "Liquidación Compra Directa")
    cbteTipo: int  # noqa: N815 — código ARCA (180-191 sector pecuario, etc.)
    puntoVenta: int  # noqa: N815
    numero: str
    fechaComprobante: str | None = None  # noqa: N815 — ISO (aaaa-mm-dd)
    contraparteCuit: str = ""  # noqa: N815 — el emisor (o receptor si direccion=emisor)
    sistema: str = ""  # WB | WS
    importeBruto: float = 0  # noqa: N815 — venta bruta (del PDF), en pesos


class LiquidacionesAgroOut(BaseModel):
    """Apartado de Facturación Agropecuaria del cliente: total + liquidaciones."""

    facturaAgro: bool  # noqa: N815 — si el cliente está marcado como agropecuario
    totalBruto: float  # noqa: N815 — suma de importeBruto de todas las liquidaciones
    liquidaciones: list[LiquidacionAgroOut]


class HistorialMesOut(BaseModel):
    """Un mes agregado del historial del cliente (replica `HistorialMes` del front). El dashboard
    los consume para calcular % tope, ratio de gastos y proyección sin tener que bajar todos los
    comprobantes."""

    mes: str  # aaaa-mm
    emitidasBrutas: float  # noqa: N815
    notasCredito: float  # noqa: N815
    emitidasNetas: float  # noqa: N815
    recibidas: float
    recibidasComputables: float  # noqa: N815
    ingresosNoFacturados: float = 0  # noqa: N815 — siempre 0 desde el backend; lo pisa el front si aplica


class RemuneracionMesOut(BaseModel):
    """Un mes de remuneración bruta declarada al SIPA (relación de dependencia)."""

    periodo: str  # aaaamm
    bruto: float
    incluyeSac: bool = False  # noqa: N815 — incluye SAC/aguinaldo (el '(*)' de ARCA)


class RemuneracionOut(BaseModel):
    """Remuneración del cliente en relación de dependencia ("Aportes en Línea"). Sirve para
    justificar gastos: el haber percibido respalda compras a "consumidor final"."""

    empleadores: list[str] = []  # razones sociales de los empleadores informados
    totalBruto: float = 0  # noqa: N815 — suma de la remuneración bruta del período
    periodoDesde: str | None = None  # noqa: N815 — aaaamm
    periodoHasta: str | None = None  # noqa: N815 — aaaamm
    meses: list[RemuneracionMesOut] = []  # serie mensual (cronológica)


class ActividadOut(BaseModel):
    """Una actividad económica declarada del cliente en el padrón. La primera de la lista es la
    actividad principal (orden 1)."""

    codigo: str | None = None  # código de actividad AFIP (nomenclador)
    descripcion: str | None = None
    periodo: str | None = None  # período de alta (MM/AAAA)


class ClienteOut(BaseModel):
    cuit: str
    nombre: str
    regimen: str | None = None  # monotributo | responsable_inscripto | no_monotributo | None
    categoria: str | None = None
    actividad: str | None = None
    # Actividades económicas DECLARADAS en el padrón (código + descripción + período). La principal
    # primero. Distinto de `actividad` (comercio/servicios, clasificación gruesa). Vacío = sin dato aún.
    actividades: list[ActividadOut] = []
    prox_recategorizacion: str | None = None
    # Ventana de recategorización REAL del padrón de ARCA (ISO aaaa-mm-dd): abre en `recat_ventana_desde`
    # y cierra (fecha límite) en `recat_ventana_hasta`. El front la usa como fecha límite oficial en vez
    # del calendario hardcodeado. `recat_mostrar_alerta` = ARCA marca que corresponde recategorizar.
    recat_ventana_desde: str | None = None
    recat_ventana_hasta: str | None = None
    recat_mostrar_alerta: bool | None = None
    cuota_estado: str | None = None  # al-dia | con-deuda
    cuota_deuda: float | None = None
    cuota_saldo_favor: float | None = None
    prox_venc_fecha: str | None = None
    prox_venc_importe: float | None = None
    debito_automatico: bool | None = None
    meses_adeudados: int | None = None  # meses seguidos de monotributo que adeuda hoy (CCMA); 0 = al día
    facturacion_12m: float | None = None  # ingresos brutos 12m oficiales (facturómetro ARCA)
    tope_categoria: float | None = None  # tope oficial de la categoría actual (facturómetro ARCA)
    facturometro_actualizado: str | None = None  # fecha de corte que informa ARCA (dd/mm/aaaa)
    ultima_extraccion: str | None = None
    resultado_ultima_extraccion: str | None = None
    motivo_ultima_extraccion: str | None = None
    # Editables por el contador (override manual guardado en la cuenta; ver edicion_json):
    notas: str | None = None
    fecha_inicio: str | None = None
    # ¿Tiene relación de dependencia (trabajo en blanco)? Efectivo = override manual del contador si
    # lo marcó, si no el auto-detectado. None = no se sabe. Relevante para justificar gastos.
    relacion_dependencia: bool | None = None
    # Remuneración informada de la relación de dependencia (empleador + total + serie mensual). None
    # si no aplica o aún no se consultó. Alimenta el respaldo de gastos en la ficha.
    remuneracion: RemuneracionOut | None = None
    # Historial mensual agregado (últimos 12 meses calendario, cronológico). Reemplaza el bajar todos
    # los comprobantes en el dashboard: alcanza para % tope, ratio de gastos y proyección.
    historial_mensual: list[HistorialMesOut] = []
    tiene_comprobantes: bool = False  # para el semáforo 'sin datos' sin necesidad de bajarlos
    tiene_facturacion: bool = False  # facturación electrónica habilitada (certificado ya generado)
    # ARCA le pide al cliente cambiar su Clave Fiscal (campaña de seguridad de AFIP). Mientras esté en
    # true, no se puede sincronizar: el contador tiene que avisarle al cliente que la cambie en ARCA.
    clave_requiere_cambio: bool = False
    # La Clave Fiscal guardada del cliente no es válida (ARCA la rechaza o el acceso falla repetido): el
    # contador la corrige cargando la correcta desde la ficha. Distinto de clave_requiere_cambio (que es
    # el cambio forzado por AFIP, que sólo puede hacer el cliente).
    clave_invalida: bool = False
    # El cliente registra irregularidades en su inscripción ante ARCA: la consulta de su información
    # queda bloqueada hasta que regularice su situación en la dependencia donde está inscripto. No lo
    # resolvemos nosotros ni el contador: es un trámite del cliente.
    contribuyente_irregular: bool = False
    # Facturación agropecuaria (Liquidaciones Electrónicas del sector primario): si el cliente factura
    # así, `factura_agro` está en true y `facturacion_agro_12m` es la suma de esas liquidaciones en los
    # últimos 12 meses (para SUMARLA a la facturación 12m del cliente, que no las trae de otra fuente).
    # `facturacion_agro_total` es el histórico. 0 para clientes que no facturan agropecuario.
    factura_agro: bool = False
    facturacion_agro_12m: float = 0
    facturacion_agro_total: float = 0
    # ¿El contador tiene activo el monitoreo de este cliente? En false queda "pausado": no se le
    # actualizan los datos y en la lista se muestra atenuado como "Desactivado".
    activo: bool = True
    # Responsable asignado (equipo del estudio): SÓLO se completa cuando la lista la pide un titular
    # con equipo (para la columna "A cargo de" y "Gestión de usuarios"). Para un contador sin equipo
    # o un empleado quedan en None (todos los clientes de la respuesta son suyos).
    responsable_id: int | None = None
    responsable: str | None = None


class NotificacionesIn(BaseModel):
    """Preferencias de alertas por WhatsApp del contador (sub-bloque de la config). El front manda el
    objeto completo al guardar; el motor (services/alertas.py) lo lee para decidir qué/cuándo enviar."""

    activo: bool | None = None  # recibir alertas por WhatsApp (master on/off del canal)
    horaDesde: int | None = None  # noqa: N815 — ventana horaria disponible (0–23, AR)
    horaHasta: int | None = None  # noqa: N815


class ConfiguracionIn(BaseModel):
    """Preferencias del contador. Todos opcionales: el PUT mergea (parcial) sobre lo ya guardado y el
    front completa con sus defaults. `ventanas` y `alertas` van como dict con la forma que define el
    front (ver src/types/index.ts: VentanaRecategorizacion y ConfigAlertas)."""

    inflacionMensualProyeccion: float | None = None  # noqa: N815
    inflacionAuto: bool | None = None  # noqa: N815 — true: usar inflación esperada del mercado (REM)
    # Criterio por tipo de alerta (umbral + re-aviso). Dict tolerante (forma = ConfigAlertas del front).
    alertas: dict | None = None
    ventanas: list[dict] | None = None
    notificaciones: NotificacionesIn | None = None
    # Personalización del reporte imprimible (secciones on/off, meses de historial, observaciones).
    # Dict tolerante (forma = ReporteConfig del front). Se pisa entero en cada guardado.
    reporte: dict | None = None
    # --- Back-compat: umbrales globales VIEJOS. El front ya no los manda (usa `alertas`), pero se
    # conservan acá para que un config_json viejo sobreviva el round-trip y el front los mapee. ---
    umbralAmarilloPorcentaje: float | None = None  # noqa: N815
    umbralAmarilloDias: int | None = None  # noqa: N815
    umbralRojoDias: int | None = None  # noqa: N815
    umbralRatioGastosAmarillo: float | None = None  # noqa: N815
    umbralDeudaCuotaUrgente: float | None = None  # noqa: N815


class ConfiguracionOut(ConfiguracionIn):
    """Misma forma; el GET devuelve todo None si el contador nunca guardó configuración."""


class EdicionClienteIn(BaseModel):
    """Ediciones manuales del contador sobre un cliente (todas opcionales; el PUT mergea parcial)."""

    nombre: str | None = None
    categoria: str | None = None
    tipoActividad: str | None = None  # noqa: N815 — comercio | servicios
    fechaInicio: str | None = None  # noqa: N815 — aaaa-mm-dd
    estadoCuotaMesActual: str | None = None  # noqa: N815 — al-dia | con-deuda
    notas: str | None = None
    relacionDependencia: bool | None = None  # noqa: N815 — el contador marca si tiene trabajo en blanco
    facturaAgro: bool | None = None  # noqa: N815 — el contador marca/desmarca la facturación agropecuaria


class EstadoClienteIn(BaseModel):
    """Prende/apaga el monitoreo de un cliente (activo/desactivado)."""

    activo: bool


class ClaveClienteIn(BaseModel):
    """Nueva clave fiscal del cliente, para reemplazar la guardada cuando la cambian en ARCA."""

    clave: str = Field(min_length=1)


class ExtraccionOut(BaseModel):
    """Una sincronización con ARCA (replica el tipo `Extraccion` del front)."""

    id: str
    fecha: str  # ISO con hora
    resultado: str  # exitosa | fallida
    motivo: str | None = None
    duracionMs: int | None = None  # noqa: N815
    comprobantes: int | None = None  # cuántos comprobantes trajo esta corrida


class SincronizarOut(BaseModel):
    sincronizados: int


class OnboardingIn(BaseModel):
    """Credenciales del contador para la run primaria (la clave NO se persiste)."""

    cuit: str
    clave: str


class RepresentadoOut(BaseModel):
    cuit: str
    nombre: str


class RepSel(BaseModel):
    cuit: str
    nombre: str


class MonitorearIn(BaseModel):
    """El contador (cuit+clave) elige a quién monitorear; el backend les genera el cert."""

    cuit: str  # CUIT del contador (login)
    clave: str
    seleccionados: list[RepSel]
    # El contador marcó en el alta que este cliente factura por el sector agropecuario: prende
    # `factura_agro` para traerle sus liquidaciones ya desde el arranque (si no, el motor lo detecta
    # solo más adelante). Ver services/agro.py.
    factura_agro: bool = False


class JobOut(BaseModel):
    estado: str  # en_proceso | terminado | error
    progreso: int
    mensaje: str
    resultados: list[dict]
    error: str | None = None


class SubirCertIn(BaseModel):
    """Carga manual: el contador sube el .crt + la .key de un cliente que ya tenía emitidos."""

    cuit: str
    nombre: str
    cert_pem: str
    key_pem: str


class SubirCertOut(BaseModel):
    cuit: str
    nombre: str
    sincronizados: int
    advertencia: str | None = None


# --- Auth (login/registro de contadores) ---


def _solo_digitos(v: str) -> str:
    return "".join(ch for ch in v if ch.isdigit())


class RegistroIn(BaseModel):
    """Alta de un contador. dni/cuit se normalizan a sólo dígitos; la contraseña va en claro
    sólo en tránsito (HTTPS) y se hashea en el backend (nunca se persiste en claro)."""

    nombre: str = Field(min_length=1, max_length=80)
    apellido: str = Field(min_length=1, max_length=80)
    email: EmailStr
    telefono: str = Field(default="", max_length=30)
    dni: str
    cuit: str
    estudio: str = Field(min_length=1, max_length=120)
    matricula: str | None = Field(default=None, max_length=40)
    password: str = Field(min_length=8, max_length=72)  # bcrypt opera sobre <= 72 bytes
    acepto_terminos: bool

    @field_validator("telefono")
    @classmethod
    def _val_telefono(cls, v: str) -> str:
        # Saca todo lo que no sea dígito y los prefijos (país 54, el 9 de celular, el 0 de larga
        # distancia y el 15) para quedarse con el celular canónico: código de área + número = 10
        # dígitos. El front ya manda "+549" + 10 dígitos; esto lo vuelve idempotente y blinda
        # contra hits directos a la API con cualquier formato.
        d = _solo_digitos(v)
        if not d:  # opcional: se puede completar después desde Configuración → Cuenta
            return ""
        for prefijo in ("54", "9", "0", "15"):
            if d.startswith(prefijo):
                d = d[len(prefijo):]
        if len(d) != 10:
            raise ValueError(
                "Teléfono inválido: el celular tiene que tener 10 dígitos "
                "(código de área + número, sin el 0 ni el 15)."
            )
        return "+549" + d

    @field_validator("dni")
    @classmethod
    def _val_dni(cls, v: str) -> str:
        d = _solo_digitos(v)
        if not 7 <= len(d) <= 8:
            raise ValueError("DNI inválido: tiene que tener 7 u 8 dígitos.")
        return d

    @field_validator("cuit")
    @classmethod
    def _val_cuit(cls, v: str) -> str:
        d = _solo_digitos(v)
        if len(d) != 11:
            raise ValueError("CUIT inválido: tiene que tener 11 dígitos.")
        return d

    @field_validator("acepto_terminos")
    @classmethod
    def _val_terminos(cls, v: bool) -> bool:  # noqa: FBT001
        if not v:
            raise ValueError("Tenés que aceptar los términos y condiciones.")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class CambioPasswordIn(BaseModel):
    """Cambio de contraseña estando logueado (Configuración → Cuenta)."""

    password_actual: str
    password_nueva: str = Field(min_length=8, max_length=72)  # bcrypt opera sobre <= 72 bytes


class PerfilIn(BaseModel):
    """Edición de los datos de la cuenta desde Configuración → Cuenta. Sólo campos editables: el
    email y el CUIT son identidad/login y no se tocan acá; el DNI tampoco (dato fiscal)."""

    nombre: str = Field(min_length=1, max_length=80)
    apellido: str = Field(min_length=1, max_length=80)
    telefono: str = Field(default="", max_length=30)
    estudio: str = Field(min_length=1, max_length=120)
    matricula: str | None = Field(default=None, max_length=40)


class BorrarCuentaIn(BaseModel):
    """Borrado de la propia cuenta. Exige la contraseña actual como segundo chequeo (re-auth)."""

    password: str


class AvisoAlertasIn(BaseModel):
    """Registro de que el contador vio el aviso de lanzamiento de alertas. `descartar=True` lo apaga
    para siempre (botón 'Entendido'); False sólo descuenta un ingreso (se mostró esta sesión)."""

    descartar: bool = False


class RecuperarIn(BaseModel):
    """Pedido de recuperación de contraseña ("olvidé mi contraseña"): sólo el email."""

    email: EmailStr


class RestablecerIn(BaseModel):
    """Confirmación del reset: el token del enlace + la contraseña nueva."""

    token: str
    password_nueva: str = Field(min_length=8, max_length=72)


class ConfirmarEmailIn(BaseModel):
    """Confirmación de email: el token del enlace que se mandó al registrarse."""

    token: str


class ResetPasswordAdminOut(BaseModel):
    """Respuesta del reset desde el panel admin: la contraseña temporal que el admin le pasa al
    contador (se muestra una sola vez, no se persiste en claro)."""

    password_temporal: str


class UsuarioOut(BaseModel):
    """Datos del contador que devolvemos al front (sin la contraseña)."""

    id: int
    nombre: str
    apellido: str
    email: EmailStr
    telefono: str
    dni: str
    cuit: str | None = None  # las cuentas de EMPLEADO no cargan CUIT
    estudio: str
    matricula: str | None = None
    rol: str = "contador"  # contador | admin (el front muestra el panel sólo si admin)
    # Confirmación de email: el front muestra el banner "confirmá tu correo" mientras sea False.
    email_confirmado: bool = False
    # Ingresos que faltan para dejar de mostrar el modal de "ya podés configurar tus alertas" (0 = no).
    aviso_alertas_pendiente: int = 0
    # Rollout gateado de facturación electrónica: el front muestra "Emitir comprobante" sólo si True.
    facturacion_habilitada: bool = False
    # Equipo del estudio: True = cuenta de EMPLEADO (creada desde "Gestión de usuarios"); el front
    # le restringe la navegación (sin Novedades/Configuración/Gestión) y esconde las acciones sin
    # permiso. `permisos` trae los efectivos ({clave: bool}); None para cuentas plenas (pueden todo).
    es_empleado: bool = False
    permisos: dict[str, bool] | None = None


class AuthOut(BaseModel):
    """Respuesta de registro/login: token de sesión + datos del contador."""

    token: str
    usuario: UsuarioOut


# --- Movimientos bancarios / Conciliación ---


class MovimientoIn(BaseModel):
    """Una fila YA normalizada del extracto (la arma el front al parsear + mapear el archivo)."""

    fecha: str  # ISO aaaa-mm-dd
    monto: float
    cuitOriginante: str | None = None  # noqa: N815 — matchea el front
    nombreOriginante: str | None = None  # noqa: N815
    descripcion: str | None = None


class ImportarMovimientosIn(BaseModel):
    fuente: str = "banco"  # banco | mercadopago | otro
    filas: list[MovimientoIn]


class MovimientoOut(BaseModel):
    """Shape EXACTO del `MovimientoBancario` que consume el front (camelCase a propósito)."""

    id: str
    fecha: str
    monto: float
    fuente: str
    cuitOriginante: str | None = None  # noqa: N815
    nombreOriginante: str | None = None  # noqa: N815
    descripcion: str | None = None
    comprobanteMatcheadoId: str | None = None  # noqa: N815
    matchConfianza: str | None = None  # noqa: N815 — alta | media | sugerido
    marcadoComo: str | None = None  # noqa: N815 — ingreso-actividad | no-es-venta
    marcadoPorContador: str | None = None  # noqa: N815
    marcadoEn: str | None = None  # noqa: N815


class ImportarResumenOut(BaseModel):
    importados: int
    duplicadosOmitidos: int  # noqa: N815
    debitosOmitidos: int  # noqa: N815
    matcheadosAuto: int  # noqa: N815
    pendientes: int
    movimientos: list[MovimientoOut]


class ClasificarIn(BaseModel):
    """Override manual del contador sobre un movimiento: o lo marca como venta/no-venta, o fuerza
    (o suelta, con comprobanteId=None y marcadoComo=None) un match contra un comprobante puntual."""

    marcadoComo: str | None = None  # noqa: N815 — ingreso-actividad | no-es-venta
    comprobanteId: str | None = None  # noqa: N815


# --- Domicilio Fiscal Electrónico (comunicaciones; ver routers/clientes.py) ---


class ComunicacionOut(BaseModel):
    """Una comunicación del Domicilio Fiscal Electrónico como la consume el front (camelCase)."""

    id: str  # id_comunicacion (clave de ARCA)
    fechaPublicacion: str | None = None  # noqa: N815 — ISO
    fechaVencimiento: str | None = None  # noqa: N815 — ISO
    sistema: str | None = None
    organismo: str | None = None
    asunto: str | None = None  # resumen de la lista
    detalle: str | None = None  # mensaje completo (sólo tras abrirla)
    prioridad: str | None = None
    tieneAdjunto: bool = False  # noqa: N815
    leidaArca: bool = False  # noqa: N815 — cómo figura en ARCA
    vista: bool = False  # el contador la abrió en Órbita (drive del punto rojo)


# --- Equipo del estudio ("Gestión de usuarios"; ver routers/equipo.py) ---


class MiembroIn(BaseModel):
    """Alta de un usuario del equipo (empleado). El titular fija la contraseña inicial y los
    permisos; no se pide CUIT/DNI (la cuenta es interna del estudio)."""

    nombre: str = Field(min_length=1, max_length=80)
    apellido: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)  # bcrypt opera sobre <= 72 bytes
    permisos: dict[str, bool] | None = None  # ausente = todos habilitados


class MiembroPatch(BaseModel):
    """Cambios del titular sobre un miembro (todos opcionales; PATCH parcial). `password` fija una
    contraseña nueva (para cuando el empleado la olvida: el reset por email no aplica acá)."""

    activo: bool | None = None
    permisos: dict[str, bool] | None = None
    password: str | None = Field(default=None, min_length=8, max_length=72)


class MiembroOut(BaseModel):
    """Un usuario del equipo, visto desde "Gestión de usuarios"."""

    id: int
    nombre: str
    apellido: str
    email: EmailStr
    activo: bool
    permisos: dict[str, bool]
    clientes: int = 0  # cuántos clientes tiene asignados
    creado_en: str | None = None  # ISO
    ultimo_acceso: str | None = None  # ISO; None = nunca inició sesión


class AsignarClienteIn(BaseModel):
    """Cambia el responsable de un cliente dentro del equipo (id del titular o de un empleado)."""

    usuario_id: int


class AsignarClientesIn(BaseModel):
    """Asignación EN LOTE: estos clientes pasan a este responsable (flujo de checkboxes del modal
    "Asignar clientes"; evita un request por cliente al repartir carteras grandes)."""

    usuario_id: int
    cuits: list[str] = Field(min_length=1)


# --- Panel superadmin (sólo rol=admin; ver routers/admin.py) ---


class AdminUsuarioOut(BaseModel):
    """Una cuenta de contador vista desde el panel admin (datos + estado + métricas de uso)."""

    id: int
    nombre: str
    apellido: str
    email: EmailStr
    telefono: str
    cuit: str | None = None  # las cuentas de EMPLEADO no cargan CUIT
    estudio: str
    matricula: str | None = None
    rol: str
    activo: bool
    email_confirmado: bool = False  # confirmó su correo al registrarse
    creado_en: str | None = None  # ISO
    ultimo_acceso: str | None = None  # ISO; None = nunca inició sesión
    ultimo_logout: str | None = None  # ISO; None = nunca registró un cierre de la app
    clientes: int = 0  # cuántos clientes tiene cargados
    empleados: int = 0  # cuántas subcuentas de empleado dependen de esta cuenta (titular_id)
    titular_id: int | None = None  # si != None, esta cuenta es un EMPLEADO de ese titular


class AdminUsuarioPatch(BaseModel):
    """Cambios que un admin puede aplicar a una cuenta (todos opcionales; PATCH parcial)."""

    activo: bool | None = None
    rol: str | None = None  # contador | admin


class AdminMetricasOut(BaseModel):
    """Resumen global del sistema para el dashboard del panel admin."""

    total_cuentas: int
    cuentas_activas: int
    cuentas_inactivas: int
    mails_confirmados: int  # cuentas que confirmaron su correo
    total_admins: int
    total_clientes: int  # clientes cargados en todo el sistema
    syncs_hoy: int  # sincronizaciones (extracciones) corridas hoy
    syncs_fallidas_hoy: int
    nuevas_cuentas_semana: int  # altas en los últimos 7 días


class AdminAuditoriaOut(BaseModel):
    """Una entrada del log de acciones del panel admin."""

    id: int
    admin_email: str
    accion: str
    target_email: str
    detalle: str | None = None
    fecha: str  # ISO


class ImpersonarOut(BaseModel):
    """Token de la cuenta impersonada para que el admin entre 'como' ese contador."""

    token: str
    usuario: UsuarioOut


class AdminSyncFallidaOut(BaseModel):
    """Una sincronización fallida vista desde el panel admin (vista de ops: motivo técnico crudo).
    Junta la extracción con el cliente y el contador dueño para saber a quién afecta."""

    fecha: str  # ISO
    cuit: str
    cliente: str | None = None  # nombre del cliente (None si se borró)
    contador_email: str | None = None  # dueño del cliente (None si quedó huérfano)
    motivo: str | None = None  # error técnico crudo (timeouts, selectores, etc.)
    duracion_ms: int | None = None
    # Estado ACTUAL del cliente respecto de esta falla: True si hubo una sincronización exitosa
    # POSTERIOR (la falla ya se resolvió sola o con un reintento). False = sigue sin resolverse.
    resuelto: bool = False
    ultima_sync_ok: str | None = None  # ISO de la última sync exitosa del cliente (contexto)


class AdminAvisoNombreOut(BaseModel):
    """Aviso (NO fallo) del panel: un cliente cuyo nombre quedó como 'Titular <CUIT>' al darse de
    alta porque no se pudo leer el nombre real. Se resuelve renombrándolo a mano desde la ficha."""

    cuit: str
    cliente: str | None = None  # nombre efectivo actual (el placeholder "Titular …")
    contador_email: str | None = None  # dueño del cliente (None si quedó huérfano)


class AdminClienteOut(ClienteOut):
    """Cliente visto desde el panel superadmin (vista global read-only): el ClienteOut completo —el
    MISMO dato que ve su contador— más de qué contador es y cuántos comprobantes tiene cacheados.
    Sólo para oversight; no se edita desde acá."""

    contador_id: int | None = None
    contador_email: str | None = None
    contador_nombre: str | None = None
    cantidad_comprobantes: int = 0


class AdminContadorResumen(BaseModel):
    """Métricas agregadas de un contador para su ficha en el panel."""

    total_clientes: int
    clientes_con_comprobantes: int
    comprobantes_total: int
    facturado_12m_total: float  # suma del facturado neto 12m de todos sus clientes
    syncs_problemas: int  # clientes cuya ÚLTIMA sincronización falló (sin resolver)
    # Avisos por WhatsApp efectivamente activos: el contador prendió el canal Y tiene teléfono
    # cargado (las dos condiciones que exige el motor de alertas para enviarle).
    whatsapp_activo: bool = False


class AdminContadorFichaOut(BaseModel):
    """Ficha completa de un contador para el panel superadmin (read-only): sus datos, un resumen
    agregado y la lista de sus clientes con el mismo detalle que la vista global."""

    usuario: AdminUsuarioOut
    resumen: AdminContadorResumen
    clientes: list[AdminClienteOut]


class JobIdOut(BaseModel):
    """Devuelve el id de un job en background (p.ej. un reintento de sincronización)."""

    job_id: str


# --- Motor de sincronización continua (panel admin → tab Motor; ver routers/admin_sync.py) ---


class MotorClienteOut(BaseModel):
    """Un cliente en las listas del motor (cola de próximos / actividad reciente)."""

    cuit: str
    cliente: str | None = None
    contador_email: str | None = None
    ultima: str | None = None  # ISO de la última extracción (None = nunca)
    horas_desde: float | None = None  # horas desde la última extracción (None = nunca)
    resultado: str | None = None  # exitosa | fallida (de la extracción de referencia)
    comprobantes: int | None = None
    duracion_seg: int | None = None


class MotorEstadoOut(BaseModel):
    """Estado del motor de sincronización continua para el panel admin."""

    # Latido del worker
    worker_vivo: bool
    worker_actualizado: str | None = None  # ISO del último latido
    en_vuelo: list[MotorClienteOut] = []   # clientes sincronizándose AHORA
    concurrencia: int = 0
    intervalo_horas: int = 0
    # Cobertura (sobre el universo de clientes)
    total_clientes: int = 0
    frescos: int = 0          # última extracción dentro del intervalo
    pendientes: int = 0       # vencidos: la sincronizará el worker (incluye 'nunca')
    nunca: int = 0            # sin ninguna extracción todavía
    con_falla_actual: int = 0  # su última extracción fue fallida (estado roto ahora)
    # Throughput
    syncs_1h: int = 0
    syncs_24h: int = 0
    exitosas_24h: int = 0
    fallidas_24h: int = 0
    duracion_promedio_seg: int | None = None  # promedio de duración de las syncs exitosas (24h)
    # Listas
    proximos: list[MotorClienteOut] = []    # próximos a sincronizar (más vencidos primero)
    actividad: list[MotorClienteOut] = []   # últimas extracciones (feed)


class InflacionEsperadaOut(BaseModel):
    """Inflación esperada del REM (BCRA) para que el front la use como base de las proyecciones."""
    mensual: float       # tasa mensual equivalente (ej 0.0176)
    interanual: float    # variación i.a. esperada (ej 0.233)
    fecha: str           # fecha del dato (ISO)
    fuente: str          # "REM"


class CategoriaOficialOut(BaseModel):
    """Una categoría de la escala oficial de Monotributo (tabla pública de ARCA). Mismos campos que
    la `Categoria` del front, para pisar la tabla local con los montos vigentes."""
    codigo: str
    topeAnual: float
    cuotaServicios: float
    cuotaComercio: float
    superficieMax: int
    energiaMaxKwh: int
    alquilerMaxAnual: float
    topePrecioUnitario: float
