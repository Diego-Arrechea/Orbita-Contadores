import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Bell,
  Landmark,
  UserPlus,
  Settings,
  Orbit,
  LogOut,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { cuentaActual, esAdmin, logoutCuenta } from '@/lib/cuenta';
import { resetChatSoporte } from '@/components/shared/SoporteChat';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/alertas', label: 'Alertas', icon: Bell },
  { to: '/conciliacion', label: 'Conciliación', icon: Landmark },
  { to: '/clientes/nuevo', label: 'Nuevo cliente', icon: UserPlus },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

const LS_COLAPSADA = 'orbita_sidebar_colapsada';

function leerColapsada(): boolean {
  try {
    return localStorage.getItem(LS_COLAPSADA) === '1';
  } catch {
    return false;
  }
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const cuenta = cuentaActual();
  const [colapsada, setColapsada] = useState(leerColapsada);

  // Calculamos el activo a mano (no con el className-función de NavLink): cuando el ítem va envuelto
  // en TooltipTrigger asChild (riel colapsado), el Slot de Radix rompe esa función y se perdía el
  // resaltado. Con un string siempre funciona, colapsada o no.
  function activo(to: string, end?: boolean): boolean {
    const p = location.pathname;
    return end ? p === to : p === to || p.startsWith(to.endsWith('/') ? to : to + '/');
  }

  function toggle() {
    setColapsada(prev => {
      const v = !prev;
      try {
        localStorage.setItem(LS_COLAPSADA, v ? '1' : '0');
      } catch {
        /* ignore */
      }
      return v;
    });
  }

  // El ítem del panel sólo aparece para cuentas admin (la ruta /admin además está protegida en back).
  const items = esAdmin()
    ? [...nav, { to: '/admin', label: 'Superadmin', icon: ShieldCheck, end: false }]
    : nav;

  return (
    <aside
      className={cn(
        'relative hidden lg:flex shrink-0 flex-col py-7 text-[hsl(var(--sidebar-foreground))] transition-[width] duration-300 ease-in-out',
        colapsada ? 'w-[78px] px-3' : 'w-72 px-4'
      )}
      style={{ background: 'hsl(var(--sidebar))' }}
    >
      {/* Botón flotante para colapsar/expandir, montado sobre el borde derecho. */}
      <button
        onClick={toggle}
        title={colapsada ? 'Expandir menú' : 'Colapsar menú'}
        aria-label={colapsada ? 'Expandir menú' : 'Colapsar menú'}
        className="absolute -right-3 top-9 z-40 flex h-6 w-6 items-center justify-center rounded-full border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-muted))] shadow-md transition-colors hover:text-white"
      >
        {colapsada ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      {/* Logo */}
      <div
        className={cn(
          'flex items-center gap-3',
          colapsada ? 'mb-6 justify-center px-0' : 'mb-9 px-3'
        )}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
          <Orbit className="h-5 w-5" />
        </div>
        {!colapsada && (
          <div className="leading-tight">
            <div className="font-semibold text-lg tracking-tight text-white">Órbita</div>
            <div className="text-xs text-[hsl(var(--sidebar-muted))]">Contador</div>
          </div>
        )}
      </div>

      {!colapsada && (
        <div className="px-3 mb-3">
          <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--sidebar-muted))] font-semibold">
            Estudio
          </div>
        </div>
      )}

      <nav className={cn('flex-1', colapsada ? 'flex flex-col items-center gap-2' : 'space-y-1')}>
        {items.map(item => {
          const isActive = activo(item.to, item.end);
          const link = (
            <NavLink
              to={item.to}
              end={item.end}
              className={cn(
                'flex items-center rounded-xl font-medium transition-colors',
                colapsada ? 'h-11 w-11 justify-center' : 'gap-3 px-3.5 py-2.5 text-sm',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-hover))] hover:text-white'
              )}
            >
              <item.icon className={cn('shrink-0', colapsada ? 'h-5 w-5' : 'h-4 w-4')} />
              {!colapsada && item.label}
            </NavLink>
          );
          return colapsada ? (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            <div key={item.to}>{link}</div>
          );
        })}
      </nav>

      {/* Cuenta + salir */}
      <div className="border-t border-[hsl(var(--sidebar-border))] pt-4 mt-4">
        {colapsada ? (
          <div className="flex flex-col items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-primary text-sm font-semibold">
                  {cuenta?.iniciales ?? '—'}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                {cuenta?.nombre ?? 'Invitado'}
                {cuenta?.estudio ? ` · ${cuenta.estudio}` : ''}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    resetChatSoporte();
                    logoutCuenta();
                    navigate('/login');
                  }}
                  aria-label="Salir"
                  className="text-[hsl(var(--sidebar-muted))] hover:text-white transition-colors p-1.5 rounded-md hover:bg-[hsl(var(--sidebar-hover))]"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Salir</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="rounded-xl bg-[hsl(var(--sidebar-hover))] p-3 flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-sm font-semibold">
              {cuenta?.iniciales ?? '—'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{cuenta?.nombre ?? 'Invitado'}</div>
              <div className="text-xs text-[hsl(var(--sidebar-muted))] truncate">
                {cuenta?.estudio ?? ''}
              </div>
            </div>
            <button
              onClick={() => {
                resetChatSoporte(); // limpia la sesión de Crisp: la próxima cuenta no hereda el chat
                logoutCuenta();
                navigate('/login');
              }}
              className="text-[hsl(var(--sidebar-muted))] hover:text-white transition-colors p-1.5 rounded-md hover:bg-[hsl(var(--sidebar-hover))]"
              title="Salir"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
