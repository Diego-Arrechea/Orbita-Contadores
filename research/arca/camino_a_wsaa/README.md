# Camino A — WSAA con certificado: cómo conseguir el certificado

> **No hay scraping en ningún paso.** El certificado se obtiene con un trámite **manual,
> una sola vez**, combinando OpenSSL (local) + el portal de ARCA (con tu clave fiscal).
> El código (`wsaa_auth.py`) NO genera el certificado: lo **usa** desde el disco.

## Distinción que evita confusiones

| | Quién | Cuántas veces | ¿Automatizable? |
|---|---|---|---|
| **Certificado** | Vos / el estudio (Órbita) | **Una sola vez** | OpenSSL sí; subir CSR / bajar cert es manual |
| **Delegación** | **Cada cliente**, desde SU clave fiscal | Una vez por cliente | No (ni hace falta) |

El `mi_cert.crt` + `mi_clave.key` del código son **uno solo, tuyo**. No se genera uno por cliente.
A los clientes los alcanzás con la **delegación** (ellos te autorizan), no con más certificados.

## Paso 1 — Generar clave privada + CSR (local, con OpenSSL)

Esto es lo único que sí podés scriptear (es solo invocar openssl):

```bash
openssl genrsa -out mi_clave.key 2048

openssl req -new -key mi_clave.key \
  -subj "/C=AR/O=ORBITA/CN=orbita/serialNumber=CUIT 20XXXXXXXXX" \
  -out pedido.csr
```

El `serialNumber` debe ser `CUIT ` + tu número de CUIT (el de la persona física que entra al portal).

## Paso 2 — Obtener el certificado en el portal de ARCA (manual, una vez)

### Homologación (testing) — servicio **WSASS**
1. Entrar a ARCA con **clave fiscal de persona física** (no la de una empresa).
2. Adherir el servicio **WSASS** (Autoservicio de Acceso a APIs de Homologación).
3. Opción **"Nuevo Certificado"** → pegar el contenido de `pedido.csr` → ARCA devuelve el
   certificado X.509 en PEM. Guardarlo como `mi_cert.crt`.
4. Opción **"Crear Autorización a Servicio"** → autorizar tu DN a usar el WS (ej. `wsfe`)
   representando a un contribuyente.
5. Listo: ya podés correr `python wsaa_auth.py` con `HOMO = True`.

### Producción (datos reales)
1. Adherir el servicio **"Administrador de Certificados Digitales"** (requiere clave fiscal nivel 3).
2. **"Agregar alias"** (un nombre, ej. `ORBITA`) → **"Agregar certificado"** → subir `pedido.csr`
   → descargar el `.crt` emitido.
3. Ir a **"Administrador de Relaciones de Clave Fiscal"** → **Nueva relación** → buscar el
   servicio **"WebService de Facturación Electrónica"** (o el que uses) → asociar el certificado
   → confirmar. Esto **autoriza** el certificado para ese WS.

## Paso 3 — Delegación de cada cliente (para operar en su nombre)

Cada cliente, **desde su propia clave fiscal**, entra a **Administrador de Relaciones** y te
delega el servicio (a tu CUIT). Queda permanente hasta que lo revoque. Recién ahí podés poner
el CUIT del cliente en `Auth.Cuit` (ver `comprobantes_emitidos.py`) sin tocar su clave fiscal.

Guía oficial: *"Delegación de Webservices con el Administrador de Relaciones"* (ARCA).

## Resumen: qué es código vs qué es trámite

```
TRÁMITE (una vez)         →   mi_clave.key + mi_cert.crt   ──┐
DELEGACIÓN (por cliente)  →   autorización en ARCA           │
                                                             ▼
CÓDIGO (cada ejecución)   →   wsaa_auth.py usa esos archivos → Token+Sign → WSFEv1/padrón
```

## URLs de referencia
- Documentación certificados: https://www.afip.gob.ar/ws/documentacion/certificados.asp
- Manual WSASS (PDF): https://www.arca.gob.ar/ws/WSASS/WSASS_manual.pdf
- Generación de certificados producción (PDF): https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf
