import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { CargasProvider } from '@/context/CargasContext';
import { PreparacionesProvider } from '@/context/PreparacionesContext';
import { ConfigProvider } from '@/context/ConfigContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Login } from '@/pages/Login';
import { Registro } from '@/pages/Registro';
import { Recuperar } from '@/pages/Recuperar';
import { ConfirmarEmail } from '@/pages/ConfirmarEmail';
import { Terminos, Privacidad } from '@/pages/Legal';
import {
  cuentaActual,
  esAdmin,
  esEmpleado,
  tienePermiso,
  tokenActual,
  actualizarUsuarioGuardado,
  impersonando,
} from '@/lib/cuenta';
import { getMe, registrarLogout } from '@/services/authService';
import { InvalidadorCache } from '@/components/shared/InvalidadorCache';
import { CargasToasts } from '@/components/shared/CargasToasts';

/** Sin sesión → al login. (Cuentas demo en el front; ver src/lib/cuenta.ts). */
function RequireAuth({ children }: { children: ReactNode }) {
  // El ConfigProvider va acá (no dentro de AppLayout): se monta sólo con sesión (sin 401 en /login)
  // y cubre tanto AppLayout como la ruta de reporte (que está fuera de AppLayout).
  return cuentaActual() ? (
    <ConfigProvider>{children}</ConfigProvider>
  ) : (
    <Navigate to="/login" replace />
  );
}

/** Sólo admins: sin sesión → login; con sesión pero sin rol admin → al dashboard. */
function RequireAdmin({ children }: { children: ReactNode }) {
  if (!cuentaActual()) return <Navigate to="/login" replace />;
  return esAdmin() ? <>{children}</> : <Navigate to="/" replace />;
}

/** Sólo cuentas plenas: los usuarios del estudio (empleados) van al dashboard. Protege Gestión de
 *  usuarios, Configuración y Novedades (el backend valida además lo que corresponde). */
function RequireCuentaPlena({ children }: { children: ReactNode }) {
  if (!cuentaActual()) return <Navigate to="/login" replace />;
  return esEmpleado() ? <Navigate to="/" replace /> : <>{children}</>;
}

/** Alta de clientes: para usuarios del estudio, sólo con el permiso que da el titular. */
function RequireNuevoCliente({ children }: { children: ReactNode }) {
  if (!cuentaActual()) return <Navigate to="/login" replace />;
  return tienePermiso('nuevo_cliente') ? <>{children}</> : <Navigate to="/" replace />;
}
import { Dashboard } from '@/pages/Dashboard';
import { Alertas } from '@/pages/Alertas';
import { ClienteDetalle } from '@/pages/ClienteDetalle';
import { ReporteCliente } from '@/pages/ReporteCliente';
import { NuevoCliente } from '@/pages/NuevoCliente';
import { Conciliacion } from '@/pages/Conciliacion';
import { Configuracion } from '@/pages/Configuracion';
import { Novedades } from '@/pages/Novedades';
import { Admin } from '@/pages/Admin';
import { GestionUsuarios } from '@/pages/GestionUsuarios';

export default function App() {
  // Al cargar la app con sesión, refresca los datos del usuario (rol, estado) desde el backend y los
  // re-guarda. Así se reflejan los cambios sin obligar a re-loguear. Silencioso: si el token ya no
  // sirve, los guards de ruta se encargan de mandar al login.
  useEffect(() => {
    if (tokenActual()) {
      getMe().then(actualizarUsuarioGuardado).catch(() => {});
    }
  }, []);

  // Registra el "último cierre" de la app para el panel admin cuando el contador cierra o recarga la
  // pestaña. `pagehide` (no `beforeunload`) es el evento confiable para esto y NO se dispara en la
  // navegación interna del SPA. Best-effort (keepalive); se omite durante una impersonación.
  useEffect(() => {
    function alCerrar() {
      if (tokenActual() && !impersonando()) registrarLogout();
    }
    window.addEventListener('pagehide', alCerrar);
    return () => window.removeEventListener('pagehide', alCerrar);
  }, []);

  return (
    <CargasProvider>
      <PreparacionesProvider>
      <InvalidadorCache />
      <CargasToasts />
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Registro />} />
      <Route path="/recuperar" element={<Recuperar />} />
      <Route path="/confirmar-email" element={<ConfirmarEmail />} />
      <Route path="/terminos" element={<Terminos />} />
      <Route path="/privacidad" element={<Privacidad />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/alertas" element={<Alertas />} />
        <Route path="/conciliacion" element={<Conciliacion />} />
        <Route
          path="/clientes/nuevo"
          element={
            <RequireNuevoCliente>
              <NuevoCliente />
            </RequireNuevoCliente>
          }
        />
        <Route path="/clientes/:id" element={<ClienteDetalle />} />
        <Route
          path="/usuarios"
          element={
            <RequireCuentaPlena>
              <GestionUsuarios />
            </RequireCuentaPlena>
          }
        />
        <Route
          path="/novedades"
          element={
            <RequireCuentaPlena>
              <Novedades />
            </RequireCuentaPlena>
          }
        />
        <Route
          path="/configuracion"
          element={
            <RequireCuentaPlena>
              <Configuracion />
            </RequireCuentaPlena>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <Admin />
            </RequireAdmin>
          }
        />
      </Route>
      <Route
        path="/clientes/:id/reporte"
        element={
          <RequireAuth>
            <ReporteCliente />
          </RequireAuth>
        }
      />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </PreparacionesProvider>
    </CargasProvider>
  );
}
