import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login/Login";
import Catalogo from "./pages/Catalogo/Catalogo";
import MeusPedidos from "./pages/MeusPedidos/MeusPedidos";
import AdminClientes from "./pages/AdminClientes/AdminClientes";
import Cadastro from "./pages/Cadastro/Cadastro";
import AdminProdutos from "./pages/AdminProdutos/AdminProdutos";
import AdminPrecos from "./pages/AdminPrecos/AdminPrecos";
import AdminTabelas from "./pages/AdminTabelas/AdminTabelas";
import AdminPedidos from "./pages/AdminPedidos/AdminPedidos";
import Dashboard from "./pages/Dashboard/Dashboard";
import PrecosClienteFinal from "./pages/PrecosClienteFinal/PrecosClienteFinal";
import MateriaisMarketing from "./pages/MateriaisMarketing/MateriaisMarketing";
import AdminMateriaisMarketing from "./pages/AdminMateriaisMarketing/AdminMateriaisMarketing";
import Treinamentos from "./pages/Treinamentos/Treinamentos";
import TreinamentoDetalhe from "./pages/TreinamentoDetalhe/TreinamentoDetalhe";
import AdminTreinamentos from "./pages/AdminTreinamentos/AdminTreinamentos";
import AdminBanners from "./pages/AdminBanners/AdminBanners";
import MarketingDashboard from "./pages/MarketingDashboard/MarketingDashboard";
import LogisticaDashboard from "./pages/LogisticaDashboard/LogisticaDashboard";
import LogisticaPedidos from "./pages/LogisticaPedidos/LogisticaPedidos";
import AdminOperadoresLogistica from "./pages/AdminOperadoresLogistica/AdminOperadoresLogistica";
import AdminMetricasPedidos from "./pages/AdminMetricasPedidos/AdminMetricasPedidos";
import {
  HomeRedirect,
  NotFoundRoute,
  RoleRoute,
} from "./components/RouteGuards/RouteGuards";
import { registrarBloqueioRodaInputsNumericos } from "./utils/numberInputWheel";

function App() {
  useEffect(() => registrarBloqueioRodaInputsNumericos(), []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin/login" element={<Login />} />
        <Route path="/cadastro" element={<Cadastro />} />
        <Route
          path="/catalogo"
          element={(
            <RoleRoute role="cliente">
              <Catalogo />
            </RoleRoute>
          )}
        />
        <Route
          path="/meus-pedidos"
          element={(
            <RoleRoute role="cliente">
              <MeusPedidos />
            </RoleRoute>
          )}
        />
        <Route
          path="/precos-cliente-final"
          element={(
            <RoleRoute role="cliente">
              <PrecosClienteFinal />
            </RoleRoute>
          )}
        />
        <Route
          path="/materiais-marketing"
          element={(
            <RoleRoute role="cliente">
              <MateriaisMarketing />
            </RoleRoute>
          )}
        />
        <Route
          path="/treinamentos"
          element={(
            <RoleRoute role="cliente">
              <Treinamentos />
            </RoleRoute>
          )}
        />
        <Route
          path="/treinamentos/:id"
          element={(
            <RoleRoute role="cliente">
              <TreinamentoDetalhe />
            </RoleRoute>
          )}
        />
        <Route
          path="/clientes"
          element={(
            <RoleRoute role="admin">
              <AdminClientes />
            </RoleRoute>
          )}
        />
        <Route
          path="/produtos"
          element={(
            <RoleRoute role="admin">
              <AdminProdutos />
            </RoleRoute>
          )}
        />
        <Route
          path="/precos"
          element={(
            <RoleRoute role="admin">
              <AdminPrecos />
            </RoleRoute>
          )}
        />
        <Route
          path="/tabelas"
          element={(
            <RoleRoute role="admin">
              <AdminTabelas />
            </RoleRoute>
          )}
        />
        <Route
          path="/pedidos"
          element={(
            <RoleRoute role="admin">
              <AdminPedidos />
            </RoleRoute>
          )}
        />
        <Route
          path="/admin/operadores-logistica"
          element={(
            <RoleRoute role="admin">
              <AdminOperadoresLogistica />
            </RoleRoute>
          )}
        />
        <Route
          path="/admin/metricas-operacionais"
          element={(
            <RoleRoute role="admin">
              <AdminMetricasPedidos />
            </RoleRoute>
          )}
        />
        <Route
          path="/admin"
          element={(
            <RoleRoute role="admin">
              <Dashboard />
            </RoleRoute>
          )}
        />
        <Route
          path="/admin/materiais-marketing"
          element={(
            <RoleRoute role="admin">
              <AdminMateriaisMarketing />
            </RoleRoute>
          )}
        />
        <Route
          path="/admin/banners"
          element={(
            <RoleRoute role="admin">
              <AdminBanners />
            </RoleRoute>
          )}
        />
        <Route
          path="/admin/treinamentos"
          element={(
            <RoleRoute role="admin">
              <AdminTreinamentos />
            </RoleRoute>
          )}
        />
        <Route
          path="/marketing"
          element={(
            <RoleRoute role="marketing">
              <MarketingDashboard />
            </RoleRoute>
          )}
        />
        <Route
          path="/marketing/conteudos"
          element={(
            <RoleRoute role="marketing">
              <AdminMateriaisMarketing
                apiBase="/marketing/conteudos"
                pageTitle="Conteúdos"
              />
            </RoleRoute>
          )}
        />
        <Route
          path="/marketing/banners"
          element={(
            <RoleRoute role="marketing">
              <AdminBanners />
            </RoleRoute>
          )}
        />
        <Route
          path="/logistica"
          element={(
            <RoleRoute role="logistica">
              <LogisticaDashboard />
            </RoleRoute>
          )}
        />
        <Route
          path="/logistica/pedidos"
          element={(
            <RoleRoute role="logistica">
              <LogisticaPedidos />
            </RoleRoute>
          )}
        />
        <Route path="*" element={<NotFoundRoute />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
