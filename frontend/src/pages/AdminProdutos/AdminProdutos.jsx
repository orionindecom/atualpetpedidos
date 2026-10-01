import { useEffect, useState } from "react";
import api from "../../api/axios";
import { FilterToolbar } from "../../components/ListControls/ListControls";
import Navbar from "../../components/Navbar/Navbar";
import { useFeedback } from "../../components/Feedback/feedbackContext";
import { getApiErrorMessage } from "../../utils/apiErrors";
import styles from "./AdminProdutos.module.css";

const DESCRICAO_PRODUTO_MAX_LENGTH = 300;

function AdminProdutos() {
  const [produtos, setProdutos] = useState([]);
  const [produtoEditando, setProdutoEditando] = useState(null);
  const [foto, setFoto] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erroDescricao, setErroDescricao] = useState("");
  const { dialog, toast } = useFeedback();

  const [busca, setBusca] = useState("");
  const [linhaFiltro, setLinhaFiltro] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");

  const [form, setForm] = useState({
    nome: "",
    descricao: "",
    linha: "",
    categoria: "",
  });

  const carregarProdutos = async () => {
    const response = await api.get("/produtos");
    setProdutos(response.data);
  };

  useEffect(() => {
    async function carregarProdutosIniciais() {
      const response = await api.get("/produtos");
      setProdutos(response.data);
    }

    carregarProdutosIniciais();
  }, []);

  const alterar = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const limparFormulario = () => {
    setForm({
      nome: "",
      descricao: "",
      linha: "",
      categoria: "",
    });

    setFoto(null);
    setProdutoEditando(null);
  };

  const salvarProduto = async (e) => {
    e.preventDefault();

    if (form.descricao.length > DESCRICAO_PRODUTO_MAX_LENGTH) {
      setErroDescricao(`A descrição deve ter no máximo ${DESCRICAO_PRODUTO_MAX_LENGTH} caracteres.`);
      e.currentTarget.elements.namedItem("descricao")?.focus();
      return;
    }
    if (salvando) return;
    setErroDescricao("");
    setSalvando(true);

    try {
      const formData = new FormData();

      formData.append("nome", form.nome);
      formData.append("descricao", form.descricao);
      formData.append("linha", form.linha);
      formData.append("categoria", form.categoria);

      if (foto) {
        formData.append("foto", foto);
      }

      if (produtoEditando) {
        await api.put(`/produtos/${produtoEditando._id}`, formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        toast.success("Produto atualizado", { description: `${form.nome} foi salvo.` });
      } else {
        await api.post("/produtos", formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        toast.success("Produto cadastrado", { description: `${form.nome} já está disponível no catálogo administrativo.` });
      }

      limparFormulario();
      carregarProdutos();
    } catch (error) {
      toast.error("Não foi possível salvar o produto", {
        description: getApiErrorMessage(error, "Revise os dados e tente novamente."),
      });
    } finally {
      setSalvando(false);
    }
  };

  const editarProduto = (produto) => {
    setProdutoEditando(produto);

    setForm({
      nome: produto.nome || "",
      descricao: produto.descricao || "",
      linha: produto.linha || "",
      categoria: produto.categoria || "",
    });

    setFoto(null);
  };

  const inativarProduto = async (produto) => {
    const inativado = await dialog.confirm({
      variant: "warning",
      icon: "archive",
      title: "Inativar produto?",
      message: "O produto será marcado como inativo. O cadastro não é apagado.",
      details: [{ label: "Produto", value: produto.nome }],
      confirmLabel: "Inativar produto",
      busyLabel: "Inativando...",
      errorFallback: "Não foi possível inativar o produto.",
      action: () => api.delete(`/produtos/${produto._id}`),
      successToast: { title: "Produto inativado", description: `${produto.nome} foi inativado.` },
    });
    if (inativado) carregarProdutos();
  };

  const linhas = [...new Set(produtos.map((p) => p.linha).filter(Boolean))];

  const categorias = [
    ...new Set(produtos.map((p) => p.categoria).filter(Boolean)),
  ];

  const produtosFiltrados = produtos.filter((produto) => {
    const combinaBusca = produto.nome
      .toLowerCase()
      .includes(busca.toLowerCase());

    const combinaLinha = linhaFiltro ? produto.linha === linhaFiltro : true;

    const combinaCategoria = categoriaFiltro
      ? produto.categoria === categoriaFiltro
      : true;

    return combinaBusca && combinaLinha && combinaCategoria;
  });

  const aplicarFiltros = (event) => event.preventDefault();
  const limparFiltros = () => {
    setBusca("");
    setLinhaFiltro("");
    setCategoriaFiltro("");
  };

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <h1>Produtos</h1>

        <div className={styles.content}>
          <form className={styles.form} onSubmit={salvarProduto}>
            <h2>{produtoEditando ? "Editar Produto" : "Novo Produto"}</h2>

            <label className={styles.field}>
              Nome do produto
              <input
                name="nome"
                placeholder="Nome do produto"
                value={form.nome}
                onChange={alterar}
                required
              />
            </label>

            <label className={styles.field}>
              Descrição
              <textarea
                name="descricao"
                placeholder="Descrição"
                value={form.descricao}
                onChange={alterar}
                maxLength={DESCRICAO_PRODUTO_MAX_LENGTH}
                aria-invalid={erroDescricao ? "true" : undefined}
                aria-describedby={erroDescricao ? "produto-descricao-erro" : undefined}
              />
            </label>
            <span className={styles.contadorDescricao}>
              {form.descricao.length} / {DESCRICAO_PRODUTO_MAX_LENGTH}
            </span>
            {erroDescricao && <span id="produto-descricao-erro" className={styles.erroCampo} role="alert">{erroDescricao}</span>}

            <label className={`${styles.field} ${styles.halfField}`}>
              Linha
              <input
                name="linha"
                placeholder="Linha. Ex: Dream Color"
                value={form.linha}
                onChange={alterar}
                required
              />
            </label>

            <label className={`${styles.field} ${styles.halfField}`}>
              Categoria
              <input
                name="categoria"
                placeholder="Categoria. Ex: Shampoo"
                value={form.categoria}
                onChange={alterar}
                required
              />
            </label>

            <label className={styles.field}>
              Imagem do produto
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFoto(e.target.files[0])}
              />
            </label>

            <div className={styles.formActions}>
              <button type="submit" disabled={salvando}>
                {salvando ? "Salvando..." : produtoEditando ? "Salvar Alterações" : "Cadastrar Produto"}
              </button>

              {produtoEditando && (
                <button
                  type="button"
                  className={styles.cancelar}
                  onClick={limparFormulario}
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </form>

          <div className={styles.lista}>
            <h2>Produtos Cadastrados</h2>

            <FilterToolbar
              layout="stacked"
              activeFilterCount={[linhaFiltro, categoriaFiltro].filter(Boolean).length}
              searchLabel="Buscar produtos cadastrados"
              searchPlaceholder="Buscar por produto, linha ou categoria..."
              searchValue={busca}
              onSearchChange={(event) => setBusca(event.target.value)}
              onSubmit={aplicarFiltros}
              onClear={limparFiltros}
            >
              <select
                aria-label="Filtrar por linha"
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
                aria-label="Filtrar por categoria"
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
            </FilterToolbar>

            {produtosFiltrados.map((produto) => (
              <div className={styles.card} key={produto._id}>
                {produto.fotoUrl && (
                  <img src={produto.fotoUrl} alt={produto.nome} />
                )}

                <div className={styles.info}>
                  <h3>{produto.nome}</h3>
                  <p>{produto.descricao}</p>
                  <span>
                    {produto.linha} • {produto.categoria}
                  </span>
                </div>

                <div className={styles.acoes}>
                  <button
                    className={styles.editar}
                    onClick={() => editarProduto(produto)}
                  >
                    Editar
                  </button>

                  <button
                    className={styles.inativar}
                    onClick={() => inativarProduto(produto)}
                  >
                    Inativar
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

export default AdminProdutos;
