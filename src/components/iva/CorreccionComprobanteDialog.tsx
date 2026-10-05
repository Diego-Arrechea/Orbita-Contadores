import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, RotateCcw, Trash2, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  borrarCorreccionIva,
  guardarCorreccionIva,
  type DireccionIva,
  type IvaAlicuotaLinea,
  type IvaLinea,
  type IvaPercepciones,
} from '@/services/ivaService';
import { mensajeDeError } from '@/services/authService';
import { formatCurrency, cn } from '@/lib/utils';

const ALICUOTAS = [21, 10.5, 27, 5, 2.5, 0];

type ClavePercep = keyof IvaPercepciones;
const PERCEP_CAMPOS: { clave: ClavePercep; label: string }[] = [
  { clave: 'iva', label: 'Percepción de IVA' },
  { clave: 'iibb', label: 'Percepción de Ingresos Brutos' },
  { clave: 'internos', label: 'Impuestos internos' },
  { clave: 'muni', label: 'Percepciones municipales' },
  { clave: 'otros_nac', label: 'Otros impuestos nacionales' },
  { clave: 'otros', label: 'Otros tributos' },
];
const PERCEP_VACIAS: IvaPercepciones = {
  iva: 0, iibb: 0, muni: 0, internos: 0, otros_nac: 0, otros: 0, no_categ: 0,
};

/** '1.234,56' o '1234.56' -> 1234.56. Vacío o inválido -> 0. */
function parseImporte(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** 1234.5 -> '1234,50' (editable, sin separador de miles). 0 -> ''. */
function aTexto(v: number): string {
  return v ? v.toFixed(2).replace('.', ',') : '';
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function mismasAlicuotas(a: IvaAlicuotaLinea[], b: { alicuota: number; base: number }[]): boolean {
  const norm = (xs: { alicuota: number; base: number }[]) =>
    xs
      .filter(x => r2(x.base) !== 0)
      .map(x => `${x.alicuota}|${r2(x.base)}`)
      .sort()
      .join(';');
  return norm(a) === norm(b);
}

function mismasPercepciones(a: IvaPercepciones, b: IvaPercepciones): boolean {
  return (Object.keys(PERCEP_VACIAS) as ClavePercep[]).every(k => r2(a[k] ?? 0) === r2(b[k] ?? 0));
}

interface Fila {
  alicuota: string; // '21', '10.5', ...
  base: string;
}

/**
 * Panel para corregir un comprobante del Libro IVA antes de declarar: alícuota (el IVA se recalcula
 * solo), letra A↔B, no gravado / exento, reparto de "otros tributos" en percepciones, o excluirlo
 * porque no corresponde al negocio. La corrección no pisa el dato de origen: se aplica al libro, la
 * posición y los archivos, y se puede volver al original.
 */
export function CorreccionComprobanteDialog({
  linea,
  cuit,
  direccion,
  onClose,
  onGuardado,
}: {
  linea: IvaLinea | null;
  cuit: string;
  direccion: DireccionIva;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [tipo, setTipo] = useState<number>(0);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [noGravado, setNoGravado] = useState('');
  const [exento, setExento] = useState('');
  const [percep, setPercep] = useState<Record<ClavePercep, string>>(
    {} as Record<ClavePercep, string>
  );
  const [excluido, setExcluido] = useState(false);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState<null | 'guardar' | 'original'>(null);
  const [error, setError] = useState<string | null>(null);

  // Parte de los valores vigentes del comprobante (con la corrección que ya tenga).
  useEffect(() => {
    if (!linea) return;
    setTipo(linea.cbteTipo);
    setFilas(linea.alicuotas.map(a => ({ alicuota: String(a.alicuota), base: aTexto(a.base) })));
    setNoGravado(aTexto(linea.noGravado));
    setExento(aTexto(linea.exento));
    const p = linea.percepciones ?? PERCEP_VACIAS;
    setPercep(
      Object.fromEntries(
        (Object.keys(PERCEP_VACIAS) as ClavePercep[]).map(k => [k, aTexto(p[k] ?? 0)])
      ) as Record<ClavePercep, string>
    );
    setExcluido(linea.excluido);
    setNota(linea.nota ?? '');
    setError(null);
  }, [linea]);

  const o = linea?.original;

  const calc = useMemo(() => {
    if (!linea || !o) return null;
    const alics = filas.map(f => ({ alicuota: Number(f.alicuota), base: parseImporte(f.base) }));
    const percepNum = Object.fromEntries(
      (Object.keys(PERCEP_VACIAS) as ClavePercep[]).map(k => [k, parseImporte(percep[k] ?? '')])
    ) as unknown as IvaPercepciones;
    const nog = parseImporte(noGravado);
    const exe = parseImporte(exento);
    const alicsIguales = mismasAlicuotas(o.alicuotas, alics);
    const percepIguales = mismasPercepciones(o.percepciones ?? PERCEP_VACIAS, percepNum);
    // Mismo cálculo que el backend: lo no tocado queda como vino; el total se ajusta por diferencia.
    const neto = alicsIguales ? o.neto : r2(alics.reduce((s, a) => s + a.base, 0));
    const iva = alicsIguales
      ? o.iva
      : r2(alics.reduce((s, a) => s + r2((a.base * a.alicuota) / 100), 0));
    const trib = percepIguales
      ? o.tributos
      : r2((Object.keys(PERCEP_VACIAS) as ClavePercep[]).reduce((s, k) => s + percepNum[k], 0));
    const total = r2(
      o.total + (neto - o.neto) + (iva - o.iva) + (nog - o.noGravado) + (exe - o.exento) + (trib - o.tributos)
    );
    return { alics, percepNum, nog, exe, alicsIguales, percepIguales, neto, iva, trib, total };
  }, [linea, o, filas, percep, noGravado, exento]);

  if (!linea || !o || !calc) {
    return <Dialog open={false} />;
  }

  const tieneCorreccion = linea.corregido || linea.excluido || !!linea.nota;
  const ivaFila = (f: Fila) => r2((parseImporte(f.base) * Number(f.alicuota)) / 100);

  async function guardar() {
    if (!linea || !o || !calc) return;
    setGuardando('guardar');
    setError(null);
    try {
      await guardarCorreccionIva(cuit, linea.compId, {
        cbteTipo: tipo !== o.cbteTipo ? tipo : null,
        alicuotas: calc.alicsIguales ? null : calc.alics.filter(a => r2(a.base) !== 0),
        noGravado: r2(calc.nog) !== r2(o.noGravado) ? calc.nog : null,
        exento: r2(calc.exe) !== r2(o.exento) ? calc.exe : null,
        percepciones: calc.percepIguales ? null : calc.percepNum,
        excluido,
        nota: nota.trim() || null,
      });
      onGuardado();
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(null);
    }
  }

  async function volverAlOriginal() {
    if (!linea) return;
    setGuardando('original');
    setError(null);
    try {
      await borrarCorreccionIva(cuit, linea.compId);
      onGuardado();
      onClose();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(null);
    }
  }

  const campoImporte = (
    label: string,
    valor: string,
    set: (v: string) => void,
    opts?: { disabled?: boolean }
  ) => (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        value={valor}
        onChange={e => set(e.target.value)}
        inputMode="decimal"
        placeholder="0,00"
        disabled={opts?.disabled}
        className="mt-1 h-9 text-right tabular-nums"
      />
    </div>
  );

  const difTotal = r2(calc.total - o.total);

  return (
    <Dialog open={!!linea} onOpenChange={abierto => !abierto && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Corregir comprobante</DialogTitle>
          <DialogDescription>
            {o.tipo} {String(linea.puntoVenta).padStart(5, '0')}-{linea.numero} · {linea.contraparteNombre}
            {linea.contraparteCuit ? ` · ${linea.contraparteCuit}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Letra */}
          {linea.cbteTipoAlternativo && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo de comprobante</label>
              <Select value={String(tipo)} onValueChange={v => setTipo(Number(v))}>
                <SelectTrigger className="mt-1 h-9 bg-card sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={String(o.cbteTipo)}>{o.tipo} (como vino)</SelectItem>
                  <SelectItem value={String(linea.cbteTipoAlternativo)}>{linea.tipoAlternativo}</SelectItem>
                </SelectContent>
              </Select>
              {direccion === 'compras' && tipo !== o.cbteTipo && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  En compras, sólo los comprobantes A computan crédito fiscal.
                </p>
              )}
            </div>
          )}

          {/* Alícuotas */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">IVA por alícuota</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setFilas(fs => [...fs, { alicuota: '21', base: '' }])}
              >
                <Plus className="mr-1 h-4 w-4" />
                Agregar alícuota
              </Button>
            </div>
            {filas.length === 0 ? (
              <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {linea.sinDesglose
                  ? 'Este comprobante no trae el IVA discriminado. Si corresponde, agregá la alícuota y el neto gravado.'
                  : 'Sin neto gravado. Agregá una alícuota si el comprobante debía llevar IVA.'}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[6.5rem_1fr_1fr_2rem] gap-2 text-[11px] text-muted-foreground">
                  <span>Alícuota</span>
                  <span className="text-right">Neto gravado</span>
                  <span className="text-right">IVA</span>
                  <span />
                </div>
                {filas.map((f, i) => (
                  <div key={i} className="grid grid-cols-[6.5rem_1fr_1fr_2rem] items-center gap-2">
                    <Select
                      value={f.alicuota}
                      onValueChange={v =>
                        setFilas(fs => fs.map((x, j) => (j === i ? { ...x, alicuota: v } : x)))
                      }
                    >
                      <SelectTrigger className="h-9 bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALICUOTAS.map(a => (
                          <SelectItem key={a} value={String(a)}>
                            {String(a).replace('.', ',')}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={f.base}
                      onChange={e =>
                        setFilas(fs => fs.map((x, j) => (j === i ? { ...x, base: e.target.value } : x)))
                      }
                      inputMode="decimal"
                      placeholder="0,00"
                      className="h-9 text-right tabular-nums"
                    />
                    <div className="text-right text-sm tabular-nums">{formatCurrency(ivaFila(f))}</div>
                    <button
                      type="button"
                      onClick={() => setFilas(fs => fs.filter((_, j) => j !== i))}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Quitar alícuota"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {campoImporte('No gravado', noGravado, setNoGravado)}
            {campoImporte('Exento', exento, setExento)}
          </div>

          {/* Percepciones */}
          <div>
            <div className="mb-1 text-sm font-medium">Percepciones y otros tributos</div>
            <div className="grid gap-3 sm:grid-cols-3">
              {PERCEP_CAMPOS.map(c =>
                campoImporte(c.label, percep[c.clave] ?? '', v => setPercep(p => ({ ...p, [c.clave]: v })))
              )}
            </div>
            {!calc.percepIguales && r2(calc.trib) !== r2(o.tributos) && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Las percepciones suman {formatCurrency(calc.trib)}; el comprobante trae{' '}
                {formatCurrency(o.tributos)} en otros tributos. El total se ajusta por la diferencia.
              </p>
            )}
          </div>

          {/* Exclusión */}
          <div className="rounded-lg border p-3">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={excluido}
                onChange={e => setExcluido(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
              />
              <span>
                <span className="font-medium">No corresponde al negocio</span>
                <span className="block text-xs text-muted-foreground">
                  Queda listado en el libro, pero no suma a los totales, la posición ni los archivos.
                </span>
              </span>
            </label>
            <Textarea
              value={nota}
              onChange={e => setNota(e.target.value)}
              placeholder="Nota (opcional): por qué se corrigió o excluyó"
              maxLength={500}
              className="mt-3 min-h-[60px]"
            />
          </div>

          {/* Resultado */}
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <Dato label="Neto gravado" valor={calc.neto} />
            <Dato label="IVA" valor={calc.iva} />
            <Dato label="Total original" valor={o.total} />
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</div>
              <div className="font-semibold tabular-nums">{formatCurrency(calc.total)}</div>
              {difTotal !== 0 && (
                <div className={cn('text-[11px]', difTotal > 0 ? 'text-warning-foreground' : 'text-muted-foreground')}>
                  {difTotal > 0 ? '+' : '−'}
                  {formatCurrency(Math.abs(difTotal))} vs. original
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {tieneCorreccion && (
            <Button
              variant="ghost"
              onClick={volverAlOriginal}
              disabled={guardando !== null}
              className="sm:mr-auto"
            >
              {guardando === 'original' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Volver al original
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={guardando !== null}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando !== null}>
            {guardando === 'guardar' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Dato({ label, valor }: { label: string; valor: number }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="tabular-nums">{formatCurrency(valor)}</div>
    </div>
  );
}
