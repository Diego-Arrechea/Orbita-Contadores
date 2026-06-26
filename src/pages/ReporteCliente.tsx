import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Orbit, Printer, ArrowLeft, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { MovimientoBancario } from '@/types';
import { formatCurrency, formatCuit, formatDate, formatPercent } from '@/lib/utils';

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
  const { config, inflacionEfectiva } = useConfig();
  const [movimientos, setMovimientos] = useState<MovimientoBancario[]>([]);

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
  const alertas = ordenarPorSeveridad(derivarAlertas(cliente, calc, config));
  const pendientes = movimientos.filter(esPendienteRespaldo);
  const acciones = accionesSugeridas(cliente, calc, alertas, pendientes.length);

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

      {/* Documento */}
      <div className="mx-auto max-w-[820px] my-6 bg-white text-foreground rounded-xl shadow-sm border border-border/60 p-5 sm:p-10 print:my-0 print:p-0 print:border-0 print:shadow-none print:rounded-none">
        <header className="flex items-start justify-between border-b border-border/60 pb-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Orbit className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-lg">Órbita</div>
              <div className="text-xs text-muted-foreground">Reporte para tu contador</div>
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

        {noMono ? (
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
              <Metrica
                label="Facturación últimos 12 meses"
                valor={formatCurrency(calc.facturacionUltimos12)}
              />
              <Metrica label="Tope de la categoría" valor={formatCurrency(cat.topeAnual)} />
              <Metrica
                label="Tope consumido"
                valor={formatPercent(calc.porcentajeTopeActual, 1)}
              />
              <Metrica
                label="Cuota del mes"
                valor={formatCurrency(
                  cliente.proxVencImporte ??
                    (cliente.tipoActividad === 'servicios' ? cat.cuotaServicios : cat.cuotaComercio),
                )}
              />
              <Metrica
                label="Estado de la cuota"
                valor={cliente.estadoCuotaMesActual === 'con-deuda' ? 'Con deuda' : 'Al día'}
              />
              <Metrica
                label="Próximo vencimiento"
                valor={cliente.proxVencFecha ?? '—'}
              />
              <Metrica label="Deuda de cuota" valor={formatCurrency(cliente.cuotaDeuda ?? 0)} />
              {!!cliente.cuotaSaldoFavor && cliente.cuotaSaldoFavor > 0 && (
                <Metrica label="Saldo a favor" valor={formatCurrency(cliente.cuotaSaldoFavor)} />
              )}
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
        )}

        {/* Historial mensual */}
        {ultimos12.length > 0 && (
          <>
            <h2 className="text-base font-semibold mt-8 mb-3">Historial de los últimos meses</h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border/60 text-left text-muted-foreground">
                  <th className="py-2 font-medium">Mes</th>
                  <th className="py-2 font-medium text-right">Ventas netas</th>
                  <th className="py-2 font-medium text-right">Compras</th>
                </tr>
              </thead>
              <tbody>
                {ultimos12.map(m => (
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

        {/* Movimientos pendientes de respaldo fiscal */}
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

        {/* Acciones sugeridas */}
        <h2 className="text-base font-semibold mt-8 mb-3">Acciones sugeridas</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          {acciones.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>

        <footer className="mt-10 pt-5 border-t border-border/60 text-xs text-muted-foreground">
          Generado con Órbita a partir de datos de ARCA. Documento informativo de apoyo; no reemplaza
          la consulta a los canales oficiales.
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

function Metrica({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border/60 p-3.5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{valor}</div>
    </div>
  );
}
