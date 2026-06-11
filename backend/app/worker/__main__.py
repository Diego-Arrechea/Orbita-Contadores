"""Entrypoint del contenedor worker: `python -m app.worker`."""
from .loop import main

if __name__ == "__main__":
    main()
