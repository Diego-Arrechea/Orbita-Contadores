import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Orbit, Printer, ArrowLeft, Building2, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getCliente } from '@/data/clientes';
import { useClienteReal } from '@/lib/queries';
import { calcularCliente, ventana12Meses } from '@/lib/monotributo';
import { esMonotributista, etiquetaRegimen } from '@/lib/regimen';
import { getCategoria } from '@/data/categorias';
import { cuentaActual } from '@/lib/cuenta';
import { useConfig } from '@/context/ConfigContext';
import { derivarAlertas, ordenarPorSeveridad, type Severidad } from '@/lib/alertas';
import { accionesSugeridas, esPendienteRespaldo } from '@/lib/reporteCliente';
import { getMovimientos } from '@/services/movimientosService';
import type { ConfigReporte, MovimientoBancario } from '@/types';
import { formatCurrency, formatCuit, formatDate, formatPercent } from '@/lib/utils';

// Secciones del reporte que el contador puede mostrar/ocultar (además de datos del cliente, que
// siempre van). El label es el que se ve en el panel de personalización.
const SECCIONES_REPORTE: { key: keyof ConfigReporte['secciones']; label: string }[] = [
  { key: 'situacion', label: 'Situación de monotributo' },
  { key: 'historial', label: 'Historial mensual' },
  { key: 'alertas', label: 'Alertas' },
  { key: 'movimientos', label: 'Movimientos pendientes' },
  { key: 'acciones', label: 'Acciones sugeridas' },
];

function mesLegible(mes: string): string {
  const [y, m] = mes.split('-');
  return m && y ? `${m}/${y}` : mes;
}

const SEV_DOT: Record<Severidad, string> = {
  urgente: 'bg-danger',
  aviso: 'bg-warning',
  datos: 'bg-muted-foreground',
  ok: 'bg-success',
};

export function ReporteCliente() {
  const { id } = useParams<{ id: string }>();
  const clienteMock = id ? getCliente(id) : undefined;
  // Cliente cacheado: comparte cache con la ficha (misma query key), así abrir el reporte tras ver
  // la ficha es instantáneo. enabled evita pedir cuando se usa el mock.
  const { data: clienteReal, isLoading: cargando } = useClienteReal(id, !clienteMock);
  const { config, inflacionEfectiva, guardarConfig } = useConfig();
  const [movimientos, setMovimientos] = useState<MovimientoBancario[]>([]);
  // Observaciones del contador: son POR reporte (no se guardan en la cuenta); se tipean antes de imprimir.
  const [observaciones, setObservaciones] = useState('');

  // Preferencias de reporte (globales, guardadas en la cuenta). El guardado es optimista.
  const rep = config.reporte;
  const setReporte = (patch: Partial<ConfigReporte>) => {
    void guardarConfig({ reporte: { ...rep, ...patch } });
  };
  const toggleSeccion = (k: keyof ConfigReporte['secciones']) =>
    setReporte({ secciones: { ...rep.secciones, [k]: !rep.secciones[k] } });
  const toggleMetrica = (k: keyof ConfigReporte['metricas']) =>
    setReporte({ metricas: { ...rep.metricas, [k]: !rep.metricas[k] } });

  const cliente = clienteMock ?? clienteReal ?? undefined;
  const cuenta = cuentaActual();

  // Movimientos para el bloque "pendientes de respaldo": para clientes reales se piden al backend;
  // para los mock (demo) se usan los embebidos.
  useEffect(() => {
    if (!cliente) return;
    if (cliente.fuente === 'arca') {
      getMovimientos(cliente.cuit).then(setMovimientos).catch(() => setMovimientos([]));
    } else {
      setMovimientos(cliente.movimientosBancarios ?? []);
    }
  }, [cliente?.id, cliente?.fuente, cliente?.cuit]);

  if (cargando) {
    return <div className="p-12 text-center text-muted-foreground">Generando reporte…</div>;
  }
  if (!cliente) {
    return (
      <div className="p-12 text-center">
        <div className="font-medium">Cliente no encontrado</div>
        <Link to="/" className="text-primary hover:underline text-sm">
          Volver al dashboard
        </Link>
      </div>
    );
  }

  const calc = calcularCliente(cliente, config.ventanas, inflacionEfectiva);
  const noMono = !esMonotributista(cliente);
  const cat = getCategoria(cliente.categoria);
  const debeRecategorizar = !noMono && calc.categoriaCorresponde.codigo !== cliente.categoria;
  const ultimos12 = ventana12Meses(cliente.historialMensual);
  // Historial recortado a los últimos N meses que el contador eligió (de los hasta 12 disponibles).
  const historial = ultimos12.slice(-rep.mesesHistorial);
  const alertas = ordenarPorSeveridad(derivarAlertas(cliente, calc, config));
  const pendientes = movimientos.filter(esPendienteRespaldo);
  const acciones = accionesSugeridas(cliente, calc, alertas, pendientes.length);

  // Cards de la sección "Situación de monotributo", data-driven para poder sacar/poner cada una.
  // `valor` null = la métrica no aplica a este cliente (no se ofrece ni se muestra). Sólo mono.
  const meses = cliente.mesesAdeudados ?? 0;
  const metricas: { key: keyof ConfigReporte['metricas']; label: string; valor: string | null }[] = noMono
    ? []
    : [
        { key: 'facturacion12m', label: 'Facturación últimos 12 meses', valor: formatCurrency(calc.facturacionUltimos12) },
        { key: 'topeCategoria', label: 'Tope de la categoría', valor: formatCurrency(cat.topeAnual) },
        { key: 'topeConsumido', label: 'Tope consumido', valor: formatPercent(calc.porcentajeTopeActual, 1) },
        {
          key: 'cuotaMes',
          label: 'Cuota del mes',
          valor: formatCurrency(
            cliente.proxVencImporte ??
              (cliente.tipoActividad === 'servicios' ? cat.cuotaServicios : cat.cuotaComercio),
          ),
        },
        { key: 'estadoCuota', label: 'Estado de la cuota', valor: cliente.estadoCuotaMesActual === 'con-deuda' ? 'Con deuda' : 'Al día' },
        { key: 'proximoVencimiento', label: 'Próximo vencimiento', valor: cliente.proxVencFecha ?? '—' },
        { key: 'deudaCuota', label: 'Deuda de cuota', valor: formatCurrency(cliente.cuotaDeuda ?? 0) },
        {
          key: 'mesesAdeudados',
          label: 'Meses adeudados',
          valor: meses >= 1 ? `${meses} ${meses === 1 ? 'mes' : 'meses'} seguido${meses === 1 ? '' : 's'}` : null,
        },
        {
          key: 'saldoFavor',
          label: 'Saldo a favor',
          valor: cliente.cuotaSaldoFavor && cliente.cuotaSaldoFavor > 0 ? formatCurrency(cliente.cuotaSaldoFavor) : null,
        },
      ];
  // Métricas que aplican a este cliente (tienen valor): las que se pueden mostrar/ocultar.
  const metricasDisponibles = metricas.filter(m => m.valor !== null);

  return (
    <div className="min-h-full bg-muted/30 print:bg-white">
      {/* Barra de acciones: se oculta al imprimir */}
      <div className="print:hidden sticky top-0 z-10 border-b border-border/60 bg-card/90 backdrop-blur">
        <div className="mx-auto max-w-[820px] px-6 py-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
            <Link to={`/clientes/${cliente.id}`}>
              <ArrowLeft className="h-4 w-4" /> Volver a la ficha
            </Link>
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimir / Guardar PDF
          </Button>
        </div>
      </div>

      {/* Panel de personalización del reporte (no se imprime). Las secciones y los meses de historial
          se guardan en la cuenta; las observaciones son de este reporte. */}
      <div className="print:hidden mx-auto max-w-[820px] px-6 pt-5">
        <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4 text-primary" /> Personalizá el reporte
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Secciones a incluir
              </div>
              <div className="flex flex-col gap-2">
                {SECCIONES_REPORTE.map(s => (
                  <label key={s.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={rep.secciones[s.key]}
                      onChange={() => toggleSeccion(s.key)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Historial a mostrar
                </div>
                <Select
                  value={String(rep.mesesHistorial)}
                  onValueChange={v => setReporte({ mesesHistorial: Number(v) })}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">Últimos 3 meses</SelectItem>
                    <SelectItem value="6">Últimos 6 meses</SelectItem>
                    <SelectItem value="12">Últimos 12 meses</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Observaciones (aparecen en el reporte)
                </div>
                <Textarea
                  value={observaciones}
                  onChange={e => setObservaciones(e.target.value)}
                  placeholder="Notas o comentarios para este reporte…"
                  rows={3}
                />
              </div>
            </div>
          </div>

          {/* Cards de la situación de monotributo: sacar/poner cada una (también con la × en la card). */}
          {rep.secciones.situacion && metricasDisponibles.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border/60">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Cards de la situación (tocá para sacar o poner)
              </div>
              <div className="flex flex-wrap gap-2">
                {metricasDisponibles.map(m => {
                  const on = rep.metricas[m.key];
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => toggleMetrica(m.key)}
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        on
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-muted text-muted-foreground line-through'
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Las secciones, las cards y el historial quedan guardados para tus próximos reportes. Las
            observaciones son sólo de este reporte.
          </p>
        </div>
      </div>

      {/* Documento */}
      <div className="mx-auto max-w-[820px] my-6 bg-white text-foreground rounded-xl shadow-sm border border-border/60 p-5 sm:p-10 print:my-0 print:p-0 print:border-0 print:shadow-none print:rounded-none">
        <header className="flex items-start justify-between border-b border-border/60 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Orbit className="h-6 w-6" />
            </div>
            <div className="leading-tight">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold tracking-tight text-foreground">Órbita</span>
                <span className="text-sm font-medium text-muted-foreground">para contadores</span>
              </div>
              <div className="text-xs text-muted-foreground">por Órbita.</div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">{cuenta?.estudio ?? 'Estudio contable'}</div>
            {cuenta?.nombre && <div className="text-muted-foreground">{cuenta.nombre}</div>}
            <div className="text-muted-foreground mt-1">
              Generado el {formatDate(new Date().toISOString(), 'long')}
            </div>
          </div>
        </header>

        <h1 className="text-xl font-semibold mt-6">
          Reporte de situación {noMono ? 'fiscal' : 'de monotributo'}
        </h1>

        {/* Datos del cliente */}
        <section className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Dato label="Cliente" valor={cliente.nombre} />
          <Dato label="CUIT" valor={formatCuit(cliente.cuit)} />
          <Dato label="Régimen" valor={etiquetaRegimen(cliente.regimen)} />
          <Dato label="Actividad" valor={cliente.tipoActividad} capitalizar />
          {!noMono && <Dato label="Categoría actual" valor={`Cat. ${cliente.categoria}`} />}
          <Dato label="Datos desde" valor={formatDate(cliente.fechaInicio, 'long')} />
        </section>

        {/* Observaciones del contador (si las cargó): van arriba, es lo primero que quiere leer quien recibe el reporte. */}
        {observaciones.trim() && (
          <section className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-4 print:bg-white">
            <div className="text-xs uppercase tracking-wider text-primary font-semibold mb-1">Observaciones</div>
            <p className="text-sm whitespace-pre-wrap">{observaciones.trim()}</p>
          </section>
        )}

        {rep.secciones.situacion && (noMono ? (
          <section className="mt-7 rounded-lg border border-border/60 bg-muted/30 p-5 print:bg-white">
            <div className="flex items-start gap-3">
              <Building2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">{etiquetaRegimen(cliente.regimen)}</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Este cliente no es monotributista; el seguimiento de categoría, topes y
                  recategorización no aplica. A continuación, su facturación de los últimos meses a
                  título informativo.
                </p>
              </div>
            </div>
            <div className="mt-4 text-sm">
              <Dato
                label="Facturación últimos 12 meses"
                valor={formatCurrency(calc.facturacionUltimos12)}
              />
            </div>
          </section>
        ) : (
          <>
            <h2 className="text-base font-semibold mt-7 mb-3">Situación de monotributo</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {metricasDisponibles
                .filter(m => rep.metricas[m.key])
                .map(m => (
                  <Metrica key={m.key} label={m.label} valor={m.valor as string} onQuitar={() => toggleMetrica(m.key)} />
                ))}
            </div>

            {debeRecategorizar && (
              <div className="mt-4 rounded-lg bg-warning/15 border border-warning/30 px-4 py-3 text-sm">
                Con la facturación actual, debería recategorizarse a{' '}
                <strong>Cat. {calc.categoriaCorresponde.codigo}</strong> (tope{' '}
                {formatCurrency(calc.categoriaCorresponde.topeAnual)}).
              </div>
            )}
            {calc.proximaVentana && (
              <p className="mt-3 text-sm text-muted-foreground">
                Próxima ventana de recategorización:{' '}
                {formatDate(calc.proximaVentana.fechaLimite, 'long')} (semestre{' '}
                {calc.proximaVentana.semestre}).
              </p>
            )}
          </>
        ))}

        {/* Historial mensual */}
        {rep.secciones.historial && historial.length > 0 && (
          <>
            <h2 className="text-base font-semibold mt-8 mb-3">
              Historial de los últimos {historial.length === 1 ? 'mes' : `${historial.length} meses`}
            </h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border/60 text-left text-muted-foreground">
                  <th className="py-2 font-medium">Mes</th>
                  <th className="py-2 font-medium text-right">Ventas netas</th>
                  <th className="py-2 font-medium text-right">Compras</th>
                </tr>
              </thead>
              <tbody>
                {historial.map(m => (
                  <tr key={m.mes} className="border-b border-border/40">
                    <td className="py-1.5 tabular-nums">{mesLegible(m.mes)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatCurrency(m.emitidasNetas)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatCurrency(m.recibidas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Alertas */}
        {rep.secciones.alertas && (
          <>
            <h2 className="text-base font-semibold mt-8 mb-3">Alertas</h2>
            {alertas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin alertas activas para este cliente.</p>
            ) : (
              <ul className="space-y-2">
                {alertas.map(a => (
                  <li key={a.id} className="flex items-start gap-2.5 text-sm">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[a.severidad]}`} />
                    <span>
                      <span className="font-medium">{a.titulo}.</span>{' '}
                      <span className="text-muted-foreground">{a.detalle}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* Movimientos pendientes de respaldo fiscal */}
        {rep.secciones.movimientos && (
          <>
        <h2 className="text-base font-semibold mt-8 mb-3">Movimientos pendientes de respaldo fiscal</h2>
        {pendientes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay movimientos pendientes de respaldo.</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border/60 text-left text-muted-foreground">
                <th className="py-2 font-medium">Fecha</th>
                <th className="py-2 font-medium">Originante</th>
                <th className="py-2 font-medium text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {pendientes.map(m => (
                <tr key={m.id} className="border-b border-border/40">
                  <td className="py-1.5 tabular-nums whitespace-nowrap">{formatDate(m.fecha)}</td>
                  <td className="py-1.5">
                    {m.nombreOriginante || m.descripcion || '—'}
                    {m.cuitOriginante && (
                      <span className="text-muted-foreground"> · {formatCuit(m.cuitOriginante)}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatCurrency(m.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
          </>
        )}

        {/* Acciones sugeridas */}
        {rep.secciones.acciones && acciones.length > 0 && (
          <>
            <h2 className="text-base font-semibold mt-8 mb-3">Acciones sugeridas</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {acciones.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </>
        )}

        <footer className="mt-10 pt-5 border-t border-border/60 text-xs text-muted-foreground">
          Documento informativo de apoyo, generado con Órbita. No reemplaza la consulta a los canales
          oficiales.
        </footer>
      </div>
    </div>
  );
}

function Dato({ label, valor, capitalizar }: { label: string; valor: string; capitalizar?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={capitalizar ? 'capitalize' : undefined}>{valor}</div>
    </div>
  );
}

function Metrica({ label, valor, onQuitar }: { label: string; valor: string; onQuitar?: () => void }) {
  return (
    <div className="group relative rounded-lg border border-border/60 p-3.5">
      {onQuitar && (
        <button
          type="button"
          onClick={onQuitar}
          title="Sacar esta card del reporte"
          aria-label="Sacar esta card del reporte"
          className="print:hidden absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-danger group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{valor}</div>
    </div>
  );
}
