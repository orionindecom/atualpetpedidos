import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/axios";
import {
  FilterToolbar,
  LoadMoreButton,
} from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import {
  appendUniqueTrainings,
  clampProgress,
  formatTrainingDuration,
  getTrainingProgressState,
  normalizeTrainingResponse,
} from "../../utils/training";
import styles from "./Treinamentos.module.css";

const filtrosIniciais = {
  busca: "",
  categoria: "",
  marca: "",
  linha: "",
  destaque: "",
  obrigatorio: "",
  statusProgresso: "",
};

function Treinamentos() {
  const navigate = useNavigate();
  const [treinamentos, setTreinamentos] = useState([]);
  const [paginacao, setPaginacao] = useState({ totalItens: 0, temProximaPagina: false });
  const [opcoes, setOpcoes] = useState({ categorias: [], marcas: [], linhas: [] });
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [filtrosAplicados, setFiltrosAplicados] = useState(filtrosIniciais);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [imagensComErro, setImagensComErro] = useState(new Set());

  const filtrosAtivos = Object.entries(filtrosAplicados).filter(
    ([key, value]) => key !== "busca" && Boolean(value)
  ).length;

  useEffect(() => {
    const controller = new AbortController();
    async function carregar() {
      if (pagina === 1) setCarregando(true);
      else setCarregandoMais(true);
      setErro("");

      try {
        const response = await api.get("/treinamentos", {
          params: { ...filtrosAplicados, pagina, limite: 12 },
          signal: controller.signal,
        });
        const normalized = normalizeTrainingResponse(response.data, { pagina, limite: 12 });
        setTreinamentos((current) =>
          pagina === 1
            ? normalized.treinamentos
            : appendUniqueTrainings(current, normalized.treinamentos)
        );
        setPaginacao(normalized.paginacao);
        setOpcoes(normalized.filtros);
      } catch (error) {
        if (error.code !== "ERR_CANCELED") {
          setErro(error.response?.data?.message || "Não foi possível carregar os treinamentos");
        }
      } finally {
        if (!controller.signal.aborted) {
          setCarregando(false);
          setCarregandoMais(false);
        }
      }
    }
    carregar();
    return () => controller.abort();
  }, [filtrosAplicados, pagina, refreshKey]);

  const aplicarFiltros = (event) => {
    event.preventDefault();
    setPagina(1);
    setTreinamentos([]);
    setFiltrosAplicados({ ...filtros });
  };

  const limparFiltros = () => {
    setFiltros(filtrosIniciais);
    setFiltrosAplicados(filtrosIniciais);
    setPagina(1);
    setTreinamentos([]);
  };

  const aplicarAtalho = (changes) => {
    const next = { ...filtrosIniciais, ...changes };
    setFiltros(next);
    setFiltrosAplicados(next);
    setPagina(1);
    setTreinamentos([]);
  };

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <PageHeader
          eyebrow="Portal do distribuidor"
          title="Treinamentos"
          description="Conteúdos exclusivos para capacitação comercial e técnica."
        />

        <nav className={styles.quickFilters} aria-label="Atalhos de treinamento">
          <button type="button" aria-pressed={Object.values(filtrosAplicados).every((value) => !value)} onClick={() => aplicarAtalho({})}>Todos</button>
          <button type="button" aria-pressed={filtrosAplicados.obrigatorio === "true"} onClick={() => aplicarAtalho({ obrigatorio: "true" })}>Obrigatórios</button>
          <button type="button" aria-pressed={filtrosAplicados.statusProgresso === "em_andamento"} onClick={() => aplicarAtalho({ statusProgresso: "em_andamento" })}>Continuar assistindo</button>
          <button type="button" aria-pressed={filtrosAplicados.statusProgresso === "concluido"} onClick={() => aplicarAtalho({ statusProgresso: "concluido" })}>Concluídos</button>
          <button type="button" aria-pressed={filtrosAplicados.destaque === "true"} onClick={() => aplicarAtalho({ destaque: "true" })}>Destaques</button>
        </nav>

        <FilterToolbar
          activeFilterCount={filtrosAtivos}
          searchLabel="Buscar treinamentos"
          searchPlaceholder="Buscar por título, linha ou categoria..."
          searchValue={filtros.busca}
          onSearchChange={(event) => setFiltros({ ...filtros, busca: event.target.value })}
          onSubmit={aplicarFiltros}
          onClear={limparFiltros}
        >
          <select aria-label="Filtrar por categoria" value={filtros.categoria} onChange={(event) => setFiltros({ ...filtros, categoria: event.target.value })}>
            <option value="">Todas as categorias</option>
            {opcoes.categorias.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por marca" value={filtros.marca} onChange={(event) => setFiltros({ ...filtros, marca: event.target.value })}>
            <option value="">Todas as marcas</option>
            {opcoes.marcas.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por linha" value={filtros.linha} onChange={(event) => setFiltros({ ...filtros, linha: event.target.value })}>
            <option value="">Todas as linhas</option>
            {opcoes.linhas.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por progresso" value={filtros.statusProgresso} onChange={(event) => setFiltros({ ...filtros, statusProgresso: event.target.value })}>
            <option value="">Todos os progressos</option>
            <option value="nao_iniciado">Não iniciados</option>
            <option value="em_andamento">Em andamento</option>
            <option value="concluido">Concluídos</option>
          </select>
        </FilterToolbar>

        <div className={styles.resultSummary}>
          <strong>{treinamentos.length} carregados</strong>
          <span>{paginacao.totalItens} treinamentos encontrados</span>
        </div>

        {carregando ? (
          <div className={styles.grid} aria-label="Carregando treinamentos">
            {[1, 2, 3, 4].map((item) => <div key={item} className={styles.skeleton} />)}
          </div>
        ) : erro && treinamentos.length === 0 ? (
          <div className={styles.stateBox} role="alert">
            <p>{erro}</p>
            <button type="button" className={styles.secondaryButton} onClick={() => setRefreshKey((value) => value + 1)}>Tentar novamente</button>
          </div>
        ) : treinamentos.length === 0 ? (
          <div className={styles.stateBox}>
            <h2>Nenhum treinamento encontrado</h2>
            <p>Ajuste os filtros para encontrar outros conteúdos.</p>
          </div>
        ) : (
          <section className={styles.grid} aria-label="Treinamentos disponíveis">
            {treinamentos.map((training) => {
              const progress = clampProgress(training.progresso?.percentualAssistido);
              const state = getTrainingProgressState(training.progresso);
              const id = training.id || training._id;
              return (
                <article className={styles.card} key={id}>
                  <div className={styles.cover}>
                    {training.thumbnailUrl && !imagensComErro.has(id) ? (
                      <img
                        src={training.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable="false"
                        onError={() => setImagensComErro((current) => new Set(current).add(id))}
                      />
                    ) : (
                      <div className={styles.placeholder}><span>Treinamento</span><strong>AtualPet</strong></div>
                    )}
                  </div>

                  <div className={styles.cardBody}>
                    <div className={styles.cardMetaTop}>
                      <span className={styles.category}>{training.categoria}</span>
                      <span className={styles.flags}>
                        {training.destaque && <span>Destaque</span>}
                        {training.obrigatorio && <strong>Obrigatório</strong>}
                      </span>
                    </div>
                    <h2>{training.titulo}</h2>
                    <p>{training.resumo || "Conteúdo disponibilizado pela equipe AtualPet."}</p>
                    <div className={styles.metadata}>
                      <span>{[training.marca, training.linha].filter(Boolean).join(" • ") || "AtualPet"}</span>
                      <span>{training.instrutor || "Equipe AtualPet"} • {formatTrainingDuration(training.duracaoSegundos)}</span>
                    </div>
                    <div className={styles.progressHeader}>
                      <strong>{state.label}</strong>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div className={styles.progressTrack} role="progressbar" aria-label={`Progresso de ${training.titulo}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}>
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <footer className={styles.cardActions}>
                    <button type="button" className={styles.primaryButton} onClick={() => navigate(`/treinamentos/${id}`)}>
                      {state.action}
                    </button>
                  </footer>
                </article>
              );
            })}
          </section>
        )}

        {erro && treinamentos.length > 0 && <div className={styles.feedback} role="alert">{erro}</div>}

        {paginacao.temProximaPagina && (
          <LoadMoreButton
            loading={carregandoMais}
            onClick={() => setPagina((value) => value + 1)}
          />
        )}
      </main>
    </>
  );
}

export default Treinamentos;
