# Órbita — Backend

API FastAPI que trae comprobantes **emitidos** reales desde ARCA (WSFEv1) y los expone al
frontend de Órbita. Reusa el spike validado en `research/arca/`.

> **Estado**: vertical slice (1 cliente real, AV INGENIERIA). Los certificados se cargan ya
> generados, cifrados en la DB. El bootstrap automático del cert es una fase posterior.

## Stack
FastAPI · SQLAlchemy · SQLite · Pydantic v2 · zeep (SOAP) · cryptography (Fernet)

## Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt

# 1) Generar la clave de cifrado y ponerla en .env
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
#   copiá .env.example a .env y pegá el valor en FERNET_KEY

# 2) Cargar el cliente de prueba (AV INGENIERIA) con su cert cifrado
.venv\Scripts\python -m scripts.cargar_cliente

# 3) Levantar la API
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/clientes` | Lista los clientes registrados |
| POST | `/api/clientes/{cuit}/sincronizar` | Consulta WSFEv1 y cachea los emitidos en la DB |
| GET | `/api/clientes/{cuit}/comprobantes` | Devuelve los comprobantes (formato Órbita) |

Probar:
```bash
curl -X POST localhost:8000/api/clientes/30715434233/sincronizar
curl localhost:8000/api/clientes/30715434233/comprobantes
```

Docs interactivas: http://localhost:8000/docs

## Estructura
```
app/
  main.py        FastAPI + CORS
  config.py      settings (.env)
  db.py          engine + sesión SQLite
  models.py      ORM (ClienteARCA, ComprobanteEmitido)
  schemas.py     Pydantic (ComprobanteOut) + mapeo de tipos
  crypto.py      Fernet (cifrar/descifrar certs)
  arca/          WSAA + WSFEv1 (portado del spike, cert en bytes)
  services/      sincronización (cert → WSFEv1 → DB)
  routers/       endpoints
scripts/
  cargar_cliente.py   registra AV INGENIERIA (one-shot)
data/            orbita.db (gitignored)
```
