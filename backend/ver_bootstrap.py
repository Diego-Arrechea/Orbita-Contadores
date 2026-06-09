"""
Corre el bootstrap del certificado con la VENTANA VISIBLE (headless=False) para ver en vivo
qué hace en ARCA: login, árbol de servicios, Facturación Electrónica, etc. Al terminar (salga
bien o falle) la ventana queda abierta hasta que apretás ENTER, así inspeccionás el estado.

Uso (desde backend/, con el venv activado):
    python ver_bootstrap.py <CUIT_CLIENTE> <CUIT_LOGIN> <CLAVE>

Ejemplos:
    # titular que se monitorea a sí mismo (cliente == login)
    python ver_bootstrap.py 20217168652 20217168652 MI_CLAVE_FISCAL
    # contador que genera el cert de un representado
    python ver_bootstrap.py 30715434233 20259747504 CLAVE_DEL_CONTADOR

No necesita el backend (uvicorn) corriendo: abre su propio navegador.
"""
import sys

from app.scraping.bootstrap import bootstrap_cliente


def prog(pct: int, msg: str) -> None:
    print(f"  {pct:>3}%  {msg}", flush=True)


def main() -> None:
    if len(sys.argv) < 4:
        print("Uso: python ver_bootstrap.py <CUIT_CLIENTE> <CUIT_LOGIN> <CLAVE>")
        sys.exit(1)
    cuit_cliente, cuit_login, clave = sys.argv[1].strip(), sys.argv[2].strip(), sys.argv[3]
    print(f"Bootstrap VISIBLE — cliente {cuit_cliente} (login {cuit_login})\n")
    try:
        cert, key = bootstrap_cliente(
            cuit_cliente=cuit_cliente,
            cuit_login=cuit_login,
            clave=clave,
            on_progress=prog,
            headless=False,    # ← ventana visible
            pausa_debug=True,  # ← deja la ventana abierta al final (ENTER para cerrar)
        )
        print(f"\n✅ OK — cert={len(cert)} bytes, key={len(key)} bytes")
    except Exception as e:  # noqa: BLE001
        print(f"\n❌ FALLÓ — {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
