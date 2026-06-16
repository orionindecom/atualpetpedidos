import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login/Login";
import Catalogo from "./pages/Catalogo/Catalogo";
import MeusPedidos from "./pages/MeusPedidos/MeusPedidos";
import AdminClientes from "./pages/AdminClientes/AdminClientes";
import Cadastro from "./pages/Cadastro/Cadastro";


function Admin() {
  return <h1>Painel Admin</h1>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/catalogo" element={<Catalogo />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/meus-pedidos" element={<MeusPedidos />} />
        <Route path="/clientes" element={<AdminClientes />} />
        <Route path="/cadastro" element={<Cadastro />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;