"""
crear_usuario.py — crea (o actualiza) un usuario/contador de Órbita en la base.

Interactivo y seguro: la contraseña se pide con getpass (no se ve en pantalla ni queda en el
historial de la terminal). Reutiliza el hashing real del backend (bcrypt) y escribe en la MISMA
base que usa la API. Pensado para crear tu cuenta sin pasar la contraseña por el chat.

    cd backend
    .venv\\Scripts\\python -m scripts.crear_usuario

Enter acepta el valor por defecto que aparece entre corchetes.
"""
from __future__ import annotations

import getpass

from sqlalchemy import select

from app import models
from app.db import Base, SessionLocal, engine
from app.security import hashear_password

# Valores por defecto (Enter para aceptarlos). Editá lo que quieras al correrlo.
DEFAULTS = {
    "email": "ulises25103@gmail.com",
    "nombre": "Ulises",
    "apellido": "Rodriguez",
    "telefono": "",
    "dni": "",
    "cuit": "",
    "estudio": "Mi estudio",
    "matricula": "",
}


def pedir(campo: str, etiqueta: str, *, obligatorio: bool = True) -> str:
    default = DEFAULTS.get(campo, "")
    sufijo = f" [{default}]" if default else ""
    while True:
        valor = input(f"{etiqueta}{sufijo}: ").strip() or default
        if valor or not obligatorio:
            return valor
        print("  (obligatorio)")


def solo_digitos(s: str) -> str:
    return "".join(c for c in s if c.isdigit())


def main() -> None:
    Base.metadata.create_all(bind=engine)  # crea la tabla 'usuarios' si todavía no existe

    print("== Crear usuario/contador de Órbita ==\n")
    email = pedir("email", "Email").lower()
    nombre = pedir("nombre", "Nombre")
    apellido = pedir("apellido", "Apellido")
    telefono = pedir("telefono", "Teléfono")
    dni = solo_digitos(pedir("dni", "DNI"))
    cuit = solo_digitos(pedir("cuit", "CUIT"))
    estudio = pedir("estudio", "Nombre del estudio")
    matricula = pedir("matricula", "Matrícula (opcional)", obligatorio=False) or None

    # Mismas reglas que el registro por la API.
    if not 7 <= len(dni) <= 8:
        raise SystemExit("DNI inválido: tiene que tener 7 u 8 dígitos.")
    if len(cuit) != 11:
        raise SystemExit("CUIT inválido: tiene que tener 11 dígitos.")

    password = getpass.getpass("Contraseña (mín. 8): ")
    if len(password) < 8:
        raise SystemExit("La contraseña debe tener al menos 8 caracteres.")
    if password != getpass.getpass("Repetir contraseña: "):
        raise SystemExit("Las contraseñas no coinciden.")

    db = SessionLocal()
    try:
        existente = db.scalar(
            select(models.Usuario).where(
                (models.Usuario.email == email) | (models.Usuario.cuit == cuit)
            )
        )
        if existente is not None:
            print(f"\nYa hay un usuario con ese email o CUIT (id {existente.id}, {existente.email}).")
            if input("¿Resetear su contraseña y datos con lo ingresado? [s/N]: ").strip().lower() != "s":
                raise SystemExit("Cancelado: no se modificó nada.")
            existente.nombre = nombre
            existente.apellido = apellido
            existente.email = email
            existente.telefono = telefono
            existente.dni = dni
            existente.cuit = cuit
            existente.estudio = estudio
            existente.matricula = matricula
            existente.password_hash = hashear_password(password)
            existente.acepto_terminos = True
            accion, uid = "actualizado", existente.id
        else:
            usuario = models.Usuario(
                nombre=nombre,
                apellido=apellido,
                email=email,
                telefono=telefono,
                dni=dni,
                cuit=cuit,
                estudio=estudio,
                matricula=matricula,
                password_hash=hashear_password(password),
                acepto_terminos=True,
            )
            db.add(usuario)
            db.flush()
            accion, uid = "creado", usuario.id
        db.commit()
        print(f"\n✅ Usuario {accion}: {email} (id {uid}) — {nombre} {apellido} · {estudio}")
        print("Ya podés entrar desde /login con ese email y la contraseña que pusiste.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
