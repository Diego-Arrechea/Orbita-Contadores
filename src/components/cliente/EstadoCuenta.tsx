import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, AlertCircle, Wallet, Building2 } from 'lucide-react';
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
import { formatCurrency, esPersonaJuridica } from '@/lib/utils';
import { getDeuda, sincronizarDeuda, type DeudaDetalle } from '@/services/deudaService';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
}

const MSG_NO_CCMA =
  'El estado de cuenta solo aplica a monotributistas y autónomos, y este cliente no es ninguno de los dos.';

// Estilo del estado por período de la Consulta de Saldos (P05).
const ESTADO_SALDO: Record<string, { label: string; variant: 'danger' | 'success' | 'muted' }> = {
  DEUDOR: { label: 'Deudor', variant: 'danger' },
  ACREEDOR: { label: 'A favor', variant: 'success' },
  SALDADO: { label: 'Al día', variant: 'muted' },
};

/** Tab "Estado de cuenta": deuda real de la CCMA (total, capital/intereses, movimientos por período). */
export function EstadoCuenta({ cliente }: Props) {
  const esReal = cliente.fuente === 'arca';
  // El estado de cuenta (CCMA) es de monotributistas y autónomos, ambos PERSONAS FÍSICAS. Una
  // sociedad (S.R.L./S.A.) no tiene → "No aplica" directo, sin consultar nada.
  const aplica = !esPersonaJuridica(cliente.cuit);
  const qc = useQueryClient();
  // Deuda CCMA cacheada por cliente. Sólo se pide para clientes reales y que aplican (no jurídicas).
  const claveDeuda = ['cliente', cliente.cuit, 'deuda'];
  const {
    data: detalle = null,
    isLoading: cargando,
    error: queryError,
  } = useQuery({
    queryKey: claveDeuda,
    queryFn: () => getDeuda(cliente.cuit),
    enabled: esReal && aplica,
  });
  const [consultando, setConsultando] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const error =
    errorAccion ??
    (queryError ? (queryError instanceof Error ? queryError.message : 'No se pudo cargar la deuda') : null);

  const consultar = async () => {
    setConsultando(true);
    setErrorAccion(null);
    try {
      const { detalle: d, ok } = await sincronizarDeuda(cliente.cuit);
      if (!ok) setErrorAccion('No se pudo consultar el estado de cuenta. Probá de nuevo.');
      else qc.setQueryData<DeudaDetalle | null>(claveDeuda, d); // actualiza la cache sin re-pedir
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : 'No se pudo consultar la deuda');
    } finally {
      setConsultando(false);
    }
  };

  if (!esReal) {
    return (
      <Card className="p-7">
        <p className="text-sm text-muted-foreground max-w-prose">
          El estado de cuenta está disponible para los clientes reales (con datos de ARCA).
        </p>
      </Card>
    );
  }

  // Sociedad: no corresponde estado de cuenta. Definitivo (no se ofrece re-verificar).
  if (!aplica) {
    return (
      <Card className="p-7">
        <div className="flex items-start gap-3">
          <Building2 className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">No aplica</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose">{MSG_NO_CCMA}</p>
          </div>
        </div>
      </Card>
    );
  }

  // "No aplica" PERSISTIDO: ya se consultó y se guardó que el cliente no tiene cuenta corriente.
  const noAplicaMsg = detalle?.no_aplica ? detalle.motivo ?? MSG_NO_CCMA : null;
  // Detalle REAL de deuda (descarta el marcador de "no aplica").
  const det = detalle && !detalle.no_aplica ? detalle : null;
  const movimientos = det?.movimientos ?? [];
  const saldos = det?.saldos_periodo ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Estado de cuenta (CCMA)</h3>
          {det?.fecha_calculo ? (
            <p className="text-xs text-muted-foreground">
              Calculado el {det.fecha_calculo}
              {det.periodo_desde && ` · período ${det.periodo_desde} a ${det.periodo_hasta}`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Deuda de aportes y obligaciones en ARCA.</p>
          )}
        </div>
        {!noAplicaMsg && (
          <Button size="sm" onClick={consultar} disabled={consultando}>
            <RefreshCw className={consultando ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {consultando ? 'Consultando…' : 'Consultar deuda'}
          </Button>
        )}
      </div>

      {error && (
        <Card className="p-4 border-danger/40 bg-danger/5">
          <div className="text-sm text-danger flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        </Card>
      )}

      {noAplicaMsg && (
        <Card className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Building2 className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">No aplica</div>
                <p className="text-sm text-muted-foreground mt-1 max-w-prose">{noAplicaMsg}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={consultar}
              disabled={consultando}
              className="text-muted-foreground shrink-0"
            >
              <RefreshCw className={consultando ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              {consultando ? 'Verificando…' : 'Volver a verificar'}
            </Button>
          </div>
        </Card>
      )}

      {cargando && !detalle && (
        <Card className="p-7">
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </Card>
      )}

      {!cargando && !detalle && !error && (
        <Card className="p-8 text-center">
          <Wallet className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground max-w-prose mx-auto">
            Todavía no consultamos la deuda de este cliente. Tocá <b>Consultar deuda</b> para traer
            el detalle actualizado.
          </p>
        </Card>
      )}

      {det && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Deuda total
              </div>
              <div className="text-2xl font-semibold tabular-nums text-danger">
                {formatCurrency(det.deudor ?? 0)}
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Capital
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatCurrency(det.capital ?? 0)}
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Intereses
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatCurrency(det.intereses ?? 0)}
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Saldo a favor
              </div>
              <div className="text-2xl font-semibold tabular-nums text-success">
                {formatCurrency(det.acreedor ?? 0)}
              </div>
            </Card>
          </div>

          {saldos.length > 0 && (
            <>
              {/* Saldos por período (Consulta de Saldos): estado mes a mes, YA RESUELTO por ARCA.
                  Más fiable que el ledger de movimientos (que a veces no trae detalle). */}
              <Card className="hidden p-0 overflow-hidden lg:block">
                <div className="px-5 py-3 border-b border-border/60 text-sm font-medium">
                  Saldos por período
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[110px]">Período</TableHead>
                      <TableHead className="w-[140px]">Estado</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {saldos.map((s) => {
                      const meta = ESTADO_SALDO[s.estado] ?? ESTADO_SALDO.SALDADO;
                      return (
                        <TableRow key={s.periodo}>
                          <TableCell className="tabular-nums">{s.periodo}</TableCell>
                          <TableCell>
                            <Badge variant={meta.variant}>{meta.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.estado === 'SALDADO' || !s.saldo
                              ? '—'
                              : formatCurrency(Math.abs(s.saldo))}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>

              <div className="space-y-2 lg:hidden">
                <div className="text-sm font-medium">Saldos por período</div>
                {saldos.map((s) => {
                  const meta = ESTADO_SALDO[s.estado] ?? ESTADO_SALDO.SALDADO;
                  return (
                    <Card key={s.periodo} className="flex items-center justify-between gap-2 p-3 text-sm">
                      <span className="tabular-nums">{s.periodo}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span className="tabular-nums">
                        {s.estado === 'SALDADO' || !s.saldo ? '—' : formatCurrency(Math.abs(s.saldo))}
                      </span>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {movimientos.length > 0 ? (
            <>
              {/* Escritorio: tabla. Mobile (< lg): tarjetas apiladas. */}
              <Card className="hidden p-0 overflow-hidden lg:block">
                <div className="px-5 py-3 border-b border-border/60 text-sm font-medium">
                  Movimientos de la cuenta corriente
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[90px]">Período</TableHead>
                      <TableHead>Concepto</TableHead>
                      <TableHead className="w-[120px]">Vencimiento</TableHead>
                      <TableHead className="text-right w-[130px]">Debe</TableHead>
                      <TableHead className="text-right w-[130px]">Haber</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movimientos.map((m, i) => (
                      <TableRow key={`${m.periodo}-${m.impuesto}-${m.descripcion}-${i}`}>
                        <TableCell className="tabular-nums">{m.periodo}</TableCell>
                        <TableCell className="text-sm">{m.descripcion}</TableCell>
                        <TableCell className="tabular-nums text-sm text-muted-foreground">
                          {m.vencimiento}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.debe ? formatCurrency(m.debe) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-success">
                          {m.haber ? formatCurrency(m.haber) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              <div className="space-y-3 lg:hidden">
                <div className="text-sm font-medium">Movimientos de la cuenta corriente</div>
                {movimientos.map((m, i) => (
                  <Card key={`${m.periodo}-${m.impuesto}-${m.descripcion}-${i}`} className="space-y-2 p-4 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">{m.descripcion}</div>
                      <span className="tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                        {m.periodo}
                      </span>
                    </div>
                    {m.vencimiento && (
                      <div className="text-xs text-muted-foreground">
                        Vencimiento: <span className="tabular-nums">{m.vencimiento}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-border/50 pt-2">
                      <span className="text-muted-foreground">
                        Debe:{' '}
                        <span className="tabular-nums text-foreground">
                          {m.debe ? formatCurrency(m.debe) : '—'}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        Haber:{' '}
                        <span className="tabular-nums text-success">
                          {m.haber ? formatCurrency(m.haber) : '—'}
                        </span>
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground">
                {(det.deudor ?? 0) > 0
                  ? 'Hay deuda calculada pero sin movimientos detallados en el período.'
                  : 'Sin deuda exigible: la cuenta corriente está al día.'}
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
