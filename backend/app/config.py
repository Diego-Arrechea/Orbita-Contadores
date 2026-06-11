"""Configuración del backend (pydantic-settings, lee backend/.env)."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", extra="ignore")

    # SQLite por defecto (cero configuración). Override con DATABASE_URL en .env.
    database_url: str = f"sqlite:///{(DATA_DIR / 'orbita.db').as_posix()}"

    # Clave Fernet para cifrar certs/keys en la DB. OBLIGATORIA (ver README).
    # Generala con: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    fernet_key: str = ""

    # Secreto para firmar los JWT de sesión (login de contadores). Si queda vacío se deriva de
    # FERNET_KEY (ya obligatoria). Para rotarlo aparte, seteá JWT_SECRET en .env.
    jwt_secret: str = ""
    # Duración del token de sesión (minutos). 7 días por defecto.
    jwt_expire_minutes: int = 60 * 24 * 7

    # false = producción ARCA; true = homologación.
    arca_homo: bool = False

    # Hora (0-23, horario de Argentina) del sync automático diario (scheduler in-process del API).
    sync_hour: int = 3
    # El scheduler diario del API queda APAGADO por defecto: el motor de sincronización continua
    # (contenedor worker, `python -m app.worker`) lo reemplaza. Poné true sólo si no usás el worker.
    scheduler_enabled: bool = False

    # --- Motor de sincronización continua (contenedor worker, app/worker/loop.py) ---
    # Cuántos clientes se sincronizan en paralelo (cada uno abre un Chromium). El VPS aguanta más,
    # pero el límite real es ARCA: mantenelo moderado. NUNCA corren dos clientes del mismo contador
    # a la vez (misma clave fiscal) — esto cuenta contadores distintos en paralelo.
    sync_worker_concurrencia: int = 6
    # Cada cliente se re-sincroniza cuando su última extracción (cualquier resultado) supera esto.
    sync_intervalo_horas: int = 12
    # Cada cuánto el despachador revisa qué clientes están vencidos y los encola (segundos).
    sync_poll_segundos: int = 60
    # Envío automático de alertas por WhatsApp desde el motor continuo. Default APAGADO: el motor
    # sincroniza igual, pero NO manda mensajes a contadores reales hasta que se active explícitamente
    # (SYNC_ALERTAS_ENABLED=true en el .env). Evita sorprender a los usuarios al encender el motor.
    sync_alertas_enabled: bool = False
    # Cada cuánto corre el pase de alertas (consolida y manda WhatsApp por contador). Minutos.
    sync_alertas_cada_min: int = 15
    # Horario silencioso (hora AR): NO se mandan WhatsApp en esta franja (se acumulan y salen después).
    # Soporta cruce de medianoche (ej. 22→8). inicio==fin desactiva el silencio.
    sync_quiet_inicio: int = 0
    sync_quiet_fin: int = 8

    # Navegador del scraping. True = headless (sin ventana; server/VPS y default).
    scraping_headless: bool = True

    # Trazabilidad del scraping: al fallar una sincronización, guardar en data/diag/ la traza de
    # pasos (traza_<cuit>.json), screenshot + HTML de la pantalla donde quedó (fallo_<cuit>_*) y la
    # traza visual de Patchright (trace_<cuit>.zip, se abre con `playwright show-trace`). Los nombres
    # son por-CUIT (se pisan): queda SIEMPRE el último fallo de cada cliente, así no crece el disco.
    scraping_trazas: bool = True

    # Sincronización incremental de 'Mis Comprobantes':
    sync_margen_dias: int = 7  # al traer desde el último comprobante, solapamos N días (el upsert dedup)
    sync_anios_historico: int = 4  # años hacia atrás en la PRIMERA sincronización de un cliente
    sync_meses_revision: int = 14  # cada sync re-barre los últimos N meses completos (cubre la
    # ventana de facturación 12m + buffer): captura comprobantes que ARCA carga tarde con fecha vieja
    # y corrige montos de meses pasados. El histórico previo ya quedó cacheado en la primera sync.

    # Orígenes permitidos para CORS (el dev server de Vite).
    cors_origins: list[str] = ["http://localhost:5173"]

    # --- Crisp (CRM de contactos + chat de soporte) ---
    # Token de la REST API de Crisp: cada contador que se registra se crea como contacto.
    # Lo más simple es un "Website Token" (Crisp app → Settings → Workspace Settings → Advanced
    # Configuration → API Token; tier "website", 10k req/día). Si quedan vacíos, la sync con Crisp
    # es un no-op (no rompe el registro). Para un plugin token del Marketplace, poné CRISP_TIER=plugin.
    crisp_website_id: str = ""
    crisp_token_identifier: str = ""
    crisp_token_key: str = ""
    crisp_tier: str = "website"  # "website" (Website Token) | "plugin" (token del Marketplace)

    # --- WhatsApp (Twilio) — envío de alertas ---
    # Para probar: Twilio Console → Messaging → Try it out → Send a WhatsApp message (Sandbox).
    # Copiá Account SID y Auth Token (home de la Console) y el número del sandbox en TWILIO_WHATSAPP_FROM
    # (ej. +14155238886). Si quedan vacíos, el envío es un no-op (no rompe nada).
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_whatsapp_from: str = ""


settings = Settings()
