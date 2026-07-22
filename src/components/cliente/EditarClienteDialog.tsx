import { useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, Wheat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';
import { editarCliente, type CamposEdicion } from '@/services/clientesService';
import { mensajeDeError } from '@/services/authService';
import { esMonotributista } from '@/lib/regimen';
import type { Cliente, CategoriaCodigo, TipoActividad } from '@/types';

const CATEGORIAS: CategoriaCodigo[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

export function EditarClienteDialog({
  cliente,
  onGuardado,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  cliente: Cliente;
  onGuardado: () => void;
  /** Opcional: si se omite, el diálogo se abre con su propio trigger. */
  trigger?: ReactNode;
  /** Open controlado (p. ej. desde un menú). Si se pasa, el trigger es opcional. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openInterno, setOpenInterno] = useState(false);
  const open = openProp ?? openInterno;
  const setOpen = onOpenChange ?? setOpenInterno;
  const [nombre, setNombre] = useState(cliente.nombre);
  const [cuit, setCuit] = useState(cliente.cuit);
  const [categoria, setCategoria] = useState<CategoriaCodigo | null>(cliente.categoria);
  const [tipoActividad, setTipoActividad] = useState<TipoActividad>(cliente.tipoActividad);
  const [fechaInicio, setFechaInicio] = useState((cliente.fechaInicio ?? '').slice(0, 10));
  const [estadoCuota, setEstadoCuota] = useState<Cliente['estadoCuotaMesActual']>(
    cliente.estadoCuotaMesActual,
  );
  const [notas, setNotas] = useState(cliente.notas ?? '');
  const [relacionDependencia, setRelacionDependencia] = useState(cliente.relacionDependencia);
  const [facturaAgro, setFacturaAgro] = useState(cliente.facturaAgro ?? false);
  const [emailCliente, setEmailCliente] = useState(cliente.emailCliente ?? '');
  const [telefonoCliente, setTelefonoCliente] = useState(cliente.telefonoCliente ?? '');
  // Recordatorio de vencimiento: incluido salvo que el contador lo excluya (venc_avisos === false).
  const [vencAvisos, setVencAvisos] = useState(cliente.vencAvisos !== false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const esReal = cliente.fuente === 'arca';
  const noMono = !esMonotributista(cliente);

  const guardar = async () => {
    const campos: CamposEdicion = {
      nombre: nombre.trim(),
      categoria,
      tipoActividad,
      fechaInicio,
      estadoCuotaMesActual: estadoCuota,
      notas,
      relacionDependencia,
      facturaAgro,
      emailCliente: emailCliente.trim(),
      telefonoCliente: telefonoCliente.trim(),
      vencAvisos,
    };
    // Los clientes de ejemplo no se persisten en la cuenta (no existen en el backend).
    if (!esReal) {
      setOpen(false);
      onGuardado();
      return;
    }
    setGuardando(true);
    setError('');
    try {
      await editarCliente(cliente.cuit, campos);
      setOpen(false);
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cliente</DialogTitle>
          <DialogDescription>
            Cambiá los datos del cliente. Lo derivado (comprobantes, alertas) se recalcula solo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="ed-nombre">Nombre / Razón social</Label>
            <Input id="ed-nombre" value={nombre} onChange={e => setNombre(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ed-cuit">CUIT</Label>
              <Input
                id="ed-cuit"
                value={cuit}
                onChange={e => setCuit(e.target.value)}
                disabled={esReal}
                title={esReal ? 'Es la identidad del cliente en ARCA; no se edita' : undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-fecha">Datos desde</Label>
              <Input
                id="ed-fecha"
                type="date"
                value={fechaInicio}
                onChange={e => setFechaInicio(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              {noMono ? (
                <div className="h-9 flex items-center text-sm text-muted-foreground">
                  No aplica (no es monotributista)
                </div>
              ) : (
                <Select
                  value={categoria ?? undefined}
                  onValueChange={v => setCategoria(v as CategoriaCodigo)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS.map(c => (
                      <SelectItem key={c} value={c}>
                        Categoría {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Actividad</Label>
              <Select value={tipoActividad} onValueChange={v => setTipoActividad(v as TipoActividad)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comercio">Comercio</SelectItem>
                  <SelectItem value="servicios">Servicios</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Cuota del mes</Label>
            <Select
              value={estadoCuota}
              onValueChange={v => setEstadoCuota(v as Cliente['estadoCuotaMesActual'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="al-dia">Al día</SelectItem>
                <SelectItem value="con-deuda">Con deuda</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Relación de dependencia</Label>
            <Select
              value={relacionDependencia ? 'si' : 'no'}
              onValueChange={v => setRelacionDependencia(v === 'si')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No tiene</SelectItem>
                <SelectItem value="si">Sí, tiene trabajo en relación de dependencia</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Si además trabaja en relación de dependencia, parte de sus compras pueden quedar
              justificadas por el sueldo percibido.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 p-3">
            <button
              type="button"
              onClick={() => setFacturaAgro(v => !v)}
              className="flex items-start gap-2.5 text-left w-full"
            >
              {facturaAgro ? (
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
              )}
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Wheat className="h-3.5 w-3.5 text-primary" />
                  Es del sector agropecuario
                </span>
                <span className="block text-xs text-muted-foreground leading-relaxed mt-0.5">
                  Productor del agro (hacienda, campo, etc.): sumamos su facturación del sector a la
                  del cliente. Se actualiza sola.
                </span>
              </span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ed-email-cli">Email del cliente</Label>
              <Input
                id="ed-email-cli"
                type="email"
                placeholder="opcional"
                value={emailCliente}
                onChange={e => setEmailCliente(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-tel-cli">Teléfono del cliente</Label>
              <Input
                id="ed-tel-cli"
                type="tel"
                placeholder="opcional"
                value={telefonoCliente}
                onChange={e => setTelefonoCliente(e.target.value)}
              />
            </div>
          </div>
          <p className="-mt-1.5 text-xs text-muted-foreground">
            Con el email cargado le enviamos a tu cliente el recordatorio de sus próximos
            vencimientos.
          </p>

          <div className="space-y-1.5">
            <Label>Recordatorios de vencimiento</Label>
            <Select value={vencAvisos ? 'si' : 'no'} onValueChange={v => setVencAvisos(v === 'si')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="si">Enviárselos a este cliente</SelectItem>
                <SelectItem value="no">No enviárselos a este cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-notas">Notas</Label>
            <Textarea id="ed-notas" value={notas} onChange={e => setNotas(e.target.value)} rows={3} />
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancelar</Button>
          </DialogClose>
          <Button onClick={guardar} disabled={!nombre.trim() || guardando}>
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
