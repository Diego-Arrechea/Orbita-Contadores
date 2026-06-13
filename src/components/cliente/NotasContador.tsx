import { useState } from 'react';
import { Save } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { editarCliente } from '@/services/clientesService';
import { mensajeDeError } from '@/services/authService';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
}

export function NotasContador({ cliente }: Props) {
  const [valor, setValor] = useState(cliente.notas);
  const [guardado, setGuardado] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const esReal = cliente.fuente === 'arca';

  async function guardar() {
    // Los clientes de ejemplo no se persisten en la cuenta (no existen en el backend).
    if (!esReal) {
      setGuardado(true);
      return;
    }
    setGuardando(true);
    setError('');
    try {
      await editarCliente(cliente.cuit, { notas: valor });
      setGuardado(true);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-3">
        <div className="text-base font-semibold">Notas del contador</div>
        <p className="text-sm text-muted-foreground">
          Campo libre, sólo visible para vos. El cliente nunca ve estas notas.
        </p>
      </div>
      <Textarea
        value={valor}
        onChange={(e) => {
          setValor(e.target.value);
          setGuardado(false);
        }}
        rows={6}
        placeholder="Anotaciones, recordatorios, conversaciones con el cliente..."
        className="bg-background"
      />
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : (
            <span className="text-muted-foreground">
              {guardado ? 'Cambios guardados' : 'Cambios sin guardar'}
            </span>
          )}
        </span>
        <Button size="sm" onClick={guardar} disabled={guardado || guardando}>
          <Save className="h-3.5 w-3.5" /> {guardando ? 'Guardando…' : 'Guardar notas'}
        </Button>
      </div>
    </Card>
  );
}
