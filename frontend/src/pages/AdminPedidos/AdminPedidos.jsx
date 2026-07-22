import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./AdminPedidos.module.css";
import { abrirOuBaixarPdfPedido } from "../../utils/pdfPedido";

function AdminPedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [produtos, setProdutos] = useState([]);

  const [statusSelecionado, setStatusSelecionado] = useState({});
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");

  const [modalPedido, setModalPedido] = useState(null);
  const [quantidadesModal, setQuantidadesModal] = useState({});
  const [buscaProduto, setBuscaProduto] = useState("");

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
    const [pedidosResponse, produtosResponse] = await Promise.all([
      api.get("/pedidos"),
      api.get("/produtos"),
    ]);

    setPedidos(pedidosResponse.data);
    setProdutos(produtosResponse.data);
  };

  useEffect(() => {
    async function carregarDadosIniciais() {
      const [pedidosResponse, produtosResponse] = await Promise.all([
        api.get("/pedidos"),
        api.get("/produtos"),
      ]);

      setPedidos(pedidosResponse.data);
      setProdutos(produtosResponse.data);
    }

    carregarDadosIniciais();
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

  const baixarPdf = async (pedido) => {
    try {
      await abrirOuBaixarPdfPedido({
        pedidoId: pedido._id,
        numeroPedido: pedido.numeroPedido,
      });
    } catch (error) {
      console.error(error);
      alert("Não foi possível abrir ou baixar o PDF do pedido.");
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

  const abrirModalEdicao = (pedido) => {
    const mapa = {};

    pedido.itens.forEach((item) => {
      mapa[item.produtoId] = item.quantidade;
    });

    setModalPedido(pedido);
    setQuantidadesModal(mapa);
    setBuscaProduto("");
  };

  const alterarQuantidadeModal = (produtoId, quantidade) => {
    setQuantidadesModal({
      ...quantidadesModal,
      [produtoId]: quantidade,
    });
  };

  const fecharModal = () => {
    setModalPedido(null);
    setQuantidadesModal({});
    setBuscaProduto("");
  };

  const salvarModalPedido = async () => {
    const itens = Object.entries(quantidadesModal)
      .filter(([, quantidade]) => Number(quantidade) > 0)
      .map(([produtoId, quantidade]) => ({
        produtoId,
        quantidade: Number(quantidade),
      }));

    if (itens.length === 0) {
      alert("O pedido precisa ter pelo menos um item");
      return;
    }

    try {
      await api.put(`/pedidos/${modalPedido._id}`, {
        itens,
        observacao: modalPedido.observacao || "",
      });

      alert("Pedido atualizado com sucesso");

      fecharModal();
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

  const produtosFiltradosModal = produtos.filter((produto) =>
    produto.nome.toLowerCase().includes(buscaProduto.toLowerCase())
  );

  const quantidadeTotalModal = Object.values(quantidadesModal).reduce(
    (total, qtd) => total + Number(qtd || 0),
    0
  );

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
              </div>

              <div className={styles.acoesPedido}>
                <button
                  className={styles.editarBtn}
                  onClick={() => abrirModalEdicao(pedido)}
                >
                  Editar Pedido
                </button>

                <button
                  className={styles.pdfBtn}
                  onClick={() => baixarPdf(pedido)}
                >
                  Baixar PDF
                </button>

                <button
                  className={styles.perigo}
                  onClick={() => excluirPedido(pedido._id)}
                >
                  Excluir Pedido
                </button>
              </div>
            </div>
          ))}
        </div>

        {modalPedido && (
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div>
                  <h2>Editar Pedido</h2>
                  <p>{modalPedido.numeroPedido}</p>
                </div>

                <button onClick={fecharModal}>Fechar</button>
              </div>

              <div className={styles.modalInfo}>
                <strong>{modalPedido.nomeFantasiaCliente || "-"}</strong>
                <span>Total de itens: {quantidadeTotalModal}</span>
              </div>

              <input
                className={styles.buscaProduto}
                type="text"
                placeholder="Buscar produto..."
                value={buscaProduto}
                onChange={(e) => setBuscaProduto(e.target.value)}
              />

              <div className={styles.listaProdutosModal}>
                {produtosFiltradosModal.map((produto) => (
                  <div className={styles.produtoModal} key={produto._id}>
                    <div>
                      <strong>{produto.nome}</strong>
                      <span>
                        {produto.linha} • {produto.categoria}
                      </span>
                    </div>

                    <input
                      type="number"
                      min="0"
                      value={quantidadesModal[produto._id] || ""}
                      placeholder="0"
                      onChange={(e) =>
                        alterarQuantidadeModal(produto._id, e.target.value)
                      }
                    />
                  </div>
                ))}
              </div>

              <div className={styles.modalFooter}>
                <button
                  className={styles.secundario}
                  onClick={fecharModal}
                >
                  Cancelar
                </button>

                <button onClick={salvarModalPedido}>
                  Salvar Alterações
                </button>
              </div>

            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default AdminPedidos;
