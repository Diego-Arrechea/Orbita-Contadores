import { useState } from 'react';
import { FileText, Search, Package, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatDate, formatCuit, cn } from '@/lib/utils';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
}

export function ListaComprobantes({ cliente }: Props) {
  const [direccion, setDireccion] = useState<'todos' | 'emitido' | 'recibido'>('todos');
  const [busqueda, setBusqueda] = useState('');

  const comprobantes = cliente.comprobantes
    .filter(c => (direccion === 'todos' ? true : c.direccion === direccion))
    .filter(c => {
      if (!busqueda) return true;
      const q = busqueda.toLowerCase();
      return (
        c.contraparteNombre.toLowerCase().includes(q) ||
        c.numero.includes(busqueda) ||
        c.contraparteCuit.includes(busqueda.replace(/\D/g, ''))
      );
    })
    .sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col md:flex-row gap-3 p-4 border-b border-border/60 bg-muted/20">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por número, contraparte o CUIT"
            className="pl-9 bg-card"
          />
        </div>
        <Select value={direccion} onValueChange={(v) => setDireccion(v as typeof direccion)}>
          <SelectTrigger className="w-[180px] bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="emitido">Emitidos</SelectItem>
            <SelectItem value="recibido">Recibidos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[44px]" />
            <TableHead>Tipo</TableHead>
            <TableHead>Fecha emisión</TableHead>
            <TableHead>Período devengado</TableHead>
            <TableHead>Punto / N°</TableHead>
            <TableHead>Contraparte</TableHead>
            <TableHead className="text-right">Monto</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {comprobantes.map(c => {
            const esNC = c.tipo.startsWith('Nota Crédito');
            const periodoDiferente = c.periodoDevengado && c.periodoDevengado !== c.fechaEmision.slice(0, 7);
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg',
                      c.direccion === 'emitido'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <FileText className="h-4 w-4" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm font-medium leading-tight">{c.tipo}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <span>{c.direccion === 'emitido' ? 'Emitido' : 'Recibido'}</span>
                    {c.esBienPatrimonial && (
                      <Badge variant="muted" className="text-[10px] py-0">
                        <Package className="h-3 w-3" /> Patrimonial
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {formatDate(c.fechaEmision)}
                </TableCell>
                <TableCell className="text-sm">
                  {periodoDiferente ? (
                    <Badge variant="warning" className="text-[10px]">
                      {c.periodoDevengado}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground tabular-nums">
                      {c.fechaEmision.slice(0, 7)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm tabular-nums whitespace-nowrap">
                  {c.puntoVenta.toString().padStart(5, '0')}-{c.numero}
                </TableCell>
                <TableCell>
                  <div className="text-sm">{c.contraparteNombre}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {formatCuit(c.contraparteCuit)}
                  </div>
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums font-medium whitespace-nowrap',
                    esNC && 'text-danger',
                  )}
                >
                  {esNC ? '-' : ''}
                  {formatCurrency(c.monto)}
                </TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" title="Ver PDF">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
