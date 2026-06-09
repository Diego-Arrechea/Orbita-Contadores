"""Prueba del bootstrap completo de un REPRESENTADO (AV INGENIERIA, alias nuevo)."""
from app.scraping.bootstrap import bootstrap_cliente


def prog(pct, msg):
    print(f"  {pct:>3}% {msg}", flush=True)


try:
    cert, key = bootstrap_cliente(
        cuit_cliente="30715434233",  # AV INGENIERIA (representado)
        cuit_login="20259747504",  # BARAYAZARRA (contador)
        clave="DaseMO2024",
        alias="orbita3",  # alias NUEVO (flujo fresco: crear + asociar + descargar)
        on_progress=prog,
        headless=True,
    )
    print(f"OK ✅  cert={len(cert)} bytes, key={len(key)} bytes")
    print("CERT empieza con:", cert[:40])
except Exception as e:
    print(f"FALLÓ ❌  {type(e).__name__}: {e}")
