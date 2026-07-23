import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Bell,
  Landmark,
  Percent,
  UserPlus,
  Users,
  Settings,
  Sparkles,
  Orbit,
  LogOut,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  cuentaActual,
  esAdmin,
  esEmpleado,
  impersonando,
  logoutCuenta,
  puedeVerIVA,
  tienePermiso,
} from '@/lib/cuenta';
import { useNovedadesVistas } from '@/lib/novedadesVistas';
import { registrarLogout } from '@/services/authService';
import { resetChatSoporte } from '@/components/shared/SoporteChat';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/alertas', label: 'Alertas', icon: Bell },
  { to: '/conciliacion', label: 'Conciliación', icon: Landmark },
  { to: '/clientes/nuevo', label: 'Nuevo cliente', icon: UserPlus },
  { to: '/usuarios', label: 'Gestión de usuarios', icon: Users },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
  { to: '/novedades', label: 'Novedades', icon: Sparkles },
];

// Apartado de IVA: rollout gateado (allowlist IVA_EMAILS + admins). Se inserta después de
// Conciliación sólo para las cuentas habilitadas (puedeVerIVA). El backend valida igual.
const ivaItem = { to: '/iva', label: 'IVA', icon: Percent };

/** Inserta el ítem de IVA (si la cuenta lo tiene habilitado) justo después de Conciliación. */
function conIva(items: typeof nav): typeof nav {
  if (!puedeVerIVA()) return items;
  const i = items.findIndex(x => x.to === '/conciliacion');
  const at = i >= 0 ? i + 1 : items.length;
  return [...items.slice(0, at), ivaItem, ...items.slice(at)];
}

/** Menú según la cuenta. Usuario del estudio (empleado): sin Gestión, Configuración ni Novedades, y
 *  "Nuevo cliente" sólo si el titular le dio el permiso. Cuenta plena: todo (+ Superadmin si admin).
 *  El apartado de IVA aparece sólo si la cuenta lo tiene habilitado (piloto acotado). */
function itemsSegunCuenta() {
  if (esEmpleado()) {
    return conIva(
      nav.filter(item => {
        if (['/usuarios', '/configuracion', '/novedades'].includes(item.to)) return false;
        if (item.to === '/clientes/nuevo') return tienePermiso('nuevo_cliente');
        return true;
      })
    );
  }
  return conIva(
    esAdmin()
      ? [...nav, { to: '/admin', label: 'Superadmin', icon: ShieldCheck, end: false }]
      : nav
  );
}

const LS_COLAPSADA = 'orbita_sidebar_colapsada';

function leerColapsada(): boolean {
  try {
    return localStorage.getItem(LS_COLAPSADA) === '1';
  } catch {
    return false;
  }
}

// Calcula si una ruta del menú está activa. Lo hacemos a mano (no con el className-función de
// NavLink) porque cuando el ítem va envuelto en TooltipTrigger asChild (riel colapsado), el Slot de
// Radix rompe esa función y se perdía el resaltado. Con un string siempre funciona.
function rutaActiva(pathname: string, to: string, end?: boolean): boolean {
  return end
    ? pathname === to
    : pathname === to || pathname.startsWith(to.endsWith('/') ? to : to + '/');
}

/**
 * Contenido interno del sidebar (logo + navegación + cuenta), compartido entre el riel de escritorio
 * y el drawer mobile. `colapsada` sólo aplica a escritorio; el drawer siempre va expandido.
 * `onNavegar` se dispara al tocar un ítem o salir (lo usa el drawer para cerrarse).
 */
function ContenidoSidebar({
  colapsada,
  onNavegar,
}: {
  colapsada: boolean;
  onNavegar?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const cuenta = cuentaActual();
  const { noVistas } = useNovedadesVistas();

  // Menú según la cuenta (las rutas además están protegidas con guards + en el backend).
  const items = itemsSegunCuenta();

  // El avatar/ficha de la cuenta lleva directo a la pestaña Cuenta de Configuración
  // (deep-link ?tab=cuenta) y cierra el drawer en mobile. Los usuarios del estudio no tienen
  // Configuración: el avatar no navega.
  function irAConfiguracion() {
    if (!esEmpleado()) navigate('/configuracion?tab=cuenta');
    onNavegar?.();
  }

  function salir() {
    // Registra el cierre para el panel admin (salvo durante una impersonación: el token es el del
    // contador y el que cierra es el admin de soporte, no queremos ensuciarle el "último cierre").
    if (!impersonando()) registrarLogout();
    resetChatSoporte(); // limpia la sesión de Crisp: la próxima cuenta no hereda el chat
    logoutCuenta();
    onNavegar?.();
    navigate('/login');
  }

  return (
    <>
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
          const isActive = rutaActiva(location.pathname, item.to, item.end);
          const tieneAviso = item.to === '/novedades' && noVistas > 0;
          const link = (
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavegar}
              className={cn(
                'relative flex items-center rounded-xl font-medium transition-colors',
                colapsada ? 'h-11 w-11 justify-center' : 'gap-3 px-3.5 py-2.5 text-sm',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-hover))] hover:text-white'
              )}
            >
              <item.icon className={cn('shrink-0', colapsada ? 'h-5 w-5' : 'h-4 w-4')} />
              {!colapsada && item.label}
              {tieneAviso &&
                (colapsada ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-[hsl(var(--sidebar))]" />
                ) : (
                  <span className="ml-auto h-2 w-2 rounded-full bg-primary" />
                ))}
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
                <button
                  type="button"
                  onClick={irAConfiguracion}
                  aria-label="Configurar mi cuenta"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-primary text-sm font-semibold transition-colors hover:bg-primary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {cuenta?.iniciales ?? '—'}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {cuenta?.nombre ?? 'Invitado'}
                {cuenta?.estudio ? ` · ${cuenta.estudio}` : ''}
                {' · Configurar cuenta'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={salir}
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
            <button
              type="button"
              onClick={irAConfiguracion}
              title="Configurar mi cuenta"
              className="flex flex-1 min-w-0 items-center gap-3 rounded-lg text-left transition-colors hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary text-sm font-semibold">
                {cuenta?.iniciales ?? '—'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{cuenta?.nombre ?? 'Invitado'}</div>
                <div className="text-xs text-[hsl(var(--sidebar-muted))] truncate">
                  {cuenta?.estudio ?? ''}
                </div>
              </div>
            </button>
            <button
              onClick={salir}
              className="text-[hsl(var(--sidebar-muted))] hover:text-white transition-colors p-1.5 rounded-md hover:bg-[hsl(var(--sidebar-hover))]"
              title="Salir"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function Sidebar({
  abiertoMobile = false,
  onCerrarMobile,
}: {
  abiertoMobile?: boolean;
  onCerrarMobile?: () => void;
}) {
  const [colapsada, setColapsada] = useState(leerColapsada);

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

  return (
    <>
      {/* Riel de escritorio (≥ lg). Oculto en mobile. */}
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

        <ContenidoSidebar colapsada={colapsada} />
      </aside>

      {/* Drawer mobile (< lg). Backdrop + panel deslizable controlados desde el AppLayout. */}
      <div className="lg:hidden" aria-hidden={!abiertoMobile}>
        {/* Backdrop */}
        <div
          onClick={onCerrarMobile}
          className={cn(
            'fixed inset-0 z-40 bg-black/50 transition-opacity duration-300',
            abiertoMobile ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        />
        {/* Panel */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col px-4 py-7 text-[hsl(var(--sidebar-foreground))] shadow-2xl transition-transform duration-300 ease-in-out',
            abiertoMobile ? 'translate-x-0' : '-translate-x-full'
          )}
          style={{ background: 'hsl(var(--sidebar))' }}
        >
          <button
            onClick={onCerrarMobile}
            aria-label="Cerrar menú"
            className="absolute right-3 top-7 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--sidebar-muted))] transition-colors hover:bg-[hsl(var(--sidebar-hover))] hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <ContenidoSidebar colapsada={false} onNavegar={onCerrarMobile} />
        </aside>
      </div>
    </>
  );
}
