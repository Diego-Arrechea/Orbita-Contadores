import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Download,
  Info,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useClientesReales } from '@/lib/queries';
import {
  borrarCuenta,
  crearCuenta,
  editarCuenta,
  getDiario,
  getPeriodosContables,
  getPlanCuentas,
  importarPlanCuentas,
  sembrarPlanCuentas,
  TIPOS_CUENTA,
  type Asiento,
  type Cuenta,
  type CuentaNueva,
  type Diario,
  type TipoCuenta,
} from '@/services/contabilidadService';
import { mensajeDeError } from '@/services/authService';
import { formatCurrency, formatCuit, cn } from '@/lib/utils';

type VistaContable = 'diario' | 'plan';

const CUENTA_VACIA: CuentaNueva = { codigo: '', nombre: '', tipo: 'activo', imputable: true };

function labelTipo(tipo: TipoCuenta): string {
  return TIPOS_CUENTA.find(t => t.valor === tipo)?.label ?? tipo;
}

/** Tipo de cuenta según el primer dígito del código (1 activo, 2 pasivo, 3 patrimonio, 4 ingresos,
 *  5 egresos). Sirve para importar planes que no traen una columna de tipo. */
function tipoSegunCodigo(codigo: string): TipoCuenta {
  const porDigito: Record<string, TipoCuenta> = {
    '1': 'activo',
    '2': 'pasivo',
    '3': 'patrimonio',
    '4': 'resultado_positivo',
    '5': 'resultado_negativo',
  };
  return porDigito[codigo.trim()[0]] ?? 'activo';
}

function normalizar(valor: unknown): string {
  return String(valor ?? '').trim().toLowerCase();
}

/** Traduce lo que venga en la columna "tipo" del Excel; si no se reconoce, cae al código. */
function tipoDesdeTexto(texto: string, codigo: string): TipoCuenta {
  const t = normalizar(texto);
  if (!t) return tipoSegunCodigo(codigo);
  if (TIPOS_CUENTA.some(x => x.valor === t)) return t as TipoCuenta;
  if (t.startsWith('activo')) return 'activo';
  if (t.startsWith('pasivo')) return 'pasivo';
  if (t.startsWith('patrimonio')) return 'patrimonio';
  if (t.startsWith('ingreso') || t.startsWith('venta')) return 'resultado_positivo';
  if (t.startsWith('egreso') || t.startsWith('gasto') || t.startsWith('compra')) {
    return 'resultado_negativo';
  }
  return tipoSegunCodigo(codigo);
}

class FormatoError extends Error {}

/** Lee un plan de cuentas de una planilla. Espera una columna de código y una de nombre; el tipo y
 *  si es imputable se deducen cuando no vienen (una cuenta con hijas es un título, no se imputa). */
async function parsearPlan(file: File): Promise<CuentaNueva[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: true });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) throw new FormatoError('La planilla está vacía.');
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: '' });
  const idxHeader = matriz.findIndex(row =>
    (row as unknown[]).some(c => normalizar(c).startsWith('c') && normalizar(c).includes('digo'))
  );
  if (idxHeader < 0) {
    throw new FormatoError('No encontramos la columna Código. Usá la planilla de ejemplo.');
  }
  const header = (matriz[idxHeader] as unknown[]).map(normalizar);
  const idxCodigo = header.findIndex(h => h.includes('digo'));
  const idxNombre = header.findIndex(h => h.includes('nombre') || h.includes('descrip'));
  const idxTipo = header.findIndex(h => h.includes('tipo') || h.includes('rubro'));
  const idxImputable = header.findIndex(h => h.includes('imputa'));
  if (idxNombre < 0) throw new FormatoError('No encontramos la columna Nombre.');

  const celda = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const crudas: { codigo: string; nombre: string; tipo: string; imputable: string }[] = [];
  for (const row of matriz.slice(idxHeader + 1) as unknown[][]) {
    const codigo = celda(row, idxCodigo);
    const nombre = celda(row, idxNombre);
    if (!codigo || !nombre) continue; // filas vacías o de corte
    crudas.push({
      codigo,
      nombre,
      tipo: celda(row, idxTipo),
      imputable: celda(row, idxImputable),
    });
  }
  if (crudas.length === 0) throw new FormatoError('La planilla no tiene cuentas cargadas.');

  const codigos = crudas.map(c => c.codigo);
  return crudas.map(c => ({
    codigo: c.codigo.slice(0, 20),
    nombre: c.nombre.slice(0, 120),
    tipo: tipoDesdeTexto(c.tipo, c.codigo),
    imputable: c.imputable
      ? ['si', 'sí', 'x', 'true', '1', 'verdadero'].includes(normalizar(c.imputable))
      : // Sin columna: una cuenta que tiene otras colgando es un título (no se imputa).
        !codigos.some(otro => otro !== c.codigo && otro.startsWith(`${c.codigo}.`)),
  }));
}

/**
 * Apartado de Contabilidad (piloto). Arma el libro diario del período con los comprobantes que la
 * app ya tiene, imputados sobre el plan de cuentas del cliente (uno por cliente: se puede empezar
 * del plan sugerido o importar el que el estudio ya usa).
 *
 * Rollout gateado: sólo llegan acá las cuentas habilitadas (RequireContabilidad); el backend valida
 * el mismo gate en cada endpoint.
 */
export function Contabilidad() {
  const { data: cartera = [], isLoading: cargandoCartera } = useClientesReales();
  const [cuit, setCuit] = useState<string>('');
  const [periodo, setPeriodo] = useState<string>('');
  const [vista, setVista] = useState<VistaContable>('diario');
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // La contabilidad es para Responsables Inscriptos y sociedades: los monotributistas confirmados no
  // aparecen en el selector (se dejan los que todavía no tienen el régimen resuelto).
  const carteraContable = useMemo(
    () => cartera.filter(c => c.regimen !== 'monotributo'),
    [cartera]
  );

  const cuitActivo = cuit || carteraContable[0]?.cuit || '';
  const clienteActivo = carteraContable.find(c => c.cuit === cuitActivo);

  const { data: periodos = [], isLoading: cargandoPeriodos } = useQuery({
    queryKey: ['contabilidad', 'periodos', cuitActivo],
    queryFn: () => getPeriodosContables(cuitActivo),
    enabled: !!cuitActivo,
  });
  const periodoActivo = periodo || periodos[0]?.periodo || '';

  const { data: plan = [], isLoading: cargandoPlan } = useQuery({
    queryKey: ['contabilidad', 'plan', cuitActivo],
    queryFn: () => getPlanCuentas(cuitActivo),
    enabled: !!cuitActivo,
  });

  const { data: diario, isLoading: cargandoDiario } = useQuery({
    queryKey: ['contabilidad', 'diario', cuitActivo, periodoActivo],
    queryFn: () => getDiario(cuitActivo, periodoActivo),
    enabled: !!cuitActivo && !!periodoActivo && plan.length > 0,
  });

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['contabilidad', 'plan', cuitActivo] });
    qc.invalidateQueries({ queryKey: ['contabilidad', 'diario', cuitActivo] });
  }

  async function conAviso(accion: () => Promise<string>) {
    setTrabajando(true);
    setAviso(null);
    setError(null);
    try {
      setAviso(await accion());
      refrescar();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setTrabajando(false);
    }
  }

  const sembrar = () =>
    conAviso(async () => {
      const { creadas } = await sembrarPlanCuentas(cuitActivo);
      if (!creadas) return 'El plan ya tenía todas las cuentas sugeridas.';
      return creadas === 1
        ? 'Listo: se agregó 1 cuenta al plan.'
        : `Listo: se agregaron ${creadas} cuentas al plan.`;
    });

  const importar = (file: File) =>
    conAviso(async () => {
      const cuentas = await parsearPlan(file);
      const r = await importarPlanCuentas(cuitActivo, cuentas);
      const partes = [
        `${r.creadas} cuenta${r.creadas === 1 ? '' : 's'} nueva${r.creadas === 1 ? '' : 's'}`,
        `${r.actualizadas} actualizada${r.actualizadas === 1 ? '' : 's'}`,
      ];
      if (r.sistema) partes.push(`${r.sistema} agregadas para los asientos automáticos`);
      return `Plan importado: ${partes.join(' · ')}.`;
    });

  function descargarPlan() {
    const filas: (string | number)[][] = [['Código', 'Nombre', 'Tipo', 'Imputable']];
    for (const c of plan) {
      filas.push([c.codigo, c.nombre, labelTipo(c.tipo), c.imputable ? 'Sí' : 'No']);
    }
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = [{ wch: 12 }, { wch: 44 }, { wch: 16 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plan de cuentas');
    XLSX.writeFile(wb, `Plan de cuentas - ${clienteActivo?.nombre ?? cuitActivo}.xlsx`);
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight">Contabilidad</h1>
          <Badge variant="outline" className="text-warning-foreground border-warning/50 bg-warning/10">
            Piloto
          </Badge>
        </div>
        <p className="text-base text-muted-foreground mt-2">
          El libro diario de tus clientes, armado con sus comprobantes e imputado sobre su plan de
          cuentas.
        </p>
      </div>

      {/* Selectores: cliente + período */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Cliente</label>
            <Select
              value={cuitActivo}
              onValueChange={v => {
                setCuit(v);
                setPeriodo('');
                setAviso(null);
                setError(null);
              }}
              disabled={cargandoCartera || carteraContable.length === 0}
            >
              <SelectTrigger className="mt-1 h-10 bg-card">
                <SelectValue placeholder={cargandoCartera ? 'Cargando…' : 'Elegí un cliente'} />
              </SelectTrigger>
              <SelectContent>
                {carteraContable.map(c => (
                  <SelectItem key={c.cuit} value={c.cuit}>
                    {c.nombre} · {formatCuit(c.cuit)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Período</label>
            <Select
              value={periodoActivo}
              onValueChange={setPeriodo}
              disabled={cargandoPeriodos || periodos.length === 0}
            >
              <SelectTrigger className="mt-1 h-10 bg-card">
                <SelectValue
                  placeholder={
                    cargandoPeriodos
                      ? 'Cargando…'
                      : periodos.length
                        ? 'Elegí un período'
                        : 'Sin períodos'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {periodos.map(p => (
                  <SelectItem key={p.periodo} value={p.periodo}>
                    {p.label}
                    <span className="text-muted-foreground">
                      {'  ·  '}
                      {p.ventas + p.compras} comprobantes
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Tabs value={vista} onValueChange={v => setVista(v as VistaContable)}>
            <TabsList>
              <TabsTrigger value="diario">Libro diario</TabsTrigger>
              <TabsTrigger value="plan">Plan de cuentas</TabsTrigger>
            </TabsList>
          </Tabs>
          {!!cuitActivo && (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={trabajando}
                title="Subí el plan de cuentas que ya usás (Excel o CSV). Las que existen se actualizan y las nuevas se agregan."
              >
                {trabajando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Importar plan
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={descargarPlan}
                disabled={plan.length === 0}
                title="Descarga el plan de cuentas de este cliente en Excel"
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar plan
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // permite reintentar con el mismo archivo corregido
                  if (file) importar(file);
                }}
              />
            </div>
          )}
        </div>

        {(aviso || error) && (
          <div
            className={cn(
              'mt-3 rounded-lg px-3 py-2 text-sm',
              error ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'
            )}
          >
            {error ?? aviso}
          </div>
        )}
      </Card>

      {!cuitActivo ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {cargandoCartera
            ? 'Cargando tus clientes…'
            : 'Todavía no tenés clientes con contabilidad: este apartado es para Responsables Inscriptos y sociedades.'}
        </Card>
      ) : cargandoPlan ? (
        <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </Card>
      ) : plan.length === 0 ? (
        <SinPlan onSembrar={sembrar} onImportar={() => fileRef.current?.click()} ocupado={trabajando} />
      ) : vista === 'diario' ? (
        <VistaDiario diario={diario} cargando={cargandoDiario} periodoElegido={!!periodoActivo} />
      ) : (
        <VistaPlan cuit={cuitActivo} plan={plan} onCambio={refrescar} />
      )}
    </div>
  );
}

/** Estado inicial: el cliente todavía no tiene plan de cuentas, así que no hay dónde imputar. */
function SinPlan({
  onSembrar,
  onImportar,
  ocupado,
}: {
  onSembrar: () => void;
  onImportar: () => void;
  ocupado: boolean;
}) {
  return (
    <Card className="p-8 text-center">
      <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-medium">Armá el plan de cuentas de este cliente</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
        Cada cliente tiene su propio plan. Podés empezar con el plan sugerido y editarlo, o importar
        el que ya venís usando. Con el plan cargado, el libro diario se arma solo.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={onSembrar} disabled={ocupado}>
          {ocupado ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Usar el plan sugerido
        </Button>
        <Button variant="outline" onClick={onImportar} disabled={ocupado}>
          <Upload className="mr-2 h-4 w-4" />
          Importar mi plan
        </Button>
      </div>
    </Card>
  );
}

/** Libro diario del período: totales + un asiento por comprobante. */
function VistaDiario({
  diario,
  cargando,
  periodoElegido,
}: {
  diario: Diario | undefined;
  cargando: boolean;
  periodoElegido: boolean;
}) {
  if (!periodoElegido) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Este cliente todavía no tiene comprobantes para armar el diario.
      </Card>
    );
  }
  if (cargando || !diario) {
    return (
      <Card className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Armando el libro diario…
      </Card>
    );
  }
  if (diario.asientos.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        No hay comprobantes en este período.
      </Card>
    );
  }

  const t = diario.totales;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Totalizador label="Asientos" valor={String(t.asientos)} />
          <Totalizador label="Total al debe" valor={formatCurrency(t.debe)} />
          <Totalizador label="Total al haber" valor={formatCurrency(t.haber)} />
        </div>
      </Card>

      {t.revisar > 0 && (
        <Card className="flex items-start gap-2 border-warning/40 bg-warning/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
          <span>
            {t.revisar} {t.revisar === 1 ? 'asiento quedó' : 'asientos quedaron'} con una cuenta
            genérica de compras. Revisá a qué cuenta corresponde
            {t.revisar === 1 ? '' : ' cada uno'} antes de cerrar el período.
          </span>
        </Card>
      )}

      <div className="space-y-3">
        {diario.asientos.map(a => (
          <AsientoCard key={a.id} asiento={a} />
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Cada comprobante del período genera su asiento: las ventas contra Deudores por ventas y las
          compras contra Proveedores, con el IVA y las percepciones en sus cuentas. Las notas de
          crédito se registran invertidas. Los cobros y pagos todavía no se registran acá.
        </span>
      </div>
    </div>
  );
}

function Totalizador({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valor}</div>
    </div>
  );
}

/** Un asiento con sus renglones. La tarjeta funciona igual en escritorio y en celular. */
function AsientoCard({ asiento }: { asiento: Asiento }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b bg-muted/20 px-4 py-2.5">
        <span className="text-sm font-medium">{asiento.comprobante}</span>
        <Badge variant="outline" className="text-xs">
          {asiento.lado === 'ventas' ? 'Venta' : 'Compra'}
        </Badge>
        <span className="text-sm text-muted-foreground">{asiento.contraparte}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {asiento.fecha.split('-').reverse().join('/')}
        </span>
      </div>
      <ul className="divide-y">
        {asiento.lineas.map((l, i) => (
          <li
            key={`${asiento.id}-${l.codigo}-${i}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_8rem]"
          >
            <div className={cn('min-w-0', !l.debe && 'sm:pl-6')}>
              <span className="text-muted-foreground tabular-nums">{l.codigo}</span>{' '}
              <span className={cn(l.porDefecto && 'underline decoration-warning decoration-dotted')}>
                {l.cuenta}
              </span>
              {l.porDefecto && (
                <Badge variant="outline" className="ml-2 text-[10px] uppercase">
                  a revisar
                </Badge>
              )}
            </div>
            <div className="text-right tabular-nums">
              {l.debe ? formatCurrency(l.debe) : <span className="hidden sm:inline">—</span>}
            </div>
            <div className="text-right tabular-nums text-muted-foreground">
              {l.haber ? formatCurrency(l.haber) : <span className="hidden sm:inline">—</span>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Plan de cuentas del cliente: alta, edición y borrado. Tabla en escritorio, tarjetas en celular. */
function VistaPlan({
  cuit,
  plan,
  onCambio,
}: {
  cuit: string;
  plan: Cuenta[];
  onCambio: () => void;
}) {
  const [editando, setEditando] = useState<number | null>(null);
  const [borrador, setBorrador] = useState<CuentaNueva>(CUENTA_VACIA);
  const [agregando, setAgregando] = useState(false);
  const [nueva, setNueva] = useState<CuentaNueva>(CUENTA_VACIA);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function correr(accion: () => Promise<unknown>) {
    setGuardando(true);
    setError(null);
    try {
      await accion();
      onCambio();
      return true;
    } catch (e) {
      setError(mensajeDeError(e));
      return false;
    } finally {
      setGuardando(false);
    }
  }

  const guardarEdicion = async (id: number) => {
    if (await correr(() => editarCuenta(cuit, id, borrador))) setEditando(null);
  };

  const guardarNueva = async () => {
    if (await correr(() => crearCuenta(cuit, nueva))) {
      setNueva(CUENTA_VACIA);
      setAgregando(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <span className="font-medium">
          {plan.length} cuenta{plan.length === 1 ? '' : 's'}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => setAgregando(a => !a)}
          disabled={guardando}
        >
          <Plus className="mr-2 h-4 w-4" />
          Agregar cuenta
        </Button>
      </div>

      {error && <div className="bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

      {agregando && (
        <div className="grid gap-2 border-b bg-muted/20 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_12rem_auto]">
          <Input
            placeholder="Código"
            value={nueva.codigo}
            onChange={e => setNueva({ ...nueva, codigo: e.target.value })}
          />
          <Input
            placeholder="Nombre de la cuenta"
            value={nueva.nombre}
            onChange={e => setNueva({ ...nueva, nombre: e.target.value })}
          />
          <SelectTipo valor={nueva.tipo} onCambio={tipo => setNueva({ ...nueva, tipo })} />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={guardarNueva}
              disabled={guardando || !nueva.codigo.trim() || !nueva.nombre.trim()}
            >
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAgregando(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Escritorio */}
      <div className="hidden lg:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Código</TableHead>
              <TableHead>Cuenta</TableHead>
              <TableHead className="w-44">Tipo</TableHead>
              <TableHead className="w-28 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.map(c => (
              <TableRow key={c.id} className={cn(!c.imputable && 'bg-muted/20 font-medium')}>
                {editando === c.id ? (
                  <>
                    <TableCell>
                      <Input
                        value={borrador.codigo}
                        onChange={e => setBorrador({ ...borrador, codigo: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={borrador.nombre}
                        onChange={e => setBorrador({ ...borrador, nombre: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <SelectTipo
                        valor={borrador.tipo}
                        onCambio={tipo => setBorrador({ ...borrador, tipo })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => guardarEdicion(c.id)} disabled={guardando}>
                        {guardando ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditando(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="tabular-nums text-muted-foreground">{c.codigo}</TableCell>
                    <TableCell>
                      {c.nombre}
                      {!c.imputable && (
                        <span className="ml-2 text-xs text-muted-foreground">(título)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {labelTipo(c.tipo)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Editar"
                        onClick={() => {
                          setEditando(c.id);
                          setBorrador({
                            codigo: c.codigo,
                            nombre: c.nombre,
                            tipo: c.tipo,
                            imputable: c.imputable,
                          });
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Borrar"
                        onClick={() => correr(() => borrarCuenta(cuit, c.id))}
                        disabled={guardando}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Celular */}
      <ul className="divide-y lg:hidden">
        {plan.map(c => (
          <li key={c.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
            <span className="tabular-nums text-muted-foreground">{c.codigo}</span>
            <span className={cn('min-w-0 flex-1', !c.imputable && 'font-medium')}>{c.nombre}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{labelTipo(c.tipo)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SelectTipo({
  valor,
  onCambio,
}: {
  valor: TipoCuenta;
  onCambio: (tipo: TipoCuenta) => void;
}) {
  return (
    <Select value={valor} onValueChange={v => onCambio(v as TipoCuenta)}>
      <SelectTrigger className="bg-card">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TIPOS_CUENTA.map(t => (
          <SelectItem key={t.valor} value={t.valor}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
