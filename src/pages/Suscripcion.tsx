/**
 * "Mi suscripción": el plan del estudio, hasta cuándo está al día, cuánto de la cartera usa y el
 * historial de pagos. Sólo lectura (los cambios de plan y los cobros los carga el equipo de Órbita
 * desde el panel).
 *
 * OJO — todavía NO está abierto a los contadores: la pantalla la ven sólo los admins y las sesiones
 * impersonadas por un admin (así se puede revisar cómo la vería el contador antes de habilitarla).
 * El gate vive en RequireSuscripcion (front) y en usuario_puede_suscripcion (backend). Los usuarios
 * del estudio nunca la ven: la suscripción es del titular.
 */
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crisp } from 'crisp-sdk-web';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Check,
  CreditCard,
  EyeOff,
  Loader2,
  MessageCircle,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { impersonando } from '@/lib/cuenta';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import {
  ESTADO_SUSCRIPCION_META,
  obtenerCatalogo,
  obtenerMiSuscripcion,
  type CatalogoPlanes,
  type MiSuscripcion,
  type PagoSuscripcion,
} from '@/services/suscripcionService';

const MEDIO_LABEL: Record<string, string> = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  mercadopago: 'Mercado Pago',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

/** Abre el chat de soporte; si el widget no está disponible, cae en un correo. */
function escribirle() {
  try {
    Crisp.chat.open();
  } catch {
    window.location.href = 'mailto:orbitaglobalclientes@gmail.com?subject=Mi%20suscripci%C3%B3n';
  }
}

/** Frase de estado, en criollo, para el encabezado de la tarjeta principal. */
function leyendaEstado(s: MiSuscripcion): string {
  const dias = s.dias_restantes;
  if (s.estado === 'sin_cargo') return 'Tu cuenta no tiene cargo por ahora.';
  if (s.estado === 'cancelada') return 'La suscripción está dada de baja.';
  if (s.estado === 'vencida') return 'Tenés un período pendiente de pago.';
  if (!s.vence) return 'Sin fecha de renovación.';
  const cuando = formatDate(s.vence, 'long');
  if (dias !== null && dias !== undefined && dias <= 10 && dias >= 0) {
    return `Se renueva el ${cuando} (en ${dias} ${dias === 1 ? 'día' : 'días'}).`;
  }
  return s.estado === 'prueba' ? `Tu prueba va hasta el ${cuando}.` : `Al día hasta el ${cuando}.`;
}

function FilaDato({
  icono: Icono,
  titulo,
  valor,
  detalle,
}: {
  icono: typeof CreditCard;
  titulo: string;
  valor: string;
  detalle?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 rounded-lg bg-muted p-2">
        <Icono className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
        <p className="text-base font-semibold tracking-tight">{valor}</p>
        {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
      </div>
    </div>
  );
}

/** Tilde o cruz de un cruce plan × función. */
function Marca({ incluido }: { incluido: boolean }) {
  return incluido ? (
    <span title="Incluido">
      <Check className="mx-auto h-4 w-4 text-success" />
      <span className="sr-only">Incluido</span>
    </span>
  ) : (
    <span title="No incluido">
      <X className="mx-auto h-4 w-4 text-muted-foreground/50" />
      <span className="sr-only">No incluido</span>
    </span>
  );
}

/** El tope de clientes de un plan, en texto (no es una función que esté o no esté). */
function tope(limite: number | null | undefined): string {
  return limite ? `Hasta ${limite}` : 'Sin tope';
}

/**
 * Comparativa de planes: una fila por función y una columna por plan, con tilde donde entra y cruz
 * donde no. Así la diferencia entre planes se ve de un vistazo, sin leer tres listas casi iguales.
 * En mobile la matriz no entra: se vuelca a una tarjeta por plan, con la misma marca por función.
 */
function ComparativaPlanes({
  catalogo,
  planActual,
}: {
  catalogo: CatalogoPlanes;
  planActual: string;
}) {
  const { planes, funciones } = catalogo;

  // Agrupa las funciones respetando el orden en que las manda el backend.
  const grupos: { grupo: string; items: typeof funciones }[] = [];
  for (const f of funciones) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.grupo === f.grupo) ultimo.items.push(f);
    else grupos.push({ grupo: f.grupo, items: [f] });
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold tracking-tight">Planes</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Qué entra en cada uno. Podés cambiar de plan cuando quieras: escribinos y lo ajustamos en
        el día.
      </p>

      {/* Escritorio: matriz plan × función */}
      <div className="mt-5 hidden overflow-x-auto lg:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-[46%] pb-4 text-left align-bottom text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Qué incluye
              </th>
              {planes.map(p => {
                const actual = p.clave === planActual;
                return (
                  <th
                    key={p.clave}
                    className={cn(
                      'px-3 pb-4 pt-1 text-center align-bottom',
                      actual && 'rounded-t-xl bg-primary/5'
                    )}
                  >
                    <span className="block font-semibold tracking-tight">{p.nombre}</span>
                    <span className="mt-0.5 block text-lg font-semibold tabular-nums">
                      {formatCurrency(p.precio)}
                    </span>
                    <span className="block text-xs font-normal text-muted-foreground">por mes</span>
                    {actual && (
                      <Badge variant="default" className="mt-1.5">
                        Tu plan
                      </Badge>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grupos.map(({ grupo, items }) => (
              <Fragment key={grupo}>
                <tr>
                  <td
                    colSpan={planes.length + 1}
                    className="pb-1 pt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {grupo}
                  </td>
                </tr>
                {items.map(f => (
                  <tr key={f.clave} className="border-t border-border">
                    <td className="py-2.5 pr-6 leading-snug">{f.nombre}</td>
                    {planes.map(p => (
                      <td
                        key={p.clave}
                        className={cn(
                          'px-3 py-2.5 text-center',
                          p.clave === planActual && 'bg-primary/5'
                        )}
                      >
                        <Marca incluido={p.funciones.includes(f.clave)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="border-t border-border">
              <td className="py-2.5 pr-6 leading-snug">Clientes que podés cargar</td>
              {planes.map(p => (
                <td
                  key={p.clave}
                  className={cn(
                    'px-3 py-2.5 text-center text-muted-foreground',
                    p.clave === planActual && 'rounded-b-xl bg-primary/5'
                  )}
                >
                  {tope(p.limite_clientes)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile: una tarjeta por plan con la misma marca por función */}
      <div className="mt-5 space-y-3 lg:hidden">
        {planes.map(p => {
          const actual = p.clave === planActual;
          return (
            <div
              key={p.clave}
              className={cn(
                'rounded-xl border p-4',
                actual ? 'border-primary bg-primary/5' : 'border-border'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold tracking-tight">{p.nombre}</p>
                  <p className="text-xs text-muted-foreground">{tope(p.limite_clientes)} clientes</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">{formatCurrency(p.precio)}</p>
                  <p className="text-xs text-muted-foreground">por mes</p>
                </div>
              </div>
              {actual && (
                <Badge variant="default" className="mt-2 gap-1">
                  <Check className="h-3 w-3" /> Tu plan
                </Badge>
              )}
              <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                {funciones.map(f => {
                  const incluido = p.funciones.includes(f.clave);
                  return (
                    <li
                      key={f.clave}
                      className={cn(
                        'flex items-start gap-2 text-sm leading-snug',
                        !incluido && 'text-muted-foreground/70'
                      )}
                    >
                      {incluido ? (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      ) : (
                        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                      )}
                      <span>{f.nombre}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Precios de referencia sin IVA. Tu cuenta puede tener condiciones acordadas aparte.
      </p>
    </Card>
  );
}

function HistorialPagos({ pagos }: { pagos: PagoSuscripcion[] }) {
  const [verTodos, setVerTodos] = useState(false);
  const visibles = verTodos ? pagos : pagos.slice(0, 6);

  if (pagos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no hay pagos registrados en tu cuenta.
      </p>
    );
  }

  return (
    <>
      {/* Escritorio: tabla */}
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Medio</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead className="text-right">Importe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map(p => (
              <TableRow key={p.id}>
                <TableCell className="tabular-nums">{formatDate(p.fecha)}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {p.periodo_desde && p.periodo_hasta
                    ? `${formatDate(p.periodo_desde)} → ${formatDate(p.periodo_hasta)}`
                    : '—'}
                </TableCell>
                <TableCell>{MEDIO_LABEL[p.medio] ?? p.medio}</TableCell>
                <TableCell className="text-muted-foreground">{p.referencia || '—'}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCurrency(p.importe)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: tarjetas */}
      <ul className="space-y-2.5 lg:hidden">
        {visibles.map(p => (
          <li key={p.id} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium tabular-nums">{formatDate(p.fecha)}</span>
              <span className="text-sm font-semibold tabular-nums">
                {formatCurrency(p.importe)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {MEDIO_LABEL[p.medio] ?? p.medio}
              {p.periodo_desde && p.periodo_hasta
                ? ` · ${formatDate(p.periodo_desde)} → ${formatDate(p.periodo_hasta)}`
                : ''}
              {p.referencia ? ` · ${p.referencia}` : ''}
            </p>
          </li>
        ))}
      </ul>

      {pagos.length > 6 && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setVerTodos(v => !v)}>
          {verTodos ? 'Ver menos' : `Ver los ${pagos.length} pagos`}
        </Button>
      )}
    </>
  );
}

export function Suscripcion() {
  const { data: sus, isLoading, error } = useQuery({
    queryKey: ['suscripcion'],
    queryFn: obtenerMiSuscripcion,
  });
  const { data: catalogo } = useQuery({ queryKey: ['planes'], queryFn: obtenerCatalogo });
  const quienImpersona = impersonando();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando tu suscripción…
      </div>
    );
  }

  if (error || !sus) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          No pudimos mostrar tu suscripción en este momento. Probá de nuevo en un rato.
        </p>
      </Card>
    );
  }

  const meta = ESTADO_SUSCRIPCION_META[sus.estado];
  const tope = sus.limite_clientes ?? null;
  const usoPct = tope ? Math.min(100, Math.round((sus.clientes_en_uso / tope) * 100)) : 0;
  const cerca = tope !== null && sus.clientes_en_uso >= tope * 0.8;
  const porVencer =
    sus.dias_restantes !== null && sus.dias_restantes !== undefined && sus.dias_restantes <= 10;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl xl:text-4xl font-semibold tracking-tight">Mi suscripción</h1>
        <p className="text-base text-muted-foreground mt-2">
          Tu plan, el estado de la cuenta y los pagos registrados.
        </p>
      </div>

      {/* Recordatorio de que el apartado todavía no está abierto: sólo lo ve el equipo de Órbita
          (y, mientras dura una impersonación, la pantalla del contador tal como la vería él). */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground">
        <EyeOff className="h-4 w-4 shrink-0" />
        {quienImpersona
          ? 'Vista interna: así vería el contador este apartado. Todavía no lo tiene disponible.'
          : 'Apartado interno: los contadores todavía no ven esta pantalla.'}
      </div>

      {/* Aviso cuando hay algo para hacer */}
      {(sus.estado === 'vencida' || (sus.estado === 'activa' && porVencer)) && (
        <Card
          className={cn(
            'flex flex-wrap items-center gap-3 p-4',
            sus.estado === 'vencida' ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'
          )}
        >
          <AlertTriangle
            className={cn(
              'h-5 w-5 shrink-0',
              sus.estado === 'vencida' ? 'text-danger' : 'text-warning-foreground'
            )}
          />
          <p className="text-sm flex-1 min-w-[220px]">
            {sus.estado === 'vencida'
              ? 'Tenés un período pendiente de pago. Escribinos y lo regularizamos.'
              : `Tu suscripción se renueva el ${formatDate(sus.vence!, 'long')}.`}
          </p>
          <Button size="sm" variant="outline" onClick={escribirle}>
            <MessageCircle className="mr-1.5 h-4 w-4" /> Escribinos
          </Button>
        </Card>
      )}

      {/* Plan actual */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Plan {sus.plan_nombre}</h2>
              <Badge variant={meta.tono}>{meta.label}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{sus.plan_descripcion}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {sus.precio > 0 ? formatCurrency(sus.precio) : 'Sin cargo'}
            </p>
            {sus.precio > 0 && (
              <p className="text-xs text-muted-foreground">
                por {sus.ciclo === 'anual' ? 'año' : 'mes'}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FilaDato
            icono={CalendarClock}
            titulo="Estado"
            valor={meta.label}
            detalle={leyendaEstado(sus)}
          />
          <FilaDato
            icono={CreditCard}
            titulo="Facturación"
            valor={sus.ciclo === 'anual' ? 'Anual' : 'Mensual'}
            detalle={sus.inicio ? `Cliente desde el ${formatDate(sus.inicio)}` : undefined}
          />
          <FilaDato
            icono={Users}
            titulo="Clientes"
            valor={tope ? `${sus.clientes_en_uso} de ${tope}` : `${sus.clientes_en_uso}`}
            detalle={tope ? undefined : 'Sin tope en tu plan'}
          />
        </div>

        {tope !== null && (
          <div className="mt-5">
            <Progress
              value={usoPct}
              indicatorClassName={cerca ? 'bg-warning' : undefined}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {cerca
                ? `Estás usando el ${usoPct}% de tu plan. Si necesitás más lugar, escribinos y lo ampliamos.`
                : `Estás usando el ${usoPct}% de tu plan.`}
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={escribirle}>
            <MessageCircle className="mr-1.5 h-4 w-4" /> Cambiar de plan
          </Button>
          <Button variant="ghost" size="sm" onClick={escribirle}>
            Consultar por facturación <ArrowUpRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </Card>

      {catalogo && <ComparativaPlanes catalogo={catalogo} planActual={sus.plan} />}

      {/* Pagos */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold tracking-tight">Pagos</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Los pagos que registramos en tu cuenta.
        </p>
        <HistorialPagos pagos={sus.pagos} />
      </Card>
    </div>
  );
}
