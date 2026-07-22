import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import {
  appendUniqueMaterials,
  copyMaterialLink,
  normalizeMaterialResponse,
  openMaterialLink,
} from "../../utils/materialMarketing";
import styles from "./MateriaisMarketing.module.css";

const filtrosIniciais = {
  busca: "",
  categoria: "",
  tipo: "",
  marca: "",
  linha: "",
};

const formatarData = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : date.toLocaleDateString("pt-BR");
};

function MateriaisMarketing() {
  const [materiais, setMateriais] = useState([]);
  const [paginacao, setPaginacao] = useState({
    paginaAtual: 1,
    totalItens: 0,
    temProximaPagina: false,
  });
  const [opcoes, setOpcoes] = useState({ categorias: [], tipos: [], marcas: [], linhas: [] });
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [filtrosAplicados, setFiltrosAplicados] = useState(filtrosIniciais);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [copiadoId, setCopiadoId] = useState("");
  const [feedback, setFeedback] = useState("");
  const [imagensComErro, setImagensComErro] = useState(new Set());

  useEffect(() => {
    const controller = new AbortController();
    async function carregar() {
      if (pagina === 1) setCarregando(true);
      else setCarregandoMais(true);
      setErro("");

      try {
        const response = await api.get("/materiais-marketing", {
          params: { ...filtrosAplicados, pagina, limite: 12 },
          signal: controller.signal,
        });
        const normalized = normalizeMaterialResponse(response.data, { pagina, limite: 12 });
        setMateriais((current) =>
          pagina === 1
            ? normalized.materiais
            : appendUniqueMaterials(current, normalized.materiais)
        );
        setPaginacao(normalized.paginacao);
        setOpcoes(normalized.filtros);
      } catch (error) {
        if (error.code !== "ERR_CANCELED") {
          setErro(error.response?.data?.message || "Não foi possível carregar os materiais");
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
    setMateriais([]);
    setFiltrosAplicados({ ...filtros });
  };

  const limparFiltros = () => {
    setFiltros(filtrosIniciais);
    setFiltrosAplicados(filtrosIniciais);
    setPagina(1);
    setMateriais([]);
  };

  const abrir = (material) => {
    if (!openMaterialLink(material.linkExterno)) {
      setFeedback("O link deste material é inválido. Avise a equipe AtualPet.");
    }
  };

  const copiar = async (material) => {
    setFeedback("");
    try {
      const copied = await copyMaterialLink(material.linkExterno);
      if (!copied) throw new Error("Link inválido");
      setCopiadoId(material._id);
      window.setTimeout(() => setCopiadoId(""), 2200);
    } catch {
      setFeedback("Não foi possível copiar o link. Tente abrir o material.");
    }
  };

  const marcarImagemComErro = (id) => {
    setImagensComErro((current) => new Set(current).add(id));
  };

  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.pageHeader}>
          <span>Biblioteca do distribuidor</span>
          <h1>Materiais de Marketing</h1>
          <p>Encontre imagens, campanhas e documentos para apoiar suas vendas.</p>
        </header>

        <form className={styles.filters} onSubmit={aplicarFiltros}>
          <input
            aria-label="Buscar materiais"
            placeholder="Buscar material"
            value={filtros.busca}
            onChange={(event) => setFiltros({ ...filtros, busca: event.target.value })}
          />
          <select aria-label="Filtrar por categoria" value={filtros.categoria} onChange={(event) => setFiltros({ ...filtros, categoria: event.target.value })}>
            <option value="">Todas as categorias</option>
            {opcoes.categorias.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por tipo" value={filtros.tipo} onChange={(event) => setFiltros({ ...filtros, tipo: event.target.value })}>
            <option value="">Todos os tipos</option>
            {opcoes.tipos.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por marca" value={filtros.marca} onChange={(event) => setFiltros({ ...filtros, marca: event.target.value })}>
            <option value="">Todas as marcas</option>
            {opcoes.marcas.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filtrar por linha" value={filtros.linha} onChange={(event) => setFiltros({ ...filtros, linha: event.target.value })}>
            <option value="">Todas as linhas</option>
            {opcoes.linhas.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <div className={styles.filterActions}>
            <button type="submit" className={styles.primaryButton}>Buscar</button>
            <button type="button" className={styles.secondaryButton} onClick={limparFiltros}>Limpar</button>
          </div>
        </form>

        {feedback && <div className={styles.feedback} role="status">{feedback}</div>}

        <div className={styles.resultSummary}>
          <strong>{materiais.length} carregados</strong>
          <span>{paginacao.totalItens} materiais encontrados</span>
        </div>

        {carregando ? (
          <div className={styles.grid} aria-label="Carregando materiais">
            {[1, 2, 3, 4].map((item) => <div key={item} className={styles.skeleton} />)}
          </div>
        ) : erro && materiais.length === 0 ? (
          <div className={styles.stateBox} role="alert">
            <p>{erro}</p>
            <button type="button" className={styles.secondaryButton} onClick={() => setRefreshKey((value) => value + 1)}>Tentar novamente</button>
          </div>
        ) : materiais.length === 0 ? (
          <div className={styles.stateBox}>
            <h2>Nenhum material encontrado</h2>
            <p>Experimente limpar os filtros ou buscar outro termo.</p>
          </div>
        ) : (
          <section className={styles.grid} aria-label="Materiais disponíveis">
            {materiais.map((material) => (
              <article className={styles.card} key={material._id}>
                <div className={styles.cover}>
                  {material.imagemCapaUrl && !imagensComErro.has(material._id) ? (
                    <img
                      src={material.imagemCapaUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={() => marcarImagemComErro(material._id)}
                    />
                  ) : (
                    <div className={styles.placeholder}>
                      <span>{material.tipo || "Material"}</span>
                      <strong>AtualPet</strong>
                    </div>
                  )}
                  {material.destaque && <span className={styles.featured}>Destaque</span>}
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.tags}>
                    <span>{material.categoria}</span>
                    <span>{material.tipo}</span>
                  </div>
                  <h2>{material.titulo}</h2>
                  <p>{material.descricao || "Material disponibilizado pela equipe AtualPet."}</p>
                  {(material.marca || material.linha) && (
                    <strong className={styles.brandLine}>
                      {[material.marca, material.linha].filter(Boolean).join(" • ")}
                    </strong>
                  )}
                  <time dateTime={material.createdAt}>Publicado em {formatarData(material.createdAt)}</time>
                </div>

                <footer className={styles.cardActions}>
                  <button type="button" className={styles.primaryButton} onClick={() => abrir(material)}>
                    Abrir material
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => copiar(material)}>
                    {copiadoId === material._id ? "Link copiado" : "Copiar link"}
                  </button>
                </footer>
              </article>
            ))}
          </section>
        )}

        {erro && materiais.length > 0 && <div className={styles.feedback} role="alert">{erro}</div>}

        {paginacao.temProximaPagina && (
          <div className={styles.loadMore}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={carregandoMais}
              onClick={() => setPagina((value) => value + 1)}
            >
              {carregandoMais ? "Carregando..." : "Mostrar mais"}
            </button>
          </div>
        )}
      </main>
    </>
  );
}

export default MateriaisMarketing;
