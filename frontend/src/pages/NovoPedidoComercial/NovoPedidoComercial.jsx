import { useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../../api/axios";
import Navbar from "../../components/Navbar/Navbar";
import PageHeader from "../../components/PageHeader/PageHeader";
import { FilterToolbar, PaginationControls } from "../../components/ListControls/ListControls";
import Catalogo from "../Catalogo/Catalogo";
import layout from "../LogisticaDashboard/LogisticaDashboard.module.css";
import styles from "./NovoPedidoComercial.module.css";

function NovoPedidoComercial() {
  const [searchParams, setSearchParams] = useSearchParams();
  const clienteInicial = searchParams.get("cliente");
  const [clientes, setClientes] = useState(null);
  const [selecionado, setSelecionado] = useState(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState("");
  const [reload, setReload] = useState(0);
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    api.get("/pedidos/comercial/distribuidores", { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) { setClientes(response.data); if (clienteInicial) { const cliente = response.data.find((c) => c._id === clienteInicial); if (cliente) setSelecionado(cliente); else setErro("Cliente indisponível ou fora da sua carteira."); } } })
      .catch((error) => { if (!controller.signal.aborted) setErro(error.response?.data?.message || "Não foi possível carregar os distribuidores"); });
    return () => controller.abort();
  }, [reload, clienteInicial]);

  if (selecionado) return <Catalogo key={selecionado._id} distribuidor={selecionado} onTrocarDistribuidor={() => {
    setSearchParams({}); setSelecionado(null); setClientes(null); setReload((value) => value + 1);
  }} />;

  const filtrados = (clientes || []).filter((cliente) =>
    [cliente.nomeFantasia, cliente.razaoSocial, cliente.nomeResponsavel, cliente.cnpj].some((value) =>
      String(value || "").toLocaleLowerCase("pt-BR").includes(busca.trim().toLocaleLowerCase("pt-BR"))));

  return (
    <>
      <Navbar />
      <main className={layout.container}>
        <PageHeader eyebrow="Comercial" title="Novo pedido" description="Selecione o distribuidor para abrir o catálogo com a tabela de preço vinculada a ele." />
        <FilterToolbar searchLabel="Buscar distribuidor" searchPlaceholder="Nome, razão social ou documento"
          searchValue={busca} onSearchChange={(event) => { setBusca(event.target.value); setPagina(1); }}
          onClear={() => { setBusca(""); setPagina(1); }} />
        {erro ? <div className={layout.stateBox} role="alert">{erro} <button className={styles.button} onClick={() => { setErro(""); setReload((value) => value + 1); }}>Tentar novamente</button></div>
          : !clientes ? <p role="status">Carregando distribuidores...</p>
          : filtrados.length === 0 ? <section className={layout.queue}><p className={layout.empty}>Nenhum distribuidor ativo e aprovado com tabela disponível foi encontrado.</p></section>
          : <section className={layout.queue} aria-label="Distribuidores disponíveis">
            {filtrados.slice((pagina - 1) * 12, pagina * 12).map((cliente) => (
              <article key={cliente._id} className={styles.client}>
                <div><h2>{cliente.nomeFantasia || cliente.razaoSocial || cliente.nomeResponsavel}</h2>
                  <p>{cliente.razaoSocial}{cliente.cnpj ? ` · ${cliente.cnpj}` : ""}</p>
                  <p>Tabela: <strong>{cliente.tabelaPrecoId.nome}</strong></p></div>
                <button className={styles.button} onClick={() => setSelecionado(cliente)} aria-label={`Selecionar ${cliente.nomeFantasia || cliente.razaoSocial || cliente.nomeResponsavel}`}>Selecionar</button>
              </article>
            ))}
          </section>}
        <PaginationControls currentPage={pagina} totalPages={Math.ceil(filtrados.length / 12)}
          onPrevious={() => setPagina((value) => value - 1)} onNext={() => setPagina((value) => value + 1)} />
      </main>
    </>
  );
}

export default NovoPedidoComercial;
