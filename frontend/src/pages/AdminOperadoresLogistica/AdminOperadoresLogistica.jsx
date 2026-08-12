import { useCallback, useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./AdminOperadoresLogistica.module.css";

function AdminOperadoresLogistica() {
  const [operators, setOperators] = useState([]);
  const [names, setNames] = useState({});
  const [newOperator, setNewOperator] = useState({ nome: "", pin: "" });
  const [pinResets, setPinResets] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState(null);

  const loadOperators = useCallback(async () => {
    const response = await api.get("/admin/operadores-logistica");
    const nextOperators = response.data || [];
    setOperators(nextOperators);
    setNames(Object.fromEntries(nextOperators.map((operator) => [operator._id, operator.nome])));
  }, []);

  useEffect(() => {
    let active = true;
    api.get("/admin/operadores-logistica")
      .then((response) => {
        if (!active) return;
        const nextOperators = response.data || [];
        setOperators(nextOperators);
        setNames(Object.fromEntries(nextOperators.map((operator) => [operator._id, operator.nome])));
      })
      .catch((error) => {
        if (active) setFeedback({
          type: "error",
          message: error.response?.data?.message || "Não foi possível carregar os operadores.",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const createOperator = async (event) => {
    event.preventDefault();
    setBusy("create");
    setFeedback(null);
    try {
      const response = await api.post("/admin/operadores-logistica", newOperator);
      setNewOperator({ nome: "", pin: "" });
      setFeedback({ type: "success", message: response.data.message });
      await loadOperators();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.response?.data?.message || "Não foi possível cadastrar o operador.",
      });
    } finally {
      setBusy("");
    }
  };

  const updateOperator = async (operator, updates, action) => {
    setBusy(`${action}-${operator._id}`);
    setFeedback(null);
    try {
      const response = await api.patch(
        `/admin/operadores-logistica/${operator._id}`,
        updates
      );
      setFeedback({ type: "success", message: response.data.message });
      await loadOperators();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.response?.data?.message || "Não foi possível atualizar o operador.",
      });
    } finally {
      setBusy("");
    }
  };

  const resetPin = async (operator) => {
    const pin = pinResets[operator._id] || "";
    setBusy(`pin-${operator._id}`);
    setFeedback(null);
    try {
      const response = await api.patch(
        `/admin/operadores-logistica/${operator._id}/pin`,
        { pin }
      );
      setPinResets((current) => ({ ...current, [operator._id]: "" }));
      setFeedback({ type: "success", message: response.data.message });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.response?.data?.message || "Não foi possível redefinir o PIN.",
      });
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.header}>
          <span>Logística</span>
          <h1>Operadores</h1>
          <p>Gerencie as identidades operacionais usadas na conta compartilhada da Logística.</p>
        </header>

        {feedback && (
          <div className={styles.feedback} data-type={feedback.type} role="status">
            {feedback.message}
          </div>
        )}

        <section className={styles.createPanel} aria-labelledby="new-operator-title">
          <div>
            <h2 id="new-operator-title">Cadastrar operador</h2>
            <p>O PIN é armazenado somente em formato protegido.</p>
          </div>
          <form onSubmit={createOperator}>
            <label>
              Nome
              <input
                type="text"
                maxLength="120"
                value={newOperator.nome}
                onChange={(event) => setNewOperator((current) => ({
                  ...current,
                  nome: event.target.value,
                }))}
                required
              />
            </label>
            <label>
              PIN inicial
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]{4,6}"
                minLength="4"
                maxLength="6"
                value={newOperator.pin}
                onChange={(event) => setNewOperator((current) => ({
                  ...current,
                  pin: event.target.value.replace(/\D/g, "").slice(0, 6),
                }))}
                required
              />
            </label>
            <button type="submit" disabled={busy === "create"}>
              {busy === "create" ? "Cadastrando..." : "Cadastrar operador"}
            </button>
          </form>
        </section>

        <section className={styles.listSection} aria-labelledby="operator-list-title">
          <div className={styles.listHeader}>
            <div>
              <h2 id="operator-list-title">Operadores cadastrados</h2>
              <p>{operators.filter((operator) => operator.ativo).length} ativos de {operators.length}</p>
            </div>
          </div>

          {loading && <div className={styles.empty}>Carregando operadores...</div>}
          {!loading && operators.length === 0 && (
            <div className={styles.empty}>Nenhum operador cadastrado.</div>
          )}

          <div className={styles.operatorList}>
            {operators.map((operator) => (
              <article className={styles.operatorCard} key={operator._id} data-active={operator.ativo}>
                <div className={styles.operatorHeading}>
                  <div>
                    <strong>{operator.nome}</strong>
                    <span>{operator.ativo ? "Ativo" : "Inativo"}</span>
                  </div>
                  <button
                    type="button"
                    className={operator.ativo ? styles.deactivateButton : styles.activateButton}
                    disabled={busy === `status-${operator._id}`}
                    onClick={() => updateOperator(
                      operator,
                      { ativo: !operator.ativo },
                      "status"
                    )}
                  >
                    {operator.ativo ? "Desativar" : "Ativar"}
                  </button>
                </div>

                <div className={styles.editGrid}>
                  <label>
                    Nome do operador
                    <div className={styles.inlineControl}>
                      <input
                        type="text"
                        maxLength="120"
                        value={names[operator._id] || ""}
                        onChange={(event) => setNames((current) => ({
                          ...current,
                          [operator._id]: event.target.value,
                        }))}
                      />
                      <button
                        type="button"
                        disabled={
                          busy === `name-${operator._id}` ||
                          names[operator._id]?.trim() === operator.nome
                        }
                        onClick={() => updateOperator(
                          operator,
                          { nome: names[operator._id] },
                          "name"
                        )}
                      >
                        Salvar nome
                      </button>
                    </div>
                  </label>

                  <label>
                    Redefinir PIN
                    <div className={styles.inlineControl}>
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="new-password"
                        aria-label={`Novo PIN de ${operator.nome}`}
                        placeholder="4 a 6 dígitos"
                        pattern="[0-9]{4,6}"
                        minLength="4"
                        maxLength="6"
                        value={pinResets[operator._id] || ""}
                        onChange={(event) => setPinResets((current) => ({
                          ...current,
                          [operator._id]: event.target.value.replace(/\D/g, "").slice(0, 6),
                        }))}
                      />
                      <button
                        type="button"
                        disabled={
                          busy === `pin-${operator._id}` ||
                          (pinResets[operator._id] || "").length < 4
                        }
                        onClick={() => resetPin(operator)}
                      >
                        Redefinir PIN
                      </button>
                    </div>
                  </label>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

export default AdminOperadoresLogistica;
