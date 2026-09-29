import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ShieldCheck, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { AccesoLayout } from '@/components/layout/AccesoLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { login, mensajeDeError } from '@/services/authService';
import { iniciarSesion, tomarMotivoSalida } from '@/lib/cuenta';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  // Aviso de éxito al volver desde el restablecimiento de contraseña (ver Recuperar.tsx).
  const aviso = (location.state as { aviso?: string } | null)?.aviso;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Si a la persona la sacaron de la app (cuenta deshabilitada, acceso suspendido), el motivo
  // llega hasta acá para que sepa por qué no puede entrar. Se lee una sola vez.
  const [error, setError] = useState<string | null>(() => tomarMotivoSalida());
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
    <AccesoLayout>
      <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight">Ingresar al estudio</h1>
      <p className="text-sm text-muted-foreground mt-1.5 mb-7">
        Monitoreá tus clientes monotributistas en un solo lugar.
      </p>

      {aviso && (
        <div className="rounded-xl bg-[hsl(var(--ok-bg))] px-3.5 py-2.5 text-sm flex items-start gap-2 mb-4">
          <CheckCircle2 className="h-4 w-4 text-[hsl(var(--ok-ink))] shrink-0 mt-0.5" />
          <span className="text-[hsl(var(--ok-ink))]">{aviso}</span>
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
            className="h-12 text-[15px]"
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
            <Link className="text-xs font-medium text-primary hover:underline" to="/recuperar">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="••••••••"
            className="h-12 text-[15px]"
            value={password}
            onChange={e => {
              setPassword(e.target.value);
              setError(null);
            }}
          />
        </div>

        {error && (
          <div className="rounded-xl bg-[hsl(var(--danger-bg))] px-3.5 py-2.5 text-sm flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[hsl(var(--danger-ink))] shrink-0 mt-0.5" />
            <span className="text-[hsl(var(--danger-ink))]">{error}</span>
          </div>
        )}

        <Button type="submit" className="w-full h-12 text-[15px]" size="lg" disabled={cargando}>
          {cargando ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Entrando…
            </>
          ) : (
            'Entrar al dashboard'
          )}
        </Button>
      </form>

      <div className="mt-7 pt-5 border-t border-hairline text-center text-sm text-muted-foreground">
        ¿No tenés cuenta?{' '}
        <Link to="/registro" className="text-primary font-semibold hover:underline">
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
    </AccesoLayout>
  );
}
