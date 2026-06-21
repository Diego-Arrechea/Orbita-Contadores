import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Orbit, ShieldCheck, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { login, mensajeDeError } from '@/services/authService';
import { iniciarSesion } from '@/lib/cuenta';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  // Aviso de éxito al volver desde el restablecimiento de contraseña (ver Recuperar.tsx).
  const aviso = (location.state as { aviso?: string } | null)?.aviso;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    if (cargando) return;
    setError(null);
    setCargando(true);
    try {
      const auth = await login(email.trim(), password);
      iniciarSesion(auth);
      navigate('/');
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  }

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

        <div className="bg-card border border-border/60 rounded-2xl shadow-sm p-6 sm:p-8">
          <h1 className="text-xl font-semibold mb-1">Ingresar al estudio</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Monitoreá tus clientes monotributistas en un solo lugar.
          </p>

          {aviso && (
            <div className="rounded-lg bg-success/10 border border-success/25 px-3.5 py-2.5 text-sm flex items-start gap-2 mb-4">
              <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
              <span className="text-foreground/80">{aviso}</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={entrar}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="tucorreo@estudio.com.ar"
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <Link className="text-xs text-primary hover:underline" to="/recuperar">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                  setError(null);
                }}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-danger/10 border border-danger/25 px-3.5 py-2.5 text-sm flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                <span className="text-foreground/80">{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={cargando}>
              {cargando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Entrando…
                </>
              ) : (
                'Entrar al dashboard'
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border/60 text-center text-sm text-muted-foreground">
            ¿No tenés cuenta?{' '}
            <Link to="/registro" className="text-primary font-medium hover:underline">
              Creá tu estudio
            </Link>
          </div>

          <div className="flex items-start gap-2 mt-6 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Las claves fiscales de tus clientes viajan cifradas y nunca se muestran en ninguna
              pantalla del sistema.
            </span>
          </div>
        </div>

        <div className="text-center text-xs text-muted-foreground mt-6">
          Versión prototipo · Órbita Contador
        </div>
      </div>
    </div>
  );
}
