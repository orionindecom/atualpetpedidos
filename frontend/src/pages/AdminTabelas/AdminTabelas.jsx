import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import { useFeedback } from "../../components/Feedback/feedbackContext";
import { getApiErrorMessage } from "../../utils/apiErrors";
import styles from "./AdminTabelas.module.css";

function AdminTabelas() {
  const [tabelas, setTabelas] = useState([]);
  const [form, setForm] = useState({
    nome: "",
    descricao: "",
    tipo: "distribuidor",
  });
  const [editando, setEditando] = useState(null);
  const [novoNome, setNovoNome] = useState({});
  const [errosCopia, setErrosCopia] = useState({});
  const [ocupado, setOcupado] = useState("");
  const { toast } = useFeedback();

  const tiposTabela = {
    distribuidor: "Distribuidor",
    cliente_final_internet: "Cliente final internet",
    cliente_final_loja: "Cliente final loja física",
  };

  const carregarTabelas = async () => {
    const response = await api.get("/tabelas");
    setTabelas(response.data);
  };

  useEffect(() => {
    async function carregarTabelasIniciais() {
      const response = await api.get("/tabelas");
      setTabelas(response.data);
    }

    carregarTabelasIniciais();
  }, []);

  const alterar = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const salvarTabela = async (e) => {
    e.preventDefault();
    if (ocupado) return;
    setOcupado("salvar");

    try {
      if (editando) {
        await api.put(`/tabelas/${editando._id}`, form);
        toast.success("Tabela atualizada", { description: `${form.nome} foi salva.` });
      } else {
        await api.post("/tabelas", form);
        toast.success("Tabela criada", { description: `${form.nome} já pode receber preços.` });
      }

      setForm({ nome: "", descricao: "", tipo: "distribuidor" });
      setEditando(null);
      carregarTabelas();
    } catch (error) {
      toast.error("Não foi possível salvar a tabela", {
        description: getApiErrorMessage(error, "Revise os dados e tente novamente."),
      });
    } finally {
      setOcupado("");
    }
  };

  const editarTabela = (tabela) => {
    setEditando(tabela);
    setForm({
      nome: tabela.nome || "",
      descricao: tabela.descricao || "",
      tipo: tabela.tipo || "distribuidor",
    });
  };

  const cancelarEdicao = () => {
    setEditando(null);
    setForm({ nome: "", descricao: "", tipo: "distribuidor" });
  };

  const alternarStatus = async (tabela) => {
    if (ocupado) return;
    setOcupado(tabela._id);
    try {
      await api.put(`/tabelas/${tabela._id}`, {
        ativa: !tabela.ativa,
      });
      toast.success(tabela.ativa ? "Tabela inativada" : "Tabela ativada", { description: tabela.nome });
      carregarTabelas();
    } catch (error) {
      toast.error("Não foi possível alterar a tabela", {
        description: getApiErrorMessage(error, "Tente novamente em instantes."),
      });
    } finally {
      setOcupado("");
    }
  };

  const duplicarTabela = async (tabela) => {
    const nome = novoNome[tabela._id];

    if (!nome?.trim()) {
      setErrosCopia((current) => ({ ...current, [tabela._id]: "Informe o nome da nova tabela." }));
      document.getElementById(`copia-${tabela._id}`)?.focus();
      return;
    }
    if (ocupado) return;
    setOcupado(tabela._id);

    try {
      await api.post(`/tabelas/${tabela._id}/duplicar`, {
        novoNome: nome,
      });
      toast.success("Tabela duplicada", { description: `${nome} foi criada a partir de ${tabela.nome}.` });
      setNovoNome({ ...novoNome, [tabela._id]: "" });
      carregarTabelas();
    } catch (error) {
      toast.error("Não foi possível duplicar a tabela", {
        description: getApiErrorMessage(error, "Tente novamente em instantes."),
      });
    } finally {
      setOcupado("");
    }
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

            <select name="tipo" value={form.tipo} onChange={alterar}>
              <option value="distribuidor">Distribuidor</option>
              <option value="cliente_final_internet">
                Cliente final internet
              </option>
              <option value="cliente_final_loja">
                Cliente final loja física
              </option>
            </select>

            <button type="submit" disabled={ocupado === "salvar"}>
              {ocupado === "salvar" ? "Salvando..." : editando ? "Salvar Alterações" : "Criar Tabela"}
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
                  <span className={styles.tipoTabela}>
                    {tiposTabela[tabela.tipo || "distribuidor"]}
                  </span>
                  <span className={tabela.ativa ? styles.ativa : styles.inativa}>
                    {tabela.ativa ? "Ativa" : "Inativa"}
                  </span>
                </div>
                <div className={styles.acoes}>
                  <button onClick={() => editarTabela(tabela)}>
                    Editar
                  </button>

                  <button
                    className={
                      tabela.ativa
                        ? styles.inativarBtn
                        : styles.ativarBtn
                    }
                    onClick={() => alternarStatus(tabela)}
                    disabled={ocupado === tabela._id}
                  >
                    {tabela.ativa ? "Inativar" : "Ativar"}
                  </button>

                  <input
                    id={`copia-${tabela._id}`}
                    placeholder="Nome da cópia"
                    aria-label={`Nome da cópia de ${tabela.nome}`}
                    aria-invalid={errosCopia[tabela._id] ? "true" : undefined}
                    aria-describedby={errosCopia[tabela._id] ? `copia-erro-${tabela._id}` : undefined}
                    value={novoNome[tabela._id] || ""}
                    onChange={(e) => {
                      setNovoNome({
                        ...novoNome,
                        [tabela._id]: e.target.value,
                      });
                      setErrosCopia((current) => ({ ...current, [tabela._id]: "" }));
                    }}
                  />

                  {errosCopia[tabela._id] && (
                    <span id={`copia-erro-${tabela._id}`} className={styles.erroCampo} role="alert">
                      {errosCopia[tabela._id]}
                    </span>
                  )}

                  <button onClick={() => duplicarTabela(tabela)} disabled={ocupado === tabela._id}>
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
