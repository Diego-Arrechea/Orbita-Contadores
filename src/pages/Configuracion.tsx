import { useState } from 'react';
import { Save, Calendar, Sliders, Percent, Database, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CATEGORIAS } from '@/data/categorias';
import { CONFIGURACION_INICIAL } from '@/data/configuracion';
import { CAUSALES_EXCLUSION } from '@/data/causales';
import { formatCurrency } from '@/lib/utils';

export function Configuracion() {
  const [conf, setConf] = useState(CONFIGURACION_INICIAL);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-base text-muted-foreground mt-2">
          Editá las ventanas de recategorización, los umbrales y los topes vigentes. Los cambios
          aplican a todos los clientes.
        </p>
      </div>

      <Tabs defaultValue="ventanas">
        <TabsList>
          <TabsTrigger value="ventanas"><Calendar className="h-3.5 w-3.5" />Ventanas</TabsTrigger>
          <TabsTrigger value="umbrales"><Sliders className="h-3.5 w-3.5" />Umbrales</TabsTrigger>
          <TabsTrigger value="categorias"><Database className="h-3.5 w-3.5" />Categorías</TabsTrigger>
          <TabsTrigger value="causales"><Info className="h-3.5 w-3.5" />Causales</TabsTrigger>
        </TabsList>

        <TabsContent value="ventanas">
          <Card className="p-6">
            <div className="text-base font-semibold mb-1">Ventanas de recategorización</div>
            <p className="text-sm text-muted-foreground mb-5">
              ARCA puede prorrogar estas fechas. Si publican una prórroga, actualizá manualmente
              acá para que las alertas no se calculen sobre fechas vencidas.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              {conf.ventanas.map((v, i) => (
                <div key={i} className="rounded-xl border border-border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="muted">{v.semestre}</Badge>
                  </div>
                  <div className="grid gap-3">
                    <div className="space-y-1.5">
                      <Label>Fecha límite recategorización</Label>
                      <Input
                        type="date"
                        defaultValue={v.fechaLimite}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Efecto desde</Label>
                      <Input
                        type="date"
                        defaultValue={v.efectoDesde}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-5">
              <Button>
                <Save className="h-4 w-4" /> Guardar fechas
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="umbrales">
          <Card className="p-6">
            <div className="text-base font-semibold mb-1">Umbrales de alerta</div>
            <p className="text-sm text-muted-foreground mb-5">
              Configurá cuándo el sistema marca un cliente en amarillo o en rojo. Los cambios se
              aplican al recalcular las próximas alertas.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <CampoNumero
                icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                label="% del tope para pasar a amarillo"
                hint="Cuando el cliente consume este porcentaje de su categoría actual."
                value={conf.umbralAmarilloPorcentaje * 100}
                sufijo="%"
                onChange={(v) => setConf({ ...conf, umbralAmarilloPorcentaje: v / 100 })}
              />
              <CampoNumero
                icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                label="% del umbral legal de ratio para amarillo"
                hint="Por encima de este porcentaje del umbral 80%/40% se prende alerta."
                value={conf.umbralRatioGastosAmarillo * 100}
                sufijo="%"
                onChange={(v) => setConf({ ...conf, umbralRatioGastosAmarillo: v / 100 })}
              />
              <CampoNumero
                icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
                label="Días antes de ventana → amarillo"
                value={conf.umbralAmarilloDias}
                sufijo="días"
                onChange={(v) => setConf({ ...conf, umbralAmarilloDias: v })}
              />
              <CampoNumero
                icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
                label="Días antes de ventana → rojo"
                value={conf.umbralRojoDias}
                sufijo="días"
                onChange={(v) => setConf({ ...conf, umbralRojoDias: v })}
              />
              <CampoNumero
                icon={<Percent className="h-4 w-4 text-muted-foreground" />}
                label="Margen conservador de inflación"
                hint="Se resta al IPC para proyectar más conservador. Maximiliano sugirió −5%."
                value={conf.margenInflacionProyeccion * 100}
                sufijo="%"
                onChange={(v) => setConf({ ...conf, margenInflacionProyeccion: v / 100 })}
              />
            </div>
            <div className="flex justify-end mt-5">
              <Button>
                <Save className="h-4 w-4" /> Guardar umbrales
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="categorias">
          <Card className="overflow-hidden">
            <div className="p-5 border-b border-border/60">
              <div className="text-base font-semibold">Categorías y topes vigentes</div>
              <p className="text-sm text-muted-foreground">
                ARCA actualiza estos valores en enero y julio. Pegá los nuevos cuando se publiquen
                en el Boletín Oficial.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cat.</TableHead>
                  <TableHead className="text-right">Tope facturación anual</TableHead>
                  <TableHead className="text-right">Cuota servicios</TableHead>
                  <TableHead className="text-right">Cuota comercio</TableHead>
                  <TableHead className="text-right">Superficie máx.</TableHead>
                  <TableHead className="text-right">Energía máx.</TableHead>
                  <TableHead className="text-right">Tope precio unit.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CATEGORIAS.map(c => (
                  <TableRow key={c.codigo}>
                    <TableCell>
                      <Badge variant="outline" className="font-semibold">{c.codigo}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(c.topeAnual)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(c.cuotaServicios)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(c.cuotaComercio)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.superficieMax} m²</TableCell>
                    <TableCell className="text-right tabular-nums">{c.energiaMaxKwh.toLocaleString('es-AR')} kWh</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.topePrecioUnitario ? formatCurrency(c.topePrecioUnitario) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Separator />
            <div className="p-4 flex justify-end gap-2">
              <Button variant="outline">Importar desde Excel</Button>
              <Button>
                <Save className="h-4 w-4" /> Guardar tabla
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="causales">
          <Card className="overflow-hidden">
            <div className="p-5 border-b border-border/60">
              <div className="text-base font-semibold">Causales de exclusión disponibles</div>
              <p className="text-sm text-muted-foreground">
                Listado base que se aplica a cada cliente. La activación final de cada causal se
                hace en el detalle de cada cliente.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Seguimiento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CAUSALES_EXCLUSION.map((c, i) => (
                  <TableRow key={c.codigo}>
                    <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="text-sm">{c.descripcion}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.modo === 'auto'
                            ? 'success'
                            : c.modo === 'parcial'
                              ? 'warning'
                              : 'muted'
                        }
                      >
                        {c.modo === 'auto'
                          ? 'Automático'
                          : c.modo === 'parcial'
                            ? 'Parcial'
                            : 'Manual'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface CampoNumeroProps {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  value: number;
  sufijo: string;
  onChange: (v: number) => void;
}

function CampoNumero({ icon, label, hint, value, sufijo, onChange }: CampoNumeroProps) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      <div className="relative">
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="pr-12"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {sufijo}
        </span>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
