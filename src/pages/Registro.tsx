import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Orbit, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { registrar, mensajeDeError } from '@/services/authService';
import { iniciarSesion } from '@/lib/cuenta';

const VACIO = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  dni: '',
  cuit: '',
  estudio: '',
  matricula: '',
  password: '',
  confirmar: '',
};

const soloDigitos = (s: string) => s.replace(/\D/g, '');

/** Campo de texto con label, reutilizado en el formulario. */
function Campo({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  opcional,
  prefijo,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  opcional?: boolean;
  prefijo?: string;
  hint?: string;
}) {
  const input = (
    <Input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className={prefijo ? 'rounded-l-none' : undefined}
    />
  );
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {opcional && <span className="text-muted-foreground font-normal"> (opcional)</span>}
      </Label>
      {prefijo ? (
        <div className="flex">
          <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-sm text-muted-foreground shrink-0">
            {prefijo}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Registro() {
  const navigate = useNavigate();
  const [form, setForm] = useState(VACIO);
  const [terminos, setTerminos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const set = (k: keyof typeof VACIO) => (e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    setError(null);
  };

  function validar(): string | null {
    if (!form.nombre.trim() || !form.apellido.trim()) return 'Completá tu nombre y apellido.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return 'Ingresá un email válido.';
    const tel = soloDigitos(form.telefono).replace(/^0/, '').replace(/^15/, '');
    if (tel.length !== 10)
      return 'El celular debe tener 10 dígitos: tu código de área + número, sin el 0 ni el 15.';
    const dni = soloDigitos(form.dni);
    if (dni.length < 7 || dni.length > 8) return 'El DNI debe tener 7 u 8 dígitos.';
    if (soloDigitos(form.cuit).length !== 11) return 'El CUIT debe tener 11 dígitos.';
    if (!form.estudio.trim()) return 'Ingresá el nombre del estudio.';
    if (form.password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (form.password !== form.confirmar) return 'Las contraseñas no coinciden.';
    if (!terminos) return 'Tenés que aceptar los términos y condiciones.';
    return null;
  }

  async function registrarse(e: FormEvent) {
    e.preventDefault();
    if (cargando) return;
    const invalido = validar();
    if (invalido) {
      setError(invalido);
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const auth = await registrar({
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        email: form.email.trim(),
        telefono: '+549' + soloDigitos(form.telefono).replace(/^0/, '').replace(/^15/, ''),
        dni: form.dni,
        cuit: form.cuit,
        estudio: form.estudio.trim(),
        matricula: form.matricula.trim() || undefined,
        password: form.password,
        acepto_terminos: terminos,
      });
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
      <div className="w-full max-w-lg py-8">
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
          <h1 className="text-xl font-semibold mb-1">Creá tu estudio</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Registrate para empezar a monitorear a tus clientes monotributistas.
          </p>

          <form className="space-y-4" onSubmit={registrarse}>
            <div className="grid grid-cols-2 gap-3">
              <Campo id="nombre" label="Nombre" value={form.nombre} onChange={set('nombre')} autoComplete="given-name" />
              <Campo id="apellido" label="Apellido" value={form.apellido} onChange={set('apellido')} autoComplete="family-name" />
            </div>

            <Campo
              id="email"
              label="Correo electrónico"
              type="email"
              value={form.email}
              onChange={set('email')}
              placeholder="tucorreo@estudio.com.ar"
              autoComplete="email"
            />

            <Campo
              id="telefono"
              label="Teléfono (celular)"
              type="tel"
              value={form.telefono}
              onChange={set('telefono')}
              placeholder="221 6099723"
              autoComplete="tel"
              prefijo="+54 9"
              hint="Tu código de área + número, sin el 0 ni el 15."
            />

            <div className="grid grid-cols-2 gap-3">
              <Campo id="dni" label="DNI" value={form.dni} onChange={set('dni')} placeholder="30111222" />
              <Campo id="cuit" label="CUIT" value={form.cuit} onChange={set('cuit')} placeholder="20-30111222-3" />
            </div>

            <Campo id="estudio" label="Nombre del estudio" value={form.estudio} onChange={set('estudio')} placeholder="Estudio Pérez & Asoc." />

            <Campo id="matricula" label="Matrícula profesional" value={form.matricula} onChange={set('matricula')} placeholder="CPCE 12345" opcional />

            <div className="grid grid-cols-2 gap-3">
              <Campo id="password" label="Contraseña" type="password" value={form.password} onChange={set('password')} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
              <Campo id="confirmar" label="Repetir contraseña" type="password" value={form.confirmar} onChange={set('confirmar')} autoComplete="new-password" />
            </div>

            <label className="flex items-start gap-2.5 text-sm text-muted-foreground cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={terminos}
                onChange={e => {
                  setTerminos(e.target.checked);
                  setError(null);
                }}
                className="mt-0.5 h-4 w-4 rounded border-border accent-primary cursor-pointer"
              />
              <span>
                Acepto los{' '}
                <a
                  href="/terminos"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  términos y condiciones
                </a>{' '}
                y la{' '}
                <a
                  href="/privacidad"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  política de privacidad
                </a>
                .
              </span>
            </label>

            {error && (
              <div className="rounded-lg bg-danger/10 border border-danger/25 px-3.5 py-2.5 text-sm flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                <span className="text-foreground/80">{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={cargando}>
              {cargando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Creando tu cuenta…
                </>
              ) : (
                'Crear cuenta'
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border/60 text-center text-sm text-muted-foreground">
            ¿Ya tenés cuenta?{' '}
            <Link to="/login" className="text-primary font-medium hover:underline">
              Ingresá
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
