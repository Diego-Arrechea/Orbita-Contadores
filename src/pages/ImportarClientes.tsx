import { useNavigate } from 'react-router-dom';
import { ChevronLeft, FileSpreadsheet, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PREVIEW_ROWS = [
  { nombre: 'Pedro Ramírez',     cuit: '20281334569', categoria: 'D', actividad: 'servicios', inicio: '15/03/2019', error: null },
  { nombre: 'Distribuidora Sur', cuit: '30715998456', categoria: 'G', actividad: 'comercio',  inicio: '01/06/2020', error: null },
  { nombre: 'Camila Rodriguez',  cuit: '27412998771', categoria: 'B', actividad: 'servicios', inicio: '12/01/2024', error: null },
  { nombre: 'María Spinelli',    cuit: '27332991',    categoria: 'F', actividad: 'servicios', inicio: '10/07/2018', error: 'CUIT incompleto' },
  { nombre: 'Comercio Plata',    cuit: '30889112334', categoria: 'X', actividad: 'comercio',  inicio: '03/11/2021', error: 'Categoría inválida' },
  { nombre: 'Tomás Olguín',      cuit: '20299445662', categoria: 'C', actividad: 'servicios', inicio: '20/08/2022', error: null },
];

export function ImportarClientes() {
  const navigate = useNavigate();
  const validas = PREVIEW_ROWS.filter(r => !r.error).length;
  const conError = PREVIEW_ROWS.length - validas;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="-ml-3 mb-3">
          <ChevronLeft className="h-4 w-4" /> Volver
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">Importar cartera</h1>
        <p className="text-base text-muted-foreground mt-2">
          Subí una planilla con tus clientes para cargarlos todos de una vez en lugar de uno por uno.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4 md:col-span-2">
          <label
            htmlFor="file"
            className="block rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-6 py-10 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/10 transition-colors"
          >
            <FileSpreadsheet className="h-10 w-10 mx-auto text-primary mb-3" />
            <div className="font-medium">Arrastrá la planilla acá</div>
            <div className="text-sm text-muted-foreground mt-1">
              o hacé clic para seleccionar. Formatos: XLSX, CSV. Tamaño máximo 5 MB.
            </div>
            <Button variant="outline" className="mt-4" type="button">
              Seleccionar archivo
            </Button>
            <input id="file" type="file" className="hidden" />
          </label>
        </Card>

        <Card className="p-5 flex flex-col">
          <div className="text-base font-semibold mb-1">Planilla modelo</div>
          <p className="text-sm text-muted-foreground flex-1">
            Descargá el formato de referencia. Las columnas requeridas son: <em>nombre</em>,{' '}
            <em>cuit</em>, <em>categoría</em>, <em>actividad</em>, <em>inicio actividades</em>.
            La clave fiscal se carga después, cliente por cliente.
          </p>
          <Button variant="soft" className="mt-3">
            <Download className="h-4 w-4" /> Descargar planilla
          </Button>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border/60">
          <div>
            <div className="font-medium">Vista previa</div>
            <div className="text-sm text-muted-foreground">
              {PREVIEW_ROWS.length} filas detectadas en <span className="font-medium">clientes-marzo-2026.xlsx</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge variant="success">
              <CheckCircle2 className="h-3 w-3" /> {validas} válidos
            </Badge>
            {conError > 0 && (
              <Badge variant="warning">
                <AlertCircle className="h-3 w-3" /> {conError} con error
              </Badge>
            )}
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>CUIT</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Actividad</TableHead>
              <TableHead>Inicio</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PREVIEW_ROWS.map((row, i) => (
              <TableRow key={i} className={row.error ? 'bg-danger/5' : ''}>
                <TableCell className="font-medium">{row.nombre}</TableCell>
                <TableCell className="tabular-nums">{row.cuit}</TableCell>
                <TableCell>
                  <Badge variant="outline">{row.categoria}</Badge>
                </TableCell>
                <TableCell className="capitalize">{row.actividad}</TableCell>
                <TableCell className="text-sm">{row.inicio}</TableCell>
                <TableCell>
                  {row.error ? (
                    <Badge variant="danger" className="text-[10px]">
                      <AlertCircle className="h-3 w-3" /> {row.error}
                    </Badge>
                  ) : (
                    <Badge variant="success" className="text-[10px]">
                      <CheckCircle2 className="h-3 w-3" /> Listo
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Cancelar
        </Button>
        <Button onClick={() => navigate('/')}>
          Importar {validas} clientes válidos
        </Button>
      </div>
    </div>
  );
}
