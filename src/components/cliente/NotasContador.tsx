import { useState } from 'react';
import { Save, History } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { Cliente } from '@/types';

interface Props {
  cliente: Cliente;
}

export function NotasContador({ cliente }: Props) {
  const [valor, setValor] = useState(cliente.notas);
  const [guardado, setGuardado] = useState(true);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-base font-semibold">Notas del contador</div>
          <p className="text-sm text-muted-foreground">
            Campo libre, sólo visible para vos. El cliente nunca ve estas notas.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="h-3 w-3" /> Última edición: hace 12 días
        </div>
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
        <span className="text-xs text-muted-foreground">
          {guardado ? 'Cambios guardados' : 'Cambios sin guardar'}
        </span>
        <Button
          size="sm"
          onClick={() => setGuardado(true)}
          disabled={guardado}
        >
          <Save className="h-3.5 w-3.5" /> Guardar notas
        </Button>
      </div>
    </Card>
  );
}
