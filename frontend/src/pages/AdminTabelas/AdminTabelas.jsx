import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./AdminTabelas.module.css";

function AdminTabelas() {
  const [tabelas, setTabelas] = useState([]);
  const [form, setForm] = useState({ nome: "", descricao: "" });
  const [editando, setEditando] = useState(null);
  const [novoNome, setNovoNome] = useState({});

  const carregarTabelas = async () => {
    const response = await api.get("/tabelas");
    setTabelas(response.data);
  };

  useEffect(() => {
    carregarTabelas();
  }, []);

  const alterar = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const salvarTabela = async (e) => {
    e.preventDefault();

    if (editando) {
      await api.put(`/tabelas/${editando._id}`, form);
      alert("Tabela atualizada com sucesso");
    } else {
      await api.post("/tabelas", form);
      alert("Tabela criada com sucesso");
    }

    setForm({ nome: "", descricao: "" });
    setEditando(null);
    carregarTabelas();
  };

  const editarTabela = (tabela) => {
    setEditando(tabela);
    setForm({
      nome: tabela.nome || "",
      descricao: tabela.descricao || "",
    });
  };

  const cancelarEdicao = () => {
    setEditando(null);
    setForm({ nome: "", descricao: "" });
  };

  const alternarStatus = async (tabela) => {
    await api.put(`/tabelas/${tabela._id}`, {
      ativa: !tabela.ativa,
    });

    carregarTabelas();
  };

  const duplicarTabela = async (tabela) => {
    const nome = novoNome[tabela._id];

    if (!nome) {
      alert("Informe o nome da nova tabela");
      return;
    }

    await api.post(`/tabelas/${tabela._id}/duplicar`, {
      novoNome: nome,
    });

    alert("Tabela duplicada com sucesso");
    setNovoNome({ ...novoNome, [tabela._id]: "" });
    carregarTabelas();
  };

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <h1>Tabelas de Preço</h1>

        <div className={styles.content}>
          <form className={styles.form} onSubmit={salvarTabela}>
            <h2>{editando ? "Editar Tabela" : "Nova Tabela"}</h2>

            <input
              name="nome"
              placeholder="Nome. Ex: Distribuidor 2026"
              value={form.nome}
              onChange={alterar}
              required
            />

            <textarea
              name="descricao"
              placeholder="Descrição"
              value={form.descricao}
              onChange={alterar}
            />

            <button type="submit">
              {editando ? "Salvar Alterações" : "Criar Tabela"}
            </button>

            {editando && (
              <button
                type="button"
                className={styles.cancelar}
                onClick={cancelarEdicao}
              >
                Cancelar edição
              </button>
            )}
          </form>

          <div className={styles.lista}>
            <h2>Tabelas Cadastradas</h2>

            {tabelas.map((tabela) => (
              <div className={styles.card} key={tabela._id}>
                <div className={styles.info}>
                  <h3>{tabela.nome}</h3>
                  <p>{tabela.descricao || "Sem descrição"}</p>
                  <span className={tabela.ativa ? styles.ativa : styles.inativa}>
                    {tabela.ativa ? "Ativa" : "Inativa"}
                  </span>
                </div>

                <div className={styles.acoes}>
                  <button onClick={() => editarTabela(tabela)}>
                    Editar
                  </button>

                  <button onClick={() => alternarStatus(tabela)}>
                    {tabela.ativa ? "Inativar" : "Ativar"}
                  </button>

                  <input
                    placeholder="Nome da cópia"
                    value={novoNome[tabela._id] || ""}
                    onChange={(e) =>
                      setNovoNome({
                        ...novoNome,
                        [tabela._id]: e.target.value,
                      })
                    }
                  />

                  <button onClick={() => duplicarTabela(tabela)}>
                    Duplicar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default AdminTabelas;