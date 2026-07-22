/**
 * Aviso (estilo warning, no error) para completar los contactos de los clientes que todavía no
 * tienen email cargado. Sin ese dato no se les puede enviar el recordatorio mensual de sus
 * vencimientos. Ofrece dos acciones:
 *   1) Descargar una planilla (.xlsx) con los clientes de la cartera ya precargados (CUIT + nombre).
 *   2) Importar esa planilla completada: se parsea en el browser (SheetJS, ya dependencia) y sólo
 *      viajan las filas al backend (mismo enfoque que la conciliación).
 * Tras importar, muestra una animación de guardado; si el archivo no tiene el formato esperado o
 * trae filas con problemas, lo avisa y deja volver a intentar. Desaparece solo cuando no quedan
 * clientes sin email.
 */
import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, Download, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  importarContactosClientes,
  type FilaContacto,
  type ImportarContactosResumen,
} from '@/services/clientesService';
import { mensajeDeError } from '@/services/authService';
import type { Cliente } from '@/types';

/** Normaliza un encabezado para compararlo sin depender de mayúsculas. Las palabras que buscamos
 *  ('cuit', 'mail', 'tel', …) son ASCII y aparecen como substring aún con acentos ('teléfono'),
 *  así que alcanza con minúsculas + trim (no hace falta remover diacríticos). */
function normalizar(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

class FormatoError extends Error {}

/** Lee la planilla completada y devuelve las filas con al menos un contacto para importar. */
async function parsearContactos(file: File): Promise<FilaContacto[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: true });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) throw new FormatoError('La planilla está vacía.');
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: '' });
  // Encabezado = primera fila que tenga una celda "CUIT".
  const idxHeader = matriz.findIndex(row =>
    (row as unknown[]).some(c => normalizar(c).includes('cuit')),
  );
  if (idxHeader < 0) {
    throw new FormatoError('No encontramos la columna CUIT. Usá la planilla que descargaste.');
  }
  const header = (matriz[idxHeader] as unknown[]).map(normalizar);
  const idxCuit = header.findIndex(h => h.includes('cuit'));
  const idxEmail = header.findIndex(h => h.includes('mail') || h.includes('correo'));
  const idxTel = header.findIndex(
    h => h.includes('tel') || h.includes('cel') || h.includes('whats'),
  );
  const celda = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const filas: FilaContacto[] = [];
  for (const row of matriz.slice(idxHeader + 1) as unknown[][]) {
    const cuit = celda(row, idxCuit);
    const email = celda(row, idxEmail);
    const telefono = celda(row, idxTel);
    // Fila sin ningún contacto para cargar: se ignora (una celda vacía no es un error).
    if (!email && !telefono) continue;
    if (cuit) filas.push({ cuit, email: email || undefined, telefono: telefono || undefined });
  }
  return filas;
}

export function RecordatoriosContactosBanner({
  clientes,
  onImported,
}: {
  clientes: Cliente[];
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<'idle' | 'cargando' | 'error'>('idle');
  const [resumen, setResumen] = useState<ImportarContactosResumen | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const reales = clientes.filter(c => c.fuente === 'arca');
  const sinEmail = reales.filter(c => !c.emailCliente);
  // No hay nada que pedir si toda la cartera ya tiene email (o no hay clientes reales todavía).
  if (reales.length === 0 || sinEmail.length === 0) return null;

  const descargarPlantilla = () => {
    const filas: (string | number)[][] = [['CUIT', 'Nombre', 'Teléfono', 'Email']];
    // CUIT como texto (String) para que Excel no lo convierta a número ni lo pase a notación científica.
    for (const c of reales) {
      filas.push([String(c.cuit), c.nombre, c.telefonoCliente ?? '', c.emailCliente ?? '']);
    }
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = [{ wch: 15 }, { wch: 40 }, { wch: 18 }, { wch: 32 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contactos');
    XLSX.writeFile(wb, 'Contactos de clientes.xlsx');
  };

  const alElegirArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Permitir volver a elegir el MISMO archivo (tras corregirlo) reseteando el input.
    e.target.value = '';
    if (!file) return;
    setEstado('cargando');
    setResumen(null);
    setErrorMsg('');
    try {
      const filas = await parsearContactos(file);
      if (filas.length === 0) {
        throw new FormatoError('La planilla no tiene emails ni teléfonos para cargar.');
      }
      const r = await importarContactosClientes(filas);
      setResumen(r);
      setEstado('idle');
      if (r.actualizados > 0) onImported();
    } catch (err) {
      setErrorMsg(err instanceof FormatoError ? err.message : mensajeDeError(err));
      setEstado('error');
    }
  };

  const cargando = estado === 'cargando';

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3.5">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={alElegirArchivo}
      />
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning-foreground">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-warning-foreground">
            {sinEmail.length}{' '}
            {sinEmail.length === 1
              ? 'cliente todavía no tiene email para recibir sus recordatorios'
              : 'clientes todavía no tienen email para recibir sus recordatorios'}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Descargá la planilla con tus clientes, completá sus teléfonos y emails, y volvé a
            importarla. Podés cargar sólo los que falten.
          </p>

          {cargando ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-warning-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Guardando los datos…
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={descargarPlantilla}>
                <Download className="h-4 w-4" /> Descargar planilla
              </Button>
              <Button size="sm" onClick={() => inputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Importar planilla
              </Button>
            </div>
          )}

          {/* Aviso de formato / errores de filas: tono warning, nunca error rojo. Deja reintentar. */}
          {estado === 'error' && (
            <p className="mt-2.5 text-sm text-warning-foreground">
              {errorMsg} Revisá el formato y volvé a importarla.
            </p>
          )}
          {resumen && (
            <div className="mt-2.5 text-sm">
              {resumen.actualizados > 0 && (
                <p className="text-warning-foreground">
                  Se guardaron los datos de {resumen.actualizados}{' '}
                  {resumen.actualizados === 1 ? 'cliente' : 'clientes'}.
                </p>
              )}
              {resumen.errores.length > 0 && (
                <div className="mt-1 text-muted-foreground">
                  <p>
                    {resumen.errores.length}{' '}
                    {resumen.errores.length === 1
                      ? 'fila quedó sin cargar'
                      : 'filas quedaron sin cargar'}
                    :
                  </p>
                  <ul className="mt-0.5 list-disc pl-5">
                    {resumen.errores.slice(0, 5).map((er, i) => (
                      <li key={i}>
                        Fila {er.fila}: {er.motivo}
                      </li>
                    ))}
                    {resumen.errores.length > 5 && <li>…y {resumen.errores.length - 5} más.</li>}
                  </ul>
                  <p className="mt-1">Corregí esas filas y volvé a importar la planilla.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
