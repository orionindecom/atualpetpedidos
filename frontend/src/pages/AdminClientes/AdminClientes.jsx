import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./AdminClientes.module.css";

function AdminClientes() {
  const [clientes, setClientes] = useState([]);
  const [tabelas, setTabelas] = useState([]);
  const [tabelasSelecionadas, setTabelasSelecionadas] = useState({});

  const carregarDados = async () => {
    const clientesResponse = await api.get("/clientes/pendentes");
    const tabelasResponse = await api.get("/tabelas");

    setClientes(clientesResponse.data);
    setTabelas(tabelasResponse.data);
  };

  useEffect(() => {
    carregarDados();
  }, []);

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

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <h1>Clientes Pendentes</h1>

        {clientes.length === 0 && (
          <p>Não há clientes pendentes.</p>
        )}

        <div className={styles.lista}>
          {clientes.map((cliente) => (
            <div className={styles.card} key={cliente._id}>
              <div>
                <h3>{cliente.nomeFantasia || cliente.nomeResponsavel}</h3>
                <p>Responsável: {cliente.nomeResponsavel}</p>
                <p>Razão Social: {cliente.razaoSocial || "-"}</p>
                <p>CNPJ: {cliente.cnpj || "-"}</p>
                <p>E-mail: {cliente.email}</p>
                <p>WhatsApp: {cliente.whatsapp || "-"}</p>
              </div>

              <div className={styles.acoes}>
                <select
                  value={tabelasSelecionadas[cliente._id] || ""}
                  onChange={(e) =>
                    selecionarTabela(cliente._id, e.target.value)
                  }
                >
                  <option value="">Selecione uma tabela</option>

                  {tabelas.map((tabela) => (
                    <option key={tabela._id} value={tabela._id}>
                      {tabela.nome}
                    </option>
                  ))}
                </select>

                <button onClick={() => aprovarCliente(cliente._id)}>
                  Aprovar Cliente
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default AdminClientes;