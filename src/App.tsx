import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { ClienteDetalle } from '@/pages/ClienteDetalle';
import { NuevoCliente } from '@/pages/NuevoCliente';
import { ImportarClientes } from '@/pages/ImportarClientes';
import { Movimientos } from '@/pages/Movimientos';
import { Configuracion } from '@/pages/Configuracion';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clientes/nuevo" element={<NuevoCliente />} />
        <Route path="/clientes/importar" element={<ImportarClientes />} />
        <Route path="/clientes/:id" element={<ClienteDetalle />} />
        <Route path="/clientes/:id/movimientos" element={<Movimientos />} />
        <Route path="/configuracion" element={<Configuracion />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
