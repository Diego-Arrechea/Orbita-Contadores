import { useNavigate, useParams, Link } from 'react-router-dom';
import { ChevronLeft, Upload, Download, FileSpreadsheet, Wallet, Building2, Smartphone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ReconciliacionBancaria } from '@/components/cliente/ReconciliacionBancaria';
import { getCliente } from '@/data/clientes';

const FUENTES = [
  { id: 'mercadopago', label: 'MercadoPago', icon: Smartphone, descripcion: 'Resumen de movimientos exportado desde MercadoPago.', tint: 'bg-warning/15 text-warning-foreground' },
  { id: 'banco',        label: 'Banco',        icon: Building2, descripcion: 'Extracto bancario convertido al formato del sistema.', tint: 'bg-primary/10 text-primary' },
  { id: 'otro',         label: 'Otra fuente',  icon: Wallet,    descripcion: 'Cualquier billetera virtual o cuenta digital adicional.', tint: 'bg-muted text-muted-foreground' },
];

export function Movimientos() {
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

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/clientes/${cliente.id}`)}
          className="-ml-3 mb-3"
        >
          <ChevronLeft className="h-4 w-4" /> Volver al cliente
        </Button>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Movimientos bancarios — {cliente.nombre}
            </h1>
            <p className="text-base text-muted-foreground mt-2">
              Subí los resúmenes para que el sistema los cruce con la facturación emitida en ARCA.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              <Download className="h-4 w-4" /> Descargar planilla modelo
            </Button>
            <Button>
              <Upload className="h-4 w-4" /> Subir nuevo resumen
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {FUENTES.map(f => (
          <Card key={f.id} className="p-5">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${f.tint} mb-3`}>
              <f.icon className="h-4 w-4" />
            </div>
            <div className="font-medium">{f.label}</div>
            <p className="text-sm text-muted-foreground mt-1">{f.descripcion}</p>
            <Button variant="soft" size="sm" className="mt-3">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Cargar archivo
            </Button>
          </Card>
        ))}
      </div>

      <div>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">Acreditaciones cargadas y cruce con facturación</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              El sistema intentó matchear cada acreditación con una factura emitida. Lo no
              matcheado espera tu clasificación.
            </p>
          </div>
          <Badge variant="muted">
            Período: febrero — abril 2026
          </Badge>
        </div>
        <Separator className="mb-4" />
        <ReconciliacionBancaria cliente={cliente} />
      </div>
    </div>
  );
}
