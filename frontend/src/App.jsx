import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/catalogo" element={<Catalogo />} />
        <Route path="/meus-pedidos" element={<MeusPedidos />} />
        <Route path="/clientes" element={<AdminClientes />} />
        <Route path="/cadastro" element={<Cadastro />} />
        <Route path="/produtos" element={<AdminProdutos />} />
        <Route path="/precos" element={<AdminPrecos />} />
        <Route path="/tabelas" element={<AdminTabelas />} />
        <Route path="/pedidos" element={<AdminPedidos />} />
        <Route path="/admin" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;