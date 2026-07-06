import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./AdminProdutos.module.css";

function AdminProdutos() {
  const [produtos, setProdutos] = useState([]);
  const [produtoEditando, setProdutoEditando] = useState(null);
  const [foto, setFoto] = useState(null);

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

        alert("Produto atualizado com sucesso");
      } else {
        await api.post("/produtos", formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        alert("Produto cadastrado com sucesso");
      }

      limparFormulario();
      carregarProdutos();
    } catch (error) {
      alert(error.response?.data?.message || "Erro ao salvar produto");
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

  const inativarProduto = async (produtoId) => {
    const confirmar = confirm("Deseja realmente inativar este produto?");

    if (!confirmar) return;

    try {
      await api.delete(`/produtos/${produtoId}`);

      alert("Produto inativado com sucesso");
      carregarProdutos();
    } catch (error) {
      alert(error.response?.data?.message || "Erro ao inativar produto");
    }
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

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <h1>Produtos</h1>

        <div className={styles.content}>
          <form className={styles.form} onSubmit={salvarProduto}>
            <h2>{produtoEditando ? "Editar Produto" : "Novo Produto"}</h2>

            <input
              name="nome"
              placeholder="Nome do produto"
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

            <input
              name="linha"
              placeholder="Linha. Ex: Dream Color"
              value={form.linha}
              onChange={alterar}
              required
            />

            <input
              name="categoria"
              placeholder="Categoria. Ex: Shampoo"
              value={form.categoria}
              onChange={alterar}
              required
            />

            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFoto(e.target.files[0])}
            />

            <button type="submit">
              {produtoEditando ? "Salvar Alterações" : "Cadastrar Produto"}
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
          </form>

          <div className={styles.lista}>
            <h2>Produtos Cadastrados</h2>

            <div className={styles.filtros}>
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
            </div>

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
                    onClick={() => inativarProduto(produto._id)}
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
