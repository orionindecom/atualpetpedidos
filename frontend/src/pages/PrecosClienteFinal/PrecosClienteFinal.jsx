import { useEffect, useMemo, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./PrecosClienteFinal.module.css";

const tiposConsulta = [
  {
    value: "cliente_final_internet",
    label: "Cliente final internet",
  },
  {
    value: "cliente_final_loja",
    label: "Cliente final loja física",
  },
];

function PrecosClienteFinal() {
  const [tipo, setTipo] = useState("cliente_final_internet");
  const [dados, setDados] = useState({ tabela: null, produtos: [] });
  const [busca, setBusca] = useState("");
  const [linhaFiltro, setLinhaFiltro] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    async function carregarPrecos() {
      setCarregando(true);
      const response = await api.get(`/catalogo/cliente-final?tipo=${tipo}`);
      setDados(response.data);
      setCarregando(false);
    }

    carregarPrecos();
  }, [tipo]);

  const moeda = (valor) =>
    valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  const linhas = useMemo(
    () => [...new Set(dados.produtos.map((p) => p.linha).filter(Boolean))],
    [dados.produtos]
  );

  const categorias = useMemo(
    () => [...new Set(dados.produtos.map((p) => p.categoria).filter(Boolean))],
    [dados.produtos]
  );

  const produtosFiltrados = dados.produtos.filter((produto) => {
    const combinaBusca = produto.nome
      .toLowerCase()
      .includes(busca.toLowerCase());
    const combinaLinha = linhaFiltro ? produto.linha === linhaFiltro : true;
    const combinaCategoria = categoriaFiltro
      ? produto.categoria === categoriaFiltro
      : true;

    return combinaBusca && combinaLinha && combinaCategoria;
  });

  return (
    <>
      <Navbar />

      <main className={styles.container}>
        <div className={styles.header}>
          <div>
            <span>Consulta para distribuidores</span>
            <h1>Preços Cliente Final</h1>
            <p>
              Consulte os preços sugeridos sem alterar sua tabela de pedido.
            </p>
          </div>

          <div className={styles.segmented} aria-label="Tipo de preço">
            {tiposConsulta.map((opcao) => (
              <button
                type="button"
                key={opcao.value}
                className={tipo === opcao.value ? styles.ativo : ""}
                onClick={() => setTipo(opcao.value)}
              >
                {opcao.label}
              </button>
            ))}
          </div>
        </div>

        <section className={styles.filtros}>
          <input
            type="text"
            placeholder="Buscar produto..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />

          <select
            value={linhaFiltro}
            onChange={(e) => setLinhaFiltro(e.target.value)}
          >
            <option value="">Todas as linhas</option>
            {linhas.map((linha) => (
              <option key={linha} value={linha}>
                {linha}
              </option>
            ))}
          </select>

          <select
            value={categoriaFiltro}
            onChange={(e) => setCategoriaFiltro(e.target.value)}
          >
            <option value="">Todas as categorias</option>
            {categorias.map((categoria) => (
              <option key={categoria} value={categoria}>
                {categoria}
              </option>
            ))}
          </select>
        </section>

        {dados.tabela && (
          <div className={styles.tabelaInfo}>
            <span>Tabela ativa</span>
            <strong>{dados.tabela.nome}</strong>
          </div>
        )}

        {carregando ? (
          <div className={styles.estado}>Carregando preços...</div>
        ) : produtosFiltrados.length === 0 ? (
          <div className={styles.estado}>
            Nenhum preço encontrado para esta consulta.
          </div>
        ) : (
          <div className={styles.grid}>
            {produtosFiltrados.map((produto) => (
              <article className={styles.card} key={produto.id}>
                {produto.fotoUrl && (
                  <img
                    src={produto.fotoUrl}
                    alt={produto.nome}
                    loading="lazy"
                    decoding="async"
                  />
                )}

                <div>
                  <h2>{produto.nome}</h2>
                  <p>{produto.descricao || "Sem descrição cadastrada."}</p>
                  <span>
                    {produto.linha} • {produto.categoria}
                  </span>
                </div>

                <strong>{moeda(produto.preco)}</strong>
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

export default PrecosClienteFinal;
