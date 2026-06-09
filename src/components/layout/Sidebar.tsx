import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Bell, Landmark, UserPlus, Settings, Orbit, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cuentaActual, logoutCuenta } from '@/lib/cuenta';
import { resetChatSoporte } from '@/components/shared/SoporteChat';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/alertas', label: 'Alertas', icon: Bell },
  { to: '/conciliacion', label: 'Conciliación', icon: Landmark },
  { to: '/clientes/nuevo', label: 'Nuevo cliente', icon: UserPlus },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

export function Sidebar() {
  const navigate = useNavigate();
  const cuenta = cuentaActual();
  return (
    <aside
      className="hidden lg:flex w-72 shrink-0 flex-col px-4 py-7 text-[hsl(var(--sidebar-foreground))]"
      style={{ background: 'hsl(var(--sidebar))' }}
    >
      <div className="px-3 mb-9 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
          <Orbit className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-lg tracking-tight text-white">Órbita</div>
          <div className="text-xs text-[hsl(var(--sidebar-muted))]">Contador</div>
        </div>
      </div>

      <div className="px-3 mb-3">
        <div className="text-[11px] uppercase tracking-wider text-[hsl(var(--sidebar-muted))] font-semibold">
          Estudio
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {nav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-hover))] hover:text-white'
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[hsl(var(--sidebar-border))] pt-4 mt-4">
        <div className="rounded-xl bg-[hsl(var(--sidebar-hover))] p-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-primary text-sm font-semibold">
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
      </div>
    </aside>
  );
}
