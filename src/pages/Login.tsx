import { useNavigate } from 'react-router-dom';
import { Orbit, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function Login() {
  const navigate = useNavigate();
  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-gradient-to-br from-background via-accent/40 to-background">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mr-3">
            <Orbit className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-semibold leading-none">Órbita</div>
            <div className="text-sm text-muted-foreground">Contador</div>
          </div>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl shadow-sm p-8">
          <h1 className="text-xl font-semibold mb-1">Ingresar al estudio</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Monitoreá tus clientes monotributistas en un solo lugar.
          </p>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                placeholder="felipe@estudiodurso.com.ar"
                defaultValue="felipe@estudiodurso.com.ar"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <a className="text-xs text-primary hover:underline" href="#">
                  ¿Olvidaste tu contraseña?
                </a>
              </div>
              <Input id="password" type="password" defaultValue="••••••••" />
            </div>

            <Button type="submit" className="w-full" size="lg">
              Entrar al dashboard
            </Button>

            <div className="flex items-start gap-2 mt-6 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Las claves fiscales de tus clientes viajan cifradas y nunca se muestran en ninguna
                pantalla del sistema.
              </span>
            </div>
          </form>
        </div>

        <div className="text-center text-xs text-muted-foreground mt-6">
          Versión prototipo · Datos de ejemplo · No conectado a ARCA todavía
        </div>
      </div>
    </div>
  );
}
