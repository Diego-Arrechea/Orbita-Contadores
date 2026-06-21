import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Orbit, AlertCircle, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { recuperarPassword, restablecerPassword, mensajeDeError } from '@/services/authService';

/**
 * Recuperación de contraseña. Una sola página con dos modos según la URL:
 *  - sin ?token  → pedir el enlace por correo.
 *  - con  ?token → fijar una contraseña nueva.
 * Ruta pública (fuera del guard de sesión), montada en App.tsx.
 */
export function Recuperar() {
  const [params] = useSearchParams();
  const token = params.get('token');
  return token ? <Restablecer token={token} /> : <Pedir />;
}

/** Modo "olvidé mi contraseña": el contador deja su email y le mandamos el enlace. */
function Pedir() {
  const [email, setEmail] = useState('');
  const [cargando, setCargando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pedir(e: FormEvent) {
    e.preventDefault();
    if (cargando) return;
    setError(null);
    setCargando(true);
    try {
      await recuperarPassword(email.trim());
      setEnviado(true);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <Marco titulo="Recuperar contraseña" subtitulo="Te enviamos un enlace para crear una nueva.">
      {enviado ? (
        <div className="space-y-5">
          <div className="rounded-lg bg-success/10 border border-success/25 px-3.5 py-3 text-sm flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <span className="text-foreground/80">
              Si el correo está registrado, te enviamos las instrucciones para restablecer tu
              contraseña. Revisá tu casilla (y la carpeta de spam).
            </span>
          </div>
          <VolverALogin />
        </div>
      ) : (
        <form className="space-y-4" onSubmit={pedir}>
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

          {error && <ErrorBox msg={error} />}

          <Button type="submit" className="w-full" size="lg" disabled={cargando}>
            {cargando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Enviando…
              </>
            ) : (
              'Enviarme el enlace'
            )}
          </Button>
          <VolverALogin />
        </form>
      )}
    </Marco>
  );
}

/** Modo "fijar contraseña nueva": llega desde el enlace del correo con ?token=… */
function Restablecer({ token }: { token: string }) {
  const navigate = useNavigate();
  const [pass, setPass] = useState('');
  const [repetir, setRepetir] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (cargando) return;
    setError(null);
    if (pass.length < 8) {
      setError('La contraseña tiene que tener al menos 8 caracteres.');
      return;
    }
    if (pass !== repetir) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setCargando(true);
    try {
      await restablecerPassword(token, pass);
      navigate('/login', {
        replace: true,
        state: { aviso: 'Tu contraseña se actualizó. Ya podés ingresar con la nueva.' },
      });
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <Marco titulo="Nueva contraseña" subtitulo="Elegí una contraseña nueva para tu cuenta.">
      <form className="space-y-4" onSubmit={guardar}>
        <div className="space-y-1.5">
          <Label htmlFor="pass">Nueva contraseña</Label>
          <PasswordInput
            id="pass"
            autoComplete="new-password"
            placeholder="••••••••"
            value={pass}
            onChange={e => {
              setPass(e.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="repetir">Repetir contraseña</Label>
          <PasswordInput
            id="repetir"
            autoComplete="new-password"
            placeholder="••••••••"
            value={repetir}
            onChange={e => {
              setRepetir(e.target.value);
              setError(null);
            }}
          />
        </div>

        {error && <ErrorBox msg={error} />}

        <Button type="submit" className="w-full" size="lg" disabled={cargando}>
          {cargando ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Guardando…
            </>
          ) : (
            'Guardar contraseña'
          )}
        </Button>
        <VolverALogin />
      </form>
    </Marco>
  );
}

function Marco({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo: string;
  children: React.ReactNode;
}) {
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
          <h1 className="text-xl font-semibold mb-1">{titulo}</h1>
          <p className="text-sm text-muted-foreground mb-6">{subtitulo}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg bg-danger/10 border border-danger/25 px-3.5 py-2.5 text-sm flex items-start gap-2">
      <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
      <span className="text-foreground/80">{msg}</span>
    </div>
  );
}

function VolverALogin() {
  return (
    <div className="text-center">
      <Link
        to="/login"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Volver a ingresar
      </Link>
    </div>
  );
}
