import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Calendar,
  RefreshCcw,
  MoreHorizontal,
  Wallet,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AlertaBadge } from '@/components/shared/AlertaBadge';
import { SituacionActual } from '@/components/cliente/SituacionActual';
import { HistoricoMensual } from '@/components/cliente/HistoricoMensual';
import { ReconciliacionBancaria } from '@/components/cliente/ReconciliacionBancaria';
import { ListaComprobantes } from '@/components/cliente/ListaComprobantes';
import { CausalesList } from '@/components/cliente/CausalesList';
import { NotasContador } from '@/components/cliente/NotasContador';
import { HistorialExtracciones } from '@/components/cliente/HistorialExtracciones';
import { getCliente } from '@/data/clientes';
import { CONFIGURACION_INICIAL } from '@/data/configuracion';
import { calcularCliente } from '@/lib/monotributo';
import { formatCuit, formatDate } from '@/lib/utils';

const tabsListClass =
  'bg-transparent p-0 h-auto rounded-none gap-7 overflow-x-auto scrollbar-thin justify-start';

const tabTriggerClass =
  'data-[state=active]:bg-transparent data-[state=active]:shadow-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground rounded-none px-0 py-3.5 text-muted-foreground hover:text-foreground transition-colors';

export function ClienteDetalle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const cliente = id ? getCliente(id) : undefined;

  if (!cliente) {
    return (
      <div className="text-center py-12">
        <div className="font-medium">Cliente no encontrado</div>
        <Button asChild className="mt-3" variant="outline">
          <Link to="/">Volver al dashboard</Link>
        </Button>
      </div>
    );
  }

  const calc = calcularCliente(
    cliente,
    CONFIGURACION_INICIAL.ventanas,
    CONFIGURACION_INICIAL.margenInflacionProyeccion,
  );

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('/')}
        className="-ml-3 -mb-2 text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Volver al dashboard
      </Button>

      <Tabs defaultValue="situacion" className="space-y-5">
        <Card className="overflow-hidden p-0 border-primary/15">
          <div
            className="p-7 relative"
            style={{
              background:
                'linear-gradient(135deg, hsl(var(--primary) / 0.16) 0%, hsl(var(--accent) / 0.6) 38%, hsl(var(--card)) 100%)',
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent, hsl(var(--primary) / 0.5), transparent)',
              }}
            />
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-5">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-xl font-semibold shrink-0 shadow-md">
                  {cliente.nombre
                    .split(' ')
                    .map(p => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-2xl font-semibold tracking-tight">{cliente.nombre}</h1>
                    <Badge variant="outline" className="font-semibold bg-card/70">
                      Cat. {cliente.categoria}
                    </Badge>
                    <Badge variant="muted" className="capitalize bg-card/70">
                      {cliente.tipoActividad}
                    </Badge>
                    <AlertaBadge estado={cliente.estadoAlerta} />
                  </div>
                  <div className="mt-2.5 flex items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground flex-wrap">
                    <span className="tabular-nums">CUIT {formatCuit(cliente.cuit)}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      Inicio actividades {formatDate(cliente.fechaInicio, 'long')}
                    </span>
                    {cliente.ultimaExtraccion && (
                      <span className="inline-flex items-center gap-1.5">
                        <RefreshCcw className="h-3.5 w-3.5" />
                        Última sync {formatDate(cliente.ultimaExtraccion)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="bg-card/70 backdrop-blur">
                  <RefreshCcw className="h-3.5 w-3.5" /> Sincronizar ahora
                </Button>
                <Button variant="outline" size="sm" className="bg-card/70 backdrop-blur" asChild>
                  <Link to={`/clientes/${cliente.id}/movimientos`}>
                    <Wallet className="h-3.5 w-3.5" /> Movimientos
                  </Link>
                </Button>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {cliente.resultadoUltimaExtraccion === 'fallida' &&
              cliente.motivoFalloUltimaExtraccion && (
                <div className="mt-5 rounded-lg bg-danger/12 border border-danger/25 px-4 py-2.5 text-sm">
                  <span className="text-danger font-medium">
                    Última sincronización falló:
                  </span>
                  <span className="text-foreground/80 ml-2">
                    {cliente.motivoFalloUltimaExtraccion}
                  </span>
                </div>
              )}
          </div>

          <div className="border-t border-border/60 bg-card/70 px-7">
            <TabsList className={tabsListClass}>
              <TabsTrigger value="situacion" className={tabTriggerClass}>Situación actual</TabsTrigger>
              <TabsTrigger value="historico" className={tabTriggerClass}>Histórico mensual</TabsTrigger>
              <TabsTrigger value="reconciliacion" className={tabTriggerClass}>Reconciliación bancaria</TabsTrigger>
              <TabsTrigger value="comprobantes" className={tabTriggerClass}>Comprobantes</TabsTrigger>
              <TabsTrigger value="causales" className={tabTriggerClass}>Causales de exclusión</TabsTrigger>
              <TabsTrigger value="notas" className={tabTriggerClass}>Notas y extracciones</TabsTrigger>
            </TabsList>
          </div>
        </Card>

        <TabsContent value="situacion" className="mt-0">
          <SituacionActual cliente={cliente} calc={calc} />
        </TabsContent>
        <TabsContent value="historico" className="mt-0">
          <HistoricoMensual cliente={cliente} />
        </TabsContent>
        <TabsContent value="reconciliacion" className="mt-0">
          <ReconciliacionBancaria cliente={cliente} />
        </TabsContent>
        <TabsContent value="comprobantes" className="mt-0">
          <ListaComprobantes cliente={cliente} />
        </TabsContent>
        <TabsContent value="causales" className="mt-0">
          <CausalesList cliente={cliente} />
        </TabsContent>
        <TabsContent value="notas" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-2">
            <NotasContador cliente={cliente} />
            <HistorialExtracciones cliente={cliente} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
