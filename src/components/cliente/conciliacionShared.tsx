/**
 * Piezas de UI compartidas entre la conciliación POR CLIENTE (ReconciliacionBancaria.tsx, dentro de
 * la ficha) y la conciliación CENTRAL (pages/Conciliacion.tsx, carga masiva de extractos). Son
 * presentacionales y sin estado de negocio, para no duplicarlas entre ambas vistas.
 */
import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Tono del badge según la confianza del match automático (movimiento ↔ comprobante de ARCA). */
export const CONFIANZA_TONO: Record<string, 'success' | 'warning' | 'muted'> = {
  alta: 'success',
  media: 'success',
  sugerido: 'warning',
  manual: 'muted',
};

/** Zona de arrastrar-y-soltar archivos de extracto. `multiple` admite varios a la vez. `accept` y
 * `formatos` se parametrizan porque la conciliación central acepta PDF y la por-cliente no. */
export function DropZone({
  onFiles,
  multiple = true,
  accept = '.xlsx,.xls,.csv,.txt',
  formatos = 'XLSX, XLS o CSV',
}: {
  onFiles: (files: FileList | File[] | null) => void;
  multiple?: boolean;
  accept?: string;
  formatos?: string;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <label
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={e => { e.preventDefault(); setIsDragging(false); onFiles(e.dataTransfer.files); }}
      className={cn(
        'block rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-all',
        isDragging
          ? 'border-primary bg-primary/8 scale-[1.01]'
          : 'border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10',
      )}
    >
      <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-primary/15 text-primary mb-3 transition-transform">
        <Upload className="h-5 w-5" />
      </div>
      <div className="font-semibold">
        {isDragging ? 'Soltá el archivo acá' : `Arrastrá el extracto${multiple ? ' bancario' : ' (un archivo por vez)'}`}
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        o hacé clic para seleccionar. {formatos}.{multiple ? ' Podés cargar varios a la vez.' : ''}
      </div>
      <Button
        variant="outline"
        className="mt-4"
        type="button"
        onClick={e => { e.preventDefault(); inputRef.current?.click(); }}
      >
        <FileSpreadsheet className="h-4 w-4" /> Seleccionar archivo{multiple ? 's' : ''}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={e => onFiles(e.target.files)}
      />
    </label>
  );
}

/**
 * Celda de métrica (KPI) con etiqueta, valor grande y subtítulo opcional, con tono semántico.
 * Si recibe `onClick` se comporta como filtro clicable y resalta cuando está `active`.
 */
export function Stat({
  label,
  value,
  subtitle,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: 'success' | 'warning' | 'danger' | 'muted' | 'default';
  onClick?: () => void;
  active?: boolean;
}) {
  const contenido = (
    <>
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{label}</div>
      <div
        className={cn(
          'text-2xl font-semibold tabular-nums tracking-tight',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning-foreground',
          tone === 'danger' && 'text-danger',
          tone === 'default' && 'text-primary',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </div>
      {subtitle && (
        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
          {tone === 'warning' && <AlertCircle className="h-3 w-3" />}
          {subtitle}
        </div>
      )}
    </>
  );

  if (!onClick) return <div className="p-5">{contenido}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'p-5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
        active && 'bg-primary/5 ring-2 ring-inset ring-primary/40',
      )}
    >
      {contenido}
    </button>
  );
}
