import { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import { FilterToolbar } from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./AdminClientes.module.css";

const statusClasse = (status = "") => {
  const s = status.toLowerCase();
  if (s.includes("pend")) return styles.statusPendente;
  if (s.includes("aprov")) return styles.statusAprovado;
  if (s.includes("inati")) return styles.statusInativo;
  return "";
};

const normalizarTexto = (texto = "") =>
  String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\D/g, (char) => char);

const normalizarDocumento = (texto = "") => String(texto).replace(/\D/g, "");

function AdminClientes() {
  const [clientes, setClientes] = useState([]);
  const [tabelas, setTabelas] = useState([]);
  const [tabelasSelecionadas, setTabelasSelecionadas] = useState({});
  const [busca, setBusca] = useState("");

  const carregarDados = async () => {
    const [clientesResponse, tabelasResponse] = await Promise.all([
      api.get("/clientes"),
      api.get("/tabelas"),
    ]);

    setClientes(clientesResponse.data);
    setTabelas(tabelasResponse.data);
  };

  useEffect(() => {
    async function carregarDadosIniciais() {
      const [clientesResponse, tabelasResponse] = await Promise.all([
        api.get("/clientes"),
        api.get("/tabelas"),
      ]);

      setClientes(clientesResponse.data);
      setTabelas(tabelasResponse.data);
    }

    carregarDadosIniciais();
  }, []);

  const clientesFiltrados = useMemo(() => {
    const termo = normalizarTexto(busca.trim());
    const termoDocumento = normalizarDocumento(busca);

    if (!termo && !termoDocumento) return clientes;

    return clientes.filter((cliente) => {
      const camposTexto = [
        cliente.nomeResponsavel,
        cliente.nomeFantasia,
        cliente.razaoSocial,
      ]
        .map(normalizarTexto)
        .join(" ");

      const cnpj = normalizarDocumento(cliente.cnpj);

      return (
        camposTexto.includes(termo) ||
        (termoDocumento && cnpj.includes(termoDocumento))
      );
    });
  }, [busca, clientes]);

  const selecionarTabela = (clienteId, tabelaId) => {
    setTabelasSelecionadas({
      ...tabelasSelecionadas,
      [clienteId]: tabelaId,
    });
  };

  const aprovarCliente = async (clienteId) => {
    const tabelaPrecoId = tabelasSelecionadas[clienteId];

    if (!tabelaPrecoId) {
      alert("Selecione uma tabela para o cliente");
      return;
    }

    await api.put(`/clientes/${clienteId}/aprovar`, {
      tabelaPrecoId,
    });

    alert("Cliente aprovado com sucesso");
    carregarDados();
  };

  const redefinirSenha = async (clienteId) => {
    const novaSenha = prompt("Digite a nova senha:");

    if (!novaSenha) return;

    try {
      await api.put(`/clientes/${clienteId}/redefinir-senha`, { novaSenha });
      alert("Senha redefinida com sucesso");
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "Erro ao redefinir senha");
    }
  };

const inativarCliente = async (clienteId) => {
  const confirmar = confirm("Deseja realmente inativar este cliente?");

  if (!confirmar) return;

  try {
    await api.put(`/clientes/${clienteId}/desativar`);

    alert("Cliente inativado com sucesso");
    carregarDados();
  } catch (error) {
    console.error(error);
    alert(error.response?.data?.message || "Erro ao inativar cliente");
  }
};

const reativarCliente = async (clienteId) => {
  const confirmar = confirm("Deseja realmente reativar este cliente?");

  if (!confirmar) return;

  try {
    await api.put(`/clientes/${clienteId}/reativar`);

    alert("Cliente reativado com sucesso");
    carregarDados();
  } catch (error) {
    console.error(error);
    alert(error.response?.data?.message || "Erro ao reativar cliente");
  }
};

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <div className={styles.topo}>
          <div>
            <h1>Clientes</h1>
            <p>Gerencie aprovações, tabelas de preço, senhas e status dos clientes.</p>
          </div>

        </div>

        <FilterToolbar
          layout="stacked"
          searchLabel="Buscar cliente"
          searchPlaceholder="Buscar por cliente, CNPJ ou razão social..."
          searchValue={busca}
          onSearchChange={(event) => setBusca(event.target.value)}
          onSubmit={(event) => event.preventDefault()}
          onClear={() => setBusca("")}
        />

        {clientes.length === 0 && <p>Não há clientes cadastrados.</p>}

        {clientes.length > 0 && clientesFiltrados.length === 0 && (
          <p>Nenhum cliente encontrado para a busca informada.</p>
        )}

        <div className={styles.lista}>
          {clientesFiltrados.map((cliente) => {
            const nomeCliente = cliente.nomeFantasia || cliente.nomeResponsavel;
            const clienteInativo = cliente.statusCadastro
              ?.toLowerCase()
              .includes("inati");

            return (
              <div
                className={`${styles.card} ${statusClasse(cliente.statusCadastro)}`}
                key={cliente._id}
              >
                <div>
                  <h3>{nomeCliente}</h3>
                  <p>Responsável: {cliente.nomeResponsavel}</p>
                  <p>Nome Fantasia: {cliente.nomeFantasia || "-"}</p>
                  <p>Razão Social: {cliente.razaoSocial || "-"}</p>
                  <p>CNPJ: {cliente.cnpj || "-"}</p>
                  <p>E-mail: {cliente.email}</p>
                  <p>WhatsApp: {cliente.whatsapp || "-"}</p>
                  <p>Status: {cliente.statusCadastro}</p>
                </div>

                <div className={styles.acoes}>
                  <select
                    value={tabelasSelecionadas[cliente._id] || ""}
                    onChange={(e) => selecionarTabela(cliente._id, e.target.value)}
                    disabled={clienteInativo}
                  >
                    <option value="">Selecione uma tabela</option>

                    {tabelas.map((tabela) => (
                      <option key={tabela._id} value={tabela._id}>
                        {tabela.nome}
                      </option>
                    ))}
                  </select>

                  {cliente.statusCadastro === "pendente" && (
                    <button
                      type="button"
                      className={styles.botaoPrincipal}
                      onClick={() => aprovarCliente(cliente._id)}
                    >
                      Aprovar Cliente
                    </button>
                  )}

                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    onClick={() => redefinirSenha(cliente._id)}
                    disabled={clienteInativo}
                  >
                    Redefinir Senha
                  </button>

                  {cliente.statusCadastro === "inativo" ? (
                    <button
                      type="button"
                      className={styles.btnReativar}
                      onClick={() => reativarCliente(cliente._id)}
                    >
                      Reativar Cliente
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.btnInativar}
                      onClick={() => inativarCliente(cliente._id)}
                    >
                      Inativar Cliente
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default AdminClientes;
