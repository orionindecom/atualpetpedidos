import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./AdminPedidos.module.css";

function AdminPedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [produtos, setProdutos] = useState([]);

  const [statusSelecionado, setStatusSelecionado] = useState({});
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");

  const [pedidoEditando, setPedidoEditando] = useState(null);
  const [itensEditados, setItensEditados] = useState({});
  const [produtoNovo, setProdutoNovo] = useState({});
  const [quantidadeNova, setQuantidadeNova] = useState({});

  const statusOptions = [
    "novo",
    "em_analise",
    "separando",
    "faturado",
    "enviado",
    "entregue",
    "cancelado",
  ];

  const carregarDados = async () => {
    const pedidosResponse = await api.get("/pedidos");
    const produtosResponse = await api.get("/produtos");

    setPedidos(pedidosResponse.data);
    setProdutos(produtosResponse.data);
  };

  useEffect(() => {
    carregarDados();
  }, []);

  const moeda = (valor) =>
    valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  const data = (pedido) => {
    const dia = String(pedido.dia).padStart(2, "0");
    const mes = String(pedido.mes).padStart(2, "0");
    return `${dia}/${mes}/${pedido.ano}`;
  };

  const formatarStatus = (status) => {
    const nomes = {
      novo: "Novo",
      em_analise: "Em análise",
      separando: "Separando",
      faturado: "Faturado",
      enviado: "Enviado",
      entregue: "Entregue",
      cancelado: "Cancelado",
    };

    return nomes[status] || status;
  };

  const baixarPdf = async (pedidoId) => {
    try {
      const response = await api.get(`/pedidos/${pedidoId}/pdf`, {
        responseType: "blob",
      });

      const fileURL = window.URL.createObjectURL(
        new Blob([response.data], { type: "application/pdf" })
      );

      window.open(fileURL, "_blank");
    } catch (error) {
      console.error(error);
      alert("Erro ao baixar PDF");
    }
  };

  const alterarStatus = async (pedidoId, status) => {
    try {
      await api.put(`/pedidos/${pedidoId}/status`, {
        status,
      });

      carregarDados();
    } catch (error) {
      console.error(error);
      alert("Erro ao atualizar status");
    }
  };

  const iniciarEdicao = (pedido) => {
    setPedidoEditando(pedido._id);

    const mapa = {};

    pedido.itens.forEach((item) => {
      mapa[item.produtoId] = item.quantidade;
    });

    setItensEditados(mapa);
  };

  const alterarQuantidadeItem = (produtoId, quantidade) => {
    setItensEditados({
      ...itensEditados,
      [produtoId]: quantidade,
    });
  };

  const adicionarItemAoPedido = (pedido) => {
    const produtoId = produtoNovo[pedido._id];
    const quantidade = Number(quantidadeNova[pedido._id]);

    if (!produtoId || !quantidade || quantidade <= 0) {
      alert("Selecione um produto e informe uma quantidade");
      return;
    }

    const produto = produtos.find((p) => p._id === produtoId);

    if (!produto) {
      alert("Produto não encontrado");
      return;
    }

    const itemExiste = pedido.itens.find(
      (item) => String(item.produtoId) === String(produtoId)
    );

    if (itemExiste) {
      setItensEditados({
        ...itensEditados,
        [produtoId]:
          Number(itensEditados[produtoId] || itemExiste.quantidade) +
          quantidade,
      });
    } else {
      pedido.itens.push({
        produtoId,
        nomeProduto: produto.nome,
        quantidade,
        valorUnitario: 0,
        subtotal: 0,
      });

      setItensEditados({
        ...itensEditados,
        [produtoId]: quantidade,
      });
    }

    setProdutoNovo({
      ...produtoNovo,
      [pedido._id]: "",
    });

    setQuantidadeNova({
      ...quantidadeNova,
      [pedido._id]: "",
    });
  };

  const salvarEdicaoPedido = async (pedido) => {
    const itens = pedido.itens
      .map((item) => ({
        produtoId: item.produtoId,
        quantidade: Number(itensEditados[item.produtoId]),
      }))
      .filter((item) => item.quantidade > 0);

    if (itens.length === 0) {
      alert("O pedido precisa ter pelo menos um item");
      return;
    }

    try {
      await api.put(`/pedidos/${pedido._id}`, {
        itens,
        observacao: pedido.observacao || "",
      });

      alert("Pedido atualizado com sucesso");

      setPedidoEditando(null);
      setItensEditados({});
      setProdutoNovo({});
      setQuantidadeNova({});

      carregarDados();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "Erro ao atualizar pedido");
    }
  };

  const excluirPedido = async (pedidoId) => {
    const confirmar = confirm(
      "Deseja realmente excluir este pedido? Essa ação não pode ser desfeita."
    );

    if (!confirmar) return;

    try {
      await api.delete(`/pedidos/${pedidoId}`);

      alert("Pedido excluído com sucesso");
      carregarDados();
    } catch (error) {
      console.error(error);
      alert(error.response?.data?.message || "Erro ao excluir pedido");
    }
  };

  const pedidosFiltrados = pedidos.filter((pedido) => {
    const textoBusca = busca.toLowerCase();

    const combinaBusca =
      pedido.numeroPedido?.toLowerCase().includes(textoBusca) ||
      pedido.nomeFantasiaCliente?.toLowerCase().includes(textoBusca) ||
      pedido.razaoSocialCliente?.toLowerCase().includes(textoBusca);

    const combinaStatus = statusFiltro ? pedido.status === statusFiltro : true;

    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <Navbar />

      <div className={styles.container}>
        <h1>Pedidos</h1>

        {pedidos.length === 0 && <p>Nenhum pedido encontrado.</p>}

        <div className={styles.filtros}>
          <input
            type="text"
            placeholder="Buscar pedido ou cliente..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />

          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
          >
            <option value="">Todos os status</option>

            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {formatarStatus(status)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.lista}>
          {pedidosFiltrados.map((pedido) => (
            <div className={styles.card} key={pedido._id}>
              <div>
                <h3>{pedido.numeroPedido}</h3>
                <p>Cliente: {pedido.nomeFantasiaCliente || "-"}</p>
                <p>Razão Social: {pedido.razaoSocialCliente || "-"}</p>
                <p>CNPJ: {pedido.cnpjCliente || "-"}</p>
                <p>Data: {data(pedido)}</p>

                <div className={styles.statusBox}>
                  <label>Status:</label>

                  <select
                    value={statusSelecionado[pedido._id] || pedido.status}
                    onChange={(e) =>
                      setStatusSelecionado({
                        ...statusSelecionado,
                        [pedido._id]: e.target.value,
                      })
                    }
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {formatarStatus(status)}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() =>
                      alterarStatus(
                        pedido._id,
                        statusSelecionado[pedido._id] || pedido.status
                      )
                    }
                  >
                    Salvar Status
                  </button>
                </div>

                <strong>Total: {moeda(pedido.valorTotal)}</strong>

                {pedidoEditando === pedido._id && (
                  <div className={styles.edicaoPedido}>
                    <h4>Editar itens</h4>

                    {pedido.itens.map((item) => (
                      <div className={styles.itemEdicao} key={item.produtoId}>
                        <div>
                          <strong>{item.nomeProduto}</strong>
                          <span>Unitário: {moeda(item.valorUnitario)}</span>
                        </div>

                        <div className={styles.itemAcoes}>
                          <input
                            type="number"
                            min="0"
                            value={itensEditados[item.produtoId] || ""}
                            onChange={(e) =>
                              alterarQuantidadeItem(
                                item.produtoId,
                                e.target.value
                              )
                            }
                          />

                          <button
                            type="button"
                            className={styles.removerItem}
                            onClick={() =>
                              alterarQuantidadeItem(item.produtoId, 0)
                            }
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className={styles.adicionarItem}>
                      <h4>Adicionar item</h4>

                      <select
                        value={produtoNovo[pedido._id] || ""}
                        onChange={(e) =>
                          setProdutoNovo({
                            ...produtoNovo,
                            [pedido._id]: e.target.value,
                          })
                        }
                      >
                        <option value="">Selecione um produto</option>

                        {produtos.map((produto) => (
                          <option key={produto._id} value={produto._id}>
                            {produto.nome}
                          </option>
                        ))}
                      </select>

                      <input
                        type="number"
                        min="1"
                        placeholder="Qtd"
                        value={quantidadeNova[pedido._id] || ""}
                        onChange={(e) =>
                          setQuantidadeNova({
                            ...quantidadeNova,
                            [pedido._id]: e.target.value,
                          })
                        }
                      />

                      <button
                        type="button"
                        onClick={() => adicionarItemAoPedido(pedido)}
                      >
                        Adicionar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.acoesPedido}>
                {pedidoEditando === pedido._id ? (
                  <>
                    <button onClick={() => salvarEdicaoPedido(pedido)}>
                      Salvar Alterações
                    </button>

                    <button
                      className={styles.secundario}
                      onClick={() => {
                        setPedidoEditando(null);
                        setItensEditados({});
                        setProdutoNovo({});
                        setQuantidadeNova({});
                      }}
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => iniciarEdicao(pedido)}>
                      Editar Pedido
                    </button>

                    <button onClick={() => baixarPdf(pedido._id)}>
                      Baixar PDF
                    </button>

                    <button
                      className={styles.perigo}
                      onClick={() => excluirPedido(pedido._id)}
                    >
                      Excluir Pedido
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default AdminPedidos;