import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { CargasProvider } from '@/context/CargasContext';
import { SyncProvider } from '@/context/SyncContext';
import { ConfigProvider } from '@/context/ConfigContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Login } from '@/pages/Login';
import { Registro } from '@/pages/Registro';
import { Terminos, Privacidad } from '@/pages/Legal';
import { cuentaActual, esAdmin, tokenActual, actualizarUsuarioGuardado } from '@/lib/cuenta';
import { getMe } from '@/services/authService';
import { InvalidadorCache } from '@/components/shared/InvalidadorCache';

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
import { Dashboard } from '@/pages/Dashboard';
import { Alertas } from '@/pages/Alertas';
import { ClienteDetalle } from '@/pages/ClienteDetalle';
import { ReporteCliente } from '@/pages/ReporteCliente';
import { NuevoCliente } from '@/pages/NuevoCliente';
import { Conciliacion } from '@/pages/Conciliacion';
import { Configuracion } from '@/pages/Configuracion';
import { Admin } from '@/pages/Admin';

export default function App() {
  // Al cargar la app con sesión, refresca los datos del usuario (días de prueba, rol, estado) desde
  // el backend y los re-guarda. Así el header muestra el trial sin obligar a re-loguear. Silencioso:
  // si el token ya no sirve, los guards de ruta se encargan de mandar al login.
  useEffect(() => {
    if (tokenActual()) {
      getMe().then(actualizarUsuarioGuardado).catch(() => {});
    }
  }, []);

  return (
    <CargasProvider>
      <SyncProvider>
      <InvalidadorCache />
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Registro />} />
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
        <Route path="/clientes/nuevo" element={<NuevoCliente />} />
        <Route path="/clientes/:id" element={<ClienteDetalle />} />
        <Route path="/configuracion" element={<Configuracion />} />
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
      </SyncProvider>
    </CargasProvider>
  );
}
