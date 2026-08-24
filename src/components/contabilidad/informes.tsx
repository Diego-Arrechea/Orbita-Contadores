import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { Download, Info, Loader2 } from 'lucide-react';
import { OrigenDialog } from '@/components/contabilidad/origen';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getEstados,
  getMayor,
  getSumasYSaldos,
  type Cuenta,
  type LineaEstado,
  type PeriodoContable,
} from '@/services/contabilidadService';
import { cn, formatCurrency } from '@/lib/utils';

/**
 * Informes del apartado de Contabilidad: el mayor de una cuenta, el balance de sumas y saldos y los
 * estados contables, todos sobre el rango de fechas que elija el contador y exportables a Excel. Viven fuera de la
 * página para que no siga creciendo (ver pages/Contabilidad.tsx).
 */
/** Rangos que puede pedir el contador para el mayor y las sumas y saldos. */
type ModoRango = 'periodo' | 'anio' | 'todo';

const MODOS_RANGO: { valor: ModoRango; label: string }[] = [
  { valor: 'periodo', label: 'El período' },
  { valor: 'anio', label: 'El año' },
  { valor: 'todo', label: 'Todo' },
];

/** Último día del mes de un período aaaa-mm, en ISO. Sin período (cliente sin movimientos) cae en
 *  el día de hoy: los informes no se consultan igual, pero el cálculo no puede romperse. */
function finDePeriodo(periodo: string): string {
  const [anio, mes] = periodo.split('-').map(Number);
  if (!anio || !mes) return new Date().toISOString().slice(0, 10);
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
}

/** Fechas del rango elegido: siempre termina al cierre del período seleccionado. */
function rangoDe(
  modo: ModoRango,
  periodo: string,
  periodos: PeriodoContable[]
): { desde: string; hasta: string } {
  const hasta = finDePeriodo(periodo);
  if (modo === 'periodo') return { desde: `${periodo}-01`, hasta };
  if (modo === 'anio') return { desde: `${periodo.slice(0, 4)}-01-01`, hasta };
  // 'todo': desde el primer mes con movimientos del cliente (los períodos vienen del más nuevo al
  // más viejo, así que el último de la lista es el más antiguo).
  const masViejo = periodos[periodos.length - 1]?.periodo ?? periodo;
  return { desde: `${masViejo}-01`, hasta };
}

export function fechaCorta(iso: string): string {
  return iso.split('-').reverse().join('/');
}

/** Descarga una planilla con una hoja y anchos de columna fijos. */
export function bajarExcel(
  nombreArchivo: string,
  hoja: string,
  filas: (string | number)[][],
  anchos: number[]
) {
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = anchos.map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja);
  XLSX.writeFile(wb, nombreArchivo);
}

/** Selector de rango + botón de exportar, compartido por los dos informes. */
function BarraInforme({
  modo,
  onModo,
  desde,
  hasta,
  onExportar,
  puedeExportar,
  children,
}: {
  modo: ModoRango;
  onModo: (m: ModoRango) => void;
  desde: string;
  hasta: string;
  onExportar: () => void;
  puedeExportar: boolean;
  children?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        {children}
        <Tabs value={modo} onValueChange={v => onModo(v as ModoRango)}>
          <TabsList>
            {MODOS_RANGO.map(m => (
              <TabsTrigger key={m.valor} value={m.valor}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground">
          {fechaCorta(desde)} al {fechaCorta(hasta)}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="sm:ml-auto"
          onClick={onExportar}
          disabled={!puedeExportar}
        >
          <Download className="mr-2 h-4 w-4" />
          Exportar
        </Button>
      </div>
    </Card>
  );
}

/** Mayor de una cuenta: saldo anterior, movimientos y saldo arrastrado. */
export function VistaMayor({
  cuit,
  cuentas,
  periodo,
  periodos,
  cliente,
  codigo,
  onCodigo,
}: {
  cuit: string;
  cuentas: Cuenta[];
  periodo: string;
  periodos: PeriodoContable[];
  cliente: string;
  /** Cuenta elegida. La maneja la página para poder llegar desde otro informe. */
  codigo: string;
  onCodigo: (codigo: string) => void;
}) {
  const imputables = useMemo(() => cuentas.filter(c => c.imputable), [cuentas]);
  const [modo, setModo] = useState<ModoRango>('periodo');
  const [origenAbierto, setOrigenAbierto] = useState<string | null>(null);
  const elegida = codigo || imputables[0]?.codigo || '';
  const { desde, hasta } = rangoDe(modo, periodo, periodos);

  const { data: mayor, isLoading } = useQuery({
    queryKey: ['contabilidad', 'mayor', cuit, elegida, desde, hasta],
    queryFn: () => getMayor(cuit, elegida, desde, hasta),
    enabled: !!cuit && !!elegida && !!periodo,
  });

  function exportar() {
    if (!mayor) return;
    const filas: (string | number)[][] = [
      [`Mayor de ${mayor.codigo} ${mayor.cuenta}`],
      [cliente, `${fechaCorta(mayor.desde)} al ${fechaCorta(mayor.hasta)}`],
      [],
      ['Fecha', 'Detalle', 'Contraparte', 'Debe', 'Haber', 'Saldo'],
      ['', 'Saldo anterior', '', '', '', mayor.saldoAnterior],
    ];
    for (const m of mayor.movimientos) {
      filas.push([fechaCorta(m.fecha), m.detalle, m.contraparte, m.debe, m.haber, m.saldo]);
    }
    filas.push(['', 'Totales', '', mayor.debe, mayor.haber, mayor.saldo]);
    bajarExcel(
      `Mayor ${mayor.codigo} - ${cliente}.xlsx`,
      'Mayor',
      filas,
      [12, 46, 30, 14, 14, 14]
    );
  }

  if (!periodo) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Este cliente todavía no tiene movimientos para armar el informe.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <BarraInforme
        modo={modo}
        onModo={setModo}
        desde={desde}
        hasta={hasta}
        onExportar={exportar}
        puedeExportar={!!mayor && mayor.movimientos.length > 0}
      >
        <Select value={elegida} onValueChange={onCodigo}>
          <SelectTrigger className="h-9 w-full bg-card sm:w-80">
            <SelectValue placeholder="Elegí una cuenta" />
          </SelectTrigger>
          <SelectContent>
            {imputables.map(c => (
              <SelectItem key={c.id} value={c.codigo}>
                {c.codigo} · {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </BarraInforme>

      {isLoading || !mayor ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Buscando los movimientos…
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-4 py-3">
            <span className="font-medium">
              {mayor.codigo} · {mayor.cuenta}
            </span>
            <span className="text-sm text-muted-foreground">
              Saldo anterior {formatCurrency(mayor.saldoAnterior)}
            </span>
            <span className="ml-auto text-sm">
              Saldo final{' '}
              <strong className="tabular-nums">{formatCurrency(Math.abs(mayor.saldo))}</strong>{' '}
              <span className="text-muted-foreground">
                {mayor.saldo === 0 ? '' : mayor.saldo > 0 ? 'deudor' : 'acreedor'}
              </span>
            </span>
          </div>

          {mayor.movimientos.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              La cuenta no tuvo movimientos en este rango.
            </div>
          ) : (
            <>
              {/* Escritorio */}
              <div className="hidden lg:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Fecha</TableHead>
                      <TableHead>Detalle</TableHead>
                      <TableHead className="w-40 text-right">Debe</TableHead>
                      <TableHead className="w-40 text-right">Haber</TableHead>
                      <TableHead className="w-40 text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mayor.movimientos.map((m, i) => (
                      <TableRow
                        key={`${m.fecha}-${i}`}
                        className="cursor-pointer"
                        onClick={() => setOrigenAbierto(m.asientoId)}
                        title="Ver de dónde sale este movimiento"
                      >
                        <TableCell className="tabular-nums text-muted-foreground">
                          {fechaCorta(m.fecha)}
                        </TableCell>
                        <TableCell>
                          {m.detalle}
                          {m.contraparte !== '—' && (
                            <span className="text-muted-foreground"> · {m.contraparte}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.debe ? formatCurrency(m.debe) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.haber ? formatCurrency(m.haber) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatCurrency(m.saldo)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Celular */}
              <ul className="divide-y lg:hidden">
                {mayor.movimientos.map((m, i) => (
                  <li
                    key={`${m.fecha}-${i}`}
                    className="px-4 py-2.5 text-sm"
                    onClick={() => setOrigenAbierto(m.asientoId)}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="tabular-nums text-muted-foreground">{fechaCorta(m.fecha)}</span>
                      <span className="min-w-0 flex-1 truncate">{m.detalle}</span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between text-xs">
                      <span className="text-muted-foreground">
                        {m.debe ? `Debe ${formatCurrency(m.debe)}` : `Haber ${formatCurrency(m.haber)}`}
                      </span>
                      <span className="tabular-nums font-medium">{formatCurrency(m.saldo)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      <OrigenDialog cuit={cuit} asientoId={origenAbierto} onCerrar={() => setOrigenAbierto(null)} />
    </div>
  );
}

/** Balance de sumas y saldos: una fila por cuenta, con los totales que tienen que cerrar. */
export function VistaSumas({
  cuit,
  periodo,
  periodos,
  cliente,
  onVerCuenta,
}: {
  cuit: string;
  periodo: string;
  periodos: PeriodoContable[];
  cliente: string;
  /** Abre el mayor de esa cuenta: el paso siguiente del camino de vuelta. */
  onVerCuenta: (codigo: string) => void;
}) {
  const [modo, setModo] = useState<ModoRango>('periodo');
  const { desde, hasta } = rangoDe(modo, periodo, periodos);

  const { data: sumas, isLoading } = useQuery({
    queryKey: ['contabilidad', 'sumas', cuit, desde, hasta],
    queryFn: () => getSumasYSaldos(cuit, desde, hasta),
    enabled: !!cuit && !!periodo,
  });

  function exportar() {
    if (!sumas) return;
    const filas: (string | number)[][] = [
      ['Sumas y saldos'],
      [cliente, `${fechaCorta(sumas.desde)} al ${fechaCorta(sumas.hasta)}`],
      [],
      ['Código', 'Cuenta', 'Saldo anterior', 'Debe', 'Haber', 'Saldo deudor', 'Saldo acreedor'],
    ];
    for (const f of sumas.filas) {
      filas.push([
        f.codigo, f.cuenta, f.saldoAnterior, f.debe, f.haber, f.saldoDeudor, f.saldoAcreedor,
      ]);
    }
    filas.push(['', 'Totales', '', sumas.debe, sumas.haber, sumas.deudor, sumas.acreedor]);
    bajarExcel(
      `Sumas y saldos - ${cliente}.xlsx`,
      'Sumas y saldos',
      filas,
      [12, 44, 16, 16, 16, 16, 16]
    );
  }

  if (!periodo) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Este cliente todavía no tiene movimientos para armar el informe.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <BarraInforme
        modo={modo}
        onModo={setModo}
        desde={desde}
        hasta={hasta}
        onExportar={exportar}
        puedeExportar={!!sumas && sumas.filas.length > 0}
      />

      {isLoading || !sumas ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Sumando los movimientos…
        </Card>
      ) : sumas.filas.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No hay movimientos registrados en este rango.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Escritorio */}
          <div className="hidden lg:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Código</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead className="text-right">Debe</TableHead>
                  <TableHead className="text-right">Haber</TableHead>
                  <TableHead className="text-right">Saldo deudor</TableHead>
                  <TableHead className="text-right">Saldo acreedor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sumas.filas.map(f => (
                  <TableRow
                    key={f.codigo}
                    className="cursor-pointer"
                    onClick={() => onVerCuenta(f.codigo)}
                    title="Ver el mayor de esta cuenta"
                  >
                    <TableCell className="tabular-nums text-muted-foreground">{f.codigo}</TableCell>
                    <TableCell>{f.cuenta}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.debe ? formatCurrency(f.debe) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.haber ? formatCurrency(f.haber) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.saldoDeudor ? formatCurrency(f.saldoDeudor) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.saldoAcreedor ? formatCurrency(f.saldoAcreedor) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-medium">
                    Totales
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatCurrency(sumas.debe)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatCurrency(sumas.haber)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatCurrency(sumas.deudor)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatCurrency(sumas.acreedor)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {/* Celular */}
          <ul className="divide-y lg:hidden">
            {sumas.filas.map(f => (
              <li
                key={f.codigo}
                className="px-4 py-2.5 text-sm"
                onClick={() => onVerCuenta(f.codigo)}
              >
                <div className="flex items-baseline gap-2">
                  <span className="tabular-nums text-muted-foreground">{f.codigo}</span>
                  <span className="min-w-0 flex-1">{f.cuenta}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>
                    Debe {formatCurrency(f.debe)} · Haber {formatCurrency(f.haber)}
                  </span>
                  <span className="tabular-nums font-medium text-foreground">
                    {f.saldoDeudor
                      ? `${formatCurrency(f.saldoDeudor)} deudor`
                      : f.saldoAcreedor
                        ? `${formatCurrency(f.saldoAcreedor)} acreedor`
                        : '—'}
                  </span>
                </div>
              </li>
            ))}
            <li className="flex items-baseline justify-between bg-muted/30 px-4 py-2.5 text-sm font-medium">
              <span>Totales</span>
              <span className="tabular-nums">
                {formatCurrency(sumas.deudor)} / {formatCurrency(sumas.acreedor)}
              </span>
            </li>
          </ul>
        </Card>
      )}
    </div>
  );
}


/** Bloque de un estado contable: una lista de cuentas con su total. */
function BloqueEstado({
  titulo,
  lineas,
  total,
  extra,
  onVerCuenta,
}: {
  titulo: string;
  lineas: LineaEstado[];
  total: number;
  extra?: { etiqueta: string; importe: number };
  onVerCuenta?: (codigo: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-4 py-3 font-medium">{titulo}</div>
      <ul className="divide-y">
        {lineas.length === 0 && !extra && (
          <li className="px-4 py-3 text-sm text-muted-foreground">Sin saldos</li>
        )}
        {lineas.map(l => (
          <li
            key={l.codigo}
            className={onVerCuenta ? 'flex items-baseline gap-3 px-4 py-2 text-sm cursor-pointer' : 'flex items-baseline gap-3 px-4 py-2 text-sm'}
            onClick={() => onVerCuenta?.(l.codigo)}
            title={onVerCuenta ? 'Ver el mayor de esta cuenta' : undefined}
          >
            <span className="tabular-nums text-muted-foreground">{l.codigo}</span>
            <span className="min-w-0 flex-1">{l.cuenta}</span>
            <span className="tabular-nums">{formatCurrency(l.importe)}</span>
          </li>
        ))}
        {extra && (
          <li className="flex items-baseline gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1 pl-[3.25rem] italic">{extra.etiqueta}</span>
            <span className="tabular-nums">{formatCurrency(extra.importe)}</span>
          </li>
        )}
        <li className="flex items-baseline gap-3 bg-muted/30 px-4 py-2.5 text-sm font-medium">
          <span className="min-w-0 flex-1">Total</span>
          <span className="tabular-nums">{formatCurrency(total)}</span>
        </li>
      </ul>
    </Card>
  );
}

/** Estados contables: resultados del rango y situación patrimonial a esa fecha. */
export function VistaEstados({
  cuit,
  periodo,
  periodos,
  cliente,
  onVerCuenta,
}: {
  cuit: string;
  periodo: string;
  periodos: PeriodoContable[];
  cliente: string;
  /** Abre el mayor de esa cuenta. */
  onVerCuenta: (codigo: string) => void;
}) {
  const [modo, setModo] = useState<ModoRango>('anio');
  const { desde, hasta } = rangoDe(modo, periodo, periodos);

  const { data: estados, isLoading } = useQuery({
    queryKey: ['contabilidad', 'estados', cuit, desde, hasta],
    queryFn: () => getEstados(cuit, desde, hasta),
    enabled: !!cuit && !!periodo,
  });

  function exportar() {
    if (!estados) return;
    const filas: (string | number)[][] = [
      ['Estados contables'],
      [cliente, `${fechaCorta(estados.desde)} al ${fechaCorta(estados.hasta)}`],
      [],
      ['Estado de resultados'],
      ['Código', 'Cuenta', 'Importe'],
    ];
    for (const l of estados.resultados) filas.push([l.codigo, l.cuenta, l.importe]);
    filas.push(['', 'Ingresos', estados.ingresos]);
    filas.push(['', 'Egresos', estados.egresos]);
    filas.push(['', 'Resultado del período', estados.resultado]);
    filas.push([]);
    filas.push([`Situación patrimonial al ${fechaCorta(estados.hasta)}`]);
    filas.push(['Código', 'Cuenta', 'Importe']);
    for (const l of estados.activo) filas.push([l.codigo, l.cuenta, l.importe]);
    filas.push(['', 'Total activo', estados.totalActivo]);
    for (const l of estados.pasivo) filas.push([l.codigo, l.cuenta, l.importe]);
    filas.push(['', 'Total pasivo', estados.totalPasivo]);
    for (const l of estados.patrimonio) filas.push([l.codigo, l.cuenta, l.importe]);
    filas.push(['', 'Resultado acumulado', estados.resultadoAcumulado]);
    filas.push(['', 'Total patrimonio neto', estados.totalPatrimonio]);
    bajarExcel(`Estados contables - ${cliente}.xlsx`, 'Estados', filas, [12, 44, 18]);
  }

  if (!periodo) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Este cliente todavía no tiene movimientos para armar los estados.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <BarraInforme
        modo={modo}
        onModo={setModo}
        desde={desde}
        hasta={hasta}
        onExportar={exportar}
        puedeExportar={!!estados && !estados.sinPlan}
      />

      {isLoading || !estados ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Armando los estados…
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Ingresos</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatCurrency(estados.ingresos)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Egresos</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatCurrency(estados.egresos)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {estados.resultado >= 0 ? 'Ganancia del período' : 'Pérdida del período'}
                </div>
                <div
                  className={cn(
                    'mt-1 text-2xl font-semibold tabular-nums',
                    estados.resultado >= 0 ? 'text-success' : 'text-destructive'
                  )}
                >
                  {formatCurrency(Math.abs(estados.resultado))}
                </div>
              </div>
            </div>
          </Card>

          <BloqueEstado
            titulo={`Estado de resultados · ${fechaCorta(estados.desde)} al ${fechaCorta(estados.hasta)}`}
            lineas={estados.resultados}
            onVerCuenta={onVerCuenta}
            total={estados.resultado}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <BloqueEstado
              titulo={`Activo al ${fechaCorta(estados.hasta)}`}
              lineas={estados.activo}
            onVerCuenta={onVerCuenta}
              total={estados.totalActivo}
            />
            <div className="space-y-4">
              <BloqueEstado
                titulo="Pasivo"
                lineas={estados.pasivo}
            onVerCuenta={onVerCuenta}
                total={estados.totalPasivo}
              />
              <BloqueEstado
                titulo="Patrimonio neto"
                lineas={estados.patrimonio}
            onVerCuenta={onVerCuenta}
                total={estados.totalPatrimonio}
                extra={{ etiqueta: 'Resultado acumulado', importe: estados.resultadoAcumulado }}
              />
            </div>
          </div>

          <div
            className={cn(
              'flex items-start gap-2 rounded-lg px-4 py-3 text-xs',
              estados.cierra
                ? 'bg-muted/30 text-muted-foreground'
                : 'bg-destructive/10 text-destructive'
            )}
          >
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {estados.cierra
                ? 'El activo coincide con pasivo más patrimonio neto. Son estados preliminares: no incluyen amortizaciones, sueldos ni ajustes de cierre, que se cargan a mano.'
                : 'El activo no coincide con pasivo más patrimonio neto. Revisá los asientos del período antes de usar estos números.'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
