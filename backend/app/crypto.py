"""Cifrado simétrico (Fernet) para guardar certs/keys sin dejarlos en claro en la DB."""
from __future__ import annotations

from cryptography.fernet import Fernet

from .config import settings


def _fernet() -> Fernet:
    if not settings.fernet_key:
        raise RuntimeError(
            "FERNET_KEY no configurada. Generala con "
            '`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` '
            "y ponela en backend/.env"
        )
    key = settings.fernet_key
    return Fernet(key.encode() if isinstance(key, str) else key)


def cifrar(data: bytes) -> bytes:
    """Cifra bytes (p.ej. el contenido de un .crt o .key)."""
    return _fernet().encrypt(data)


def descifrar(token: bytes) -> bytes:
    """Descifra lo que devolvió cifrar()."""
    return _fernet().decrypt(token)
