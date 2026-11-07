import { useCallback, useEffect, useRef, useState } from "react";
import api from "../../api/axios";
import ui from "../AdminUi/AdminUi.module.css";
import { useModalDialog } from "../../hooks/useModalDialog";
import { getApiErrorMessage } from "../../utils/apiErrors";
import {
  ALERTA_LABELS,
  COMPROVANTE_TIPOS,
  comprimirImagem,
  CUPOM_STATUS_LABELS,
  CUPOM_STATUS_TONES,
  formatDateBR,
  formatDateTimeBR,
  formatDocumentoBR,
  formatMoney,
  formatPhoneBR,
  gerarChaveEnvio,
  HISTORICO_LABELS,
  LOTE_CANAL_LABELS,
  LOTE_STATUS_LABELS,
  PARTICIPACAO_STATUS_LABELS,
  PARTICIPACAO_STATUS_TONES,
  resumoCupons,
  textoChances,
  textoCupons,
  validarQuantidadeCupons,
} from "../../utils/natalPremiado";
import styles from "./NatalInterno.module.css";

const ACOES = {
  aprovar: { titulo: "Aprovar cadastro", botao: "Confirmar aprovação", exigeMotivo: false },
  rejeitar: { titulo: "Rejeitar cadastro", botao: "Confirmar rejeição", exigeMotivo: true, rotulo: "Motivo da rejeição" },
  cancelar: { titulo: "Cancelar cadastro", botao: "Confirmar cancelamento", exigeMotivo: true, rotulo: "Motivo do cancelamento" },
  aprovar_lote: { titulo: "Aprovar lote de cupons", botao: "Confirmar aprovação do lote", exigeMotivo: false, lote: "aprovar" },
  rejeitar_lote: { titulo: "Rejeitar lote de cupons", botao: "Confirmar rejeição do lote", exigeMotivo: true, rotulo: "Motivo da rejeição do lote", lote: "rejeitar" },
  cancelar_lote: { titulo: "Cancelar lote de cupons", botao: "Confirmar cancelamento do lote", exigeMotivo: true, rotulo: "Motivo do cancelamento do lote", lote: "cancelar" },
};

const MAX_BYTES = 10 * 1024 * 1024;
const hojeBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

// Respostas de erro pedidas como blob precisam ser lidas como JSON para exibir a mensagem.
const mensagemErroBlob = async (error) => {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      const corpo = JSON.parse(await data.text());
      if (corpo?.message) return corpo.message;
    } catch {
      // Corpo não é JSON: usa a mensagem padrão abaixo.
    }
  }
  if (error?.response?.status === 403) return "Você não tem permissão para ver este comprovante.";
  return getApiErrorMessage(error, "Não foi possível carregar o comprovante. Tente novamente.");
};

// Novo lote para um cadastro existente (painel do distribuidor). Os dados do pet shop
// não são reenviados. O envio usa uma chave própria: repetir nunca duplica cupons.
function AdicionarCupons({ participacao, saldoDisponivel, onConcluido, onCancelar }) {
  const [campos, setCampos] = useState({ quantidade: "1", vendedorNome: "", dataCompra: "", valorCompra: "", aceiteTermos: false });
  const [arquivo, setArquivo] = useState(null);
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const chave = useRef(gerarChaveEnvio());
  const maximo = Number.isFinite(saldoDisponivel) ? saldoDisponivel : undefined;
  const validacao = validarQuantidadeCupons(campos.quantidade, maximo);
  const quantidade = validacao.valido ? validacao.quantidade : 0;
  const totalAtual = resumoCupons(participacao).total;

  const alterar = (campo, valor) => {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
    setErros((atual) => ({ ...atual, [campo]: undefined }));
  };

  const selecionar = async (event) => {
    const selecionado = event.target.files?.[0];
    event.target.value = "";
    if (!selecionado) return;
    if (!COMPROVANTE_TIPOS.includes(selecionado.type)) {
      setErros((atual) => ({ ...atual, comprovante: "Envie uma foto (JPG, PNG ou WEBP) ou um PDF." }));
      return;
    }
    const pronto = await comprimirImagem(selecionado);
    if (pronto.size > MAX_BYTES) {
      setErros((atual) => ({ ...atual, comprovante: "O comprovante deve ter no máximo 10 MB." }));
      return;
    }
    setArquivo(pronto);
    setErros((atual) => ({ ...atual, comprovante: undefined }));
  };

  const revisar = (event) => {
    event.preventDefault();
    const encontrados = {};
    if (!validacao.valido) encontrados.quantidade = validacao.erro;
    if (campos.vendedorNome.trim().length < 2) encontrados.vendedorNome = "Informe o nome do vendedor.";
    if (!campos.dataCompra) encontrados.dataCompra = "Informe a data da compra.";
    if (!(Number(String(campos.valorCompra).replace(/\./g, "").replace(",", ".")) > 0)) encontrados.valorCompra = "Informe o valor da compra.";
    if (!arquivo) encontrados.comprovante = "Anexe o comprovante desta compra.";
    if (!campos.aceiteTermos) encontrados.aceiteTermos = "Confirme a declaração.";
    setErros(encontrados);
    setErroGeral(Object.keys(encontrados).length ? "Revise os campos destacados." : "");
    if (Object.keys(encontrados).length === 0) setConfirmando(true);
  };

  const enviar = async () => {
    if (enviando) return;
    setEnviando(true);
    setErroGeral("");
    const dados = new FormData();
    dados.append("quantidade", String(quantidade));
    dados.append("vendedorNome", campos.vendedorNome.trim());
    dados.append("dataCompra", campos.dataCompra);
    dados.append("valorCompra", campos.valorCompra);
    dados.append("aceiteTermos", "true");
    dados.append("chaveIdempotencia", chave.current);
    dados.append("comprovante", arquivo, arquivo.name);
    try {
      const { data } = await api.post(`/natal-2026/participacoes/${participacao._id}/distribuicoes`, dados, { timeout: 180000 });
      chave.current = gerarChaveEnvio();
      onConcluido(data.message);
    } catch (error) {
      setConfirmando(false);
      if (!error.response) {
        setErroGeral("Conexão interrompida. Toque em \"Revisar envio\" e confirme de novo: se os cupons já tiverem sido registrados, nada será duplicado.");
        return;
      }
      if (error.response.data?.errors) setErros(error.response.data.errors);
      setErroGeral(getApiErrorMessage(error, "Não foi possível adicionar os cupons."));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className={styles.acaoPainel} onSubmit={revisar} noValidate aria-label="Adicionar cupons a este cadastro">
      <h3>Adicionar cupons</h3>
      <p className={styles.muted}>
        Os dados do pet shop continuam os mesmos. Informe só a nova entrega de cupons e o comprovante da compra.
        {Number.isFinite(saldoDisponivel) && <> Saldo disponível: <strong>{textoCupons(saldoDisponivel)}</strong>.</>}
      </p>
      {erroGeral && <div className={ui.feedback} data-type="error" role="alert">{erroGeral}</div>}
      <fieldset className={styles.loteCampos} disabled={enviando || confirmando}>
        <label className={styles.campoTexto}>
          <span>Quantos cupons deseja adicionar?</span>
          <input inputMode="numeric" pattern="[0-9]*" maxLength={4} value={campos.quantidade} onChange={(event) => alterar("quantidade", event.target.value.replace(/\D/g, "").slice(0, 4))} aria-invalid={erros.quantidade ? "true" : undefined} />
          {erros.quantidade && <small className={styles.erro} role="alert">{erros.quantidade}</small>}
        </label>
        <label className={styles.campoTexto}>
          <span>Vendedor responsável</span>
          <input value={campos.vendedorNome} maxLength={120} autoComplete="name" onChange={(event) => alterar("vendedorNome", event.target.value)} aria-invalid={erros.vendedorNome ? "true" : undefined} />
          {erros.vendedorNome && <small className={styles.erro} role="alert">{erros.vendedorNome}</small>}
        </label>
        <label className={styles.campoTexto}>
          <span>Data da compra</span>
          <input type="date" max={hojeBrasilia()} value={campos.dataCompra} onChange={(event) => alterar("dataCompra", event.target.value)} aria-invalid={erros.dataCompra ? "true" : undefined} />
          {erros.dataCompra && <small className={styles.erro} role="alert">{erros.dataCompra}</small>}
        </label>
        <label className={styles.campoTexto}>
          <span>Valor da compra (R$)</span>
          <input inputMode="decimal" placeholder="0,00" value={campos.valorCompra} onChange={(event) => alterar("valorCompra", event.target.value.replace(/[^\d,.]/g, ""))} aria-invalid={erros.valorCompra ? "true" : undefined} />
          {erros.valorCompra && <small className={styles.erro} role="alert">{erros.valorCompra}</small>}
        </label>
        <label className={styles.campoTexto}>
          <span>Comprovante da compra (foto ou PDF, até 10 MB)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={selecionar} />
          {arquivo && <small>{arquivo.name}</small>}
          {erros.comprovante && <small className={styles.erro} role="alert">{erros.comprovante}</small>}
        </label>
        <label className={styles.checkLinha}>
          <input type="checkbox" checked={campos.aceiteTermos} onChange={(event) => alterar("aceiteTermos", event.target.checked)} />
          <span>Declaro que a compra é verdadeira e que os cupons foram entregues a este pet shop.</span>
        </label>
        {erros.aceiteTermos && <small className={styles.erro} role="alert">{erros.aceiteTermos}</small>}
      </fieldset>
      {quantidade > 0 && (
        <p className={styles.previaLote} aria-live="polite">
          Depois da validação, este pet shop passa de {textoCupons(totalAtual)} para <strong>{textoCupons(totalAtual + quantidade)}</strong> ({textoChances(totalAtual + quantidade)} no sorteio).
          {Number.isFinite(saldoDisponivel) && <> Seu saldo fica em <strong>{textoCupons(Math.max(saldoDisponivel - quantidade, 0))}</strong>.</>}
        </p>
      )}
      {confirmando ? (
        <div className={styles.confirmacaoLote} role="alertdialog" aria-label="Confirmar adição de cupons">
          <p>Adicionar <strong>{textoCupons(quantidade)}</strong> para <strong>{participacao.petshop?.nomeFantasia}</strong>?</p>
          <div className={styles.acoes}>
            <button type="button" className={ui.secondaryButton} onClick={() => setConfirmando(false)} disabled={enviando}>Voltar</button>
            <button type="button" className={ui.primaryButton} onClick={enviar} disabled={enviando} autoFocus>{enviando ? "Enviando…" : "Confirmar e adicionar"}</button>
          </div>
        </div>
      ) : (
        <div className={styles.acoes}>
          <button type="button" className={ui.secondaryButton} onClick={onCancelar} disabled={enviando}>Cancelar</button>
          <button type="submit" className={ui.primaryButton} disabled={enviando}>Revisar envio</button>
        </div>
      )}
    </form>
  );
}

function LoteCupons({ lote, gestor, cadastroStatus, onAcao, onComprovante, carregandoComprovante }) {
  const pendentes = lote.contadores?.pendentes ?? lote.cupons?.filter((cupom) => cupom.status === "pendente").length ?? 0;
  const podeAprovar = gestor && lote._id && lote.status === "pendente" && cadastroStatus === "aprovado";
  const podeRejeitar = gestor && lote._id && lote.status === "pendente" && (cadastroStatus === "aprovado" || lote.tipo === "adicional");
  const podeCancelar = gestor && lote._id && ["pendente", "aprovado"].includes(lote.status);
  return (
    <li className={styles.distribuicao}>
      <div className={styles.loteCabecalho}>
        <div>
          <strong>{textoCupons(lote.quantidade)}</strong>
          <span> · {formatDateTimeBR(lote.recebidoEm)}</span>
        </div>
        <span className={ui.badge} data-tone={lote.status === "aprovado" ? "active" : lote.status === "pendente" ? "accent" : "inactive"}>{LOTE_STATUS_LABELS[lote.status] || lote.status}</span>
      </div>
      <p className={styles.muted}>
        Lote {lote.protocolo} · {LOTE_CANAL_LABELS[lote.canal] || lote.canal} · Vendedor {lote.vendedorNome}
        {lote.compra?.data && <> · Compra de {formatDateBR(lote.compra.data)}{lote.compra.valor ? ` (${formatMoney(lote.compra.valor)})` : ""}</>}
      </p>
      {lote.origensSaldo?.length > 0 && (
        <p className={styles.muted}>Origem do saldo: {lote.origensSaldo.map((item) => `${item.referencia || item.tipo} (${item.quantidade})`).join(", ")}</p>
      )}
      {gestor && lote.dadosInformados?.divergente && (
        <div className={ui.feedback} data-type="warning" role="note">
          Dados informados neste envio diferem do cadastro: {lote.dadosInformados.nomeFantasia} · {lote.dadosInformados.responsavel} · {formatPhoneBR(lote.dadosInformados.whatsapp)} · @{lote.dadosInformados.instagram}
        </div>
      )}
      {lote.cancelamento && <p className={styles.muted}>Cancelado por {lote.cancelamento.autorNome} em {formatDateTimeBR(lote.cancelamento.em)}: {lote.cancelamento.motivo}</p>}
      {lote.status === "rejeitado" && lote.decisao && <p className={styles.muted}>Rejeitado por {lote.decisao.autorNome}: {lote.decisao.motivo}</p>}
      {lote.cupons?.length > 0 && (
        <details className={styles.loteNumeros} open={lote.cupons.length <= 10}>
          <summary>Números ({lote.cupons.length}){pendentes > 0 ? ` · ${pendentes} aguardando validação` : ""}</summary>
          <ul>
            {lote.cupons.map((cupom) => (
              <li key={cupom.numero} data-tone={CUPOM_STATUS_TONES[cupom.status]} title={CUPOM_STATUS_LABELS[cupom.status]}>
                {cupom.codigo}
                {!["valido", "pendente"].includes(cupom.status) && <small> {CUPOM_STATUS_LABELS[cupom.status]}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(lote.possuiComprovante && lote._id && lote.tipo !== "legado") || podeAprovar || podeRejeitar || podeCancelar ? (
        <div className={styles.acoes}>
          {lote.possuiComprovante && lote._id && lote.tipo !== "legado" && (
            <button type="button" className={ui.secondaryButton} onClick={() => onComprovante(lote)} disabled={carregandoComprovante}>Comprovante do lote</button>
          )}
          {podeCancelar && <button type="button" className={ui.dangerButton} onClick={() => onAcao("cancelar_lote", lote)}>Cancelar lote</button>}
          {podeRejeitar && <button type="button" className={ui.dangerButton} onClick={() => onAcao("rejeitar_lote", lote)}>Rejeitar lote</button>}
          {podeAprovar && <button type="button" className={ui.primaryButton} onClick={() => onAcao("aprovar_lote", lote)}>Aprovar lote</button>}
        </div>
      ) : null}
    </li>
  );
}

// Detalhe de um cadastro com lotes, cupons, comprovantes, histórico e ações conforme o
// perfil. A permissão real é decidida no backend; aqui apenas se omitem botões indisponíveis.
function ParticipacaoModal({ participacaoId, gestor = false, usuarioTipo, saldoDisponivel, onClose, onChanged }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [comprovante, setComprovante] = useState(null);
  const [carregandoComprovante, setCarregandoComprovante] = useState(false);
  const [erroComprovante, setErroComprovante] = useState("");
  const [acao, setAcao] = useState(null);
  const [loteAlvo, setLoteAlvo] = useState(null);
  const [adicionando, setAdicionando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [exigeJustificativa, setExigeJustificativa] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroAcao, setErroAcao] = useState("");
  const [aviso, setAviso] = useState("");
  const dialogRef = useModalDialog({ onClose, closeDisabled: salvando });

  const carregar = useCallback(() => api.get(`/natal-2026/participacoes/${participacaoId}`)
    .then((response) => setDados(response.data))
    .catch((error) => setErro(getApiErrorMessage(error, "Não foi possível abrir a participação."))), [participacaoId]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => () => { if (comprovante?.url) URL.revokeObjectURL(comprovante.url); }, [comprovante]);

  // O arquivo é lido pelo backend (com checagem de permissão) e exibido a partir
  // de um blob local: o endereço do armazenamento nunca chega ao navegador.
  const abrirComprovante = async (lote) => {
    setCarregandoComprovante(true);
    setErroComprovante("");
    try {
      const caminho = lote ? `/natal-2026/distribuicoes/${lote._id}/comprovante` : `/natal-2026/participacoes/${participacaoId}/comprovante`;
      const response = await api.get(caminho, { responseType: "blob", timeout: 60000 });
      const tipo = response.data.type || dados?.comprovante?.mimetype;
      setComprovante({ url: URL.createObjectURL(new Blob([response.data], { type: tipo })), tipo, rotulo: lote ? `lote ${lote.protocolo}` : "primeiro envio" });
    } catch (error) {
      setErroComprovante(await mensagemErroBlob(error));
    } finally {
      setCarregandoComprovante(false);
    }
  };

  const baixarComprovante = () => {
    if (!comprovante) return;
    const extensao = comprovante.tipo === "application/pdf" ? "pdf" : (comprovante.tipo?.split("/")[1] || "arquivo").replace("jpeg", "jpg");
    const link = document.createElement("a");
    link.href = comprovante.url;
    link.download = `comprovante-${dados?.protocolo || participacaoId}.${extensao}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const iniciarAcao = (tipo, lote = null) => {
    setAcao(tipo);
    setLoteAlvo(lote);
    setMotivo("");
    setErroAcao("");
    setAdicionando(false);
  };

  const confirmarAcao = async () => {
    const config = ACOES[acao];
    if (config.exigeMotivo && motivo.trim().length < 5) {
      setErroAcao("Informe o motivo com pelo menos 5 caracteres.");
      return;
    }
    if (exigeJustificativa && justificativa.trim().length < 15) {
      setErroAcao("Informe a justificativa do ajuste após o fechamento (mínimo de 15 caracteres).");
      return;
    }
    setSalvando(true);
    setErroAcao("");
    try {
      const caminho = config.lote
        ? `/natal-2026/distribuicoes/${loteAlvo._id}/${config.lote}`
        : `/natal-2026/participacoes/${participacaoId}/${acao}`;
      const { data } = await api.post(caminho, {
        motivo: config.exigeMotivo ? motivo.trim() : undefined,
        justificativa: exigeJustificativa ? justificativa.trim() : undefined,
      });
      await carregar();
      setAcao(null);
      setLoteAlvo(null);
      setAviso(data.message);
      onChanged?.(data.message);
    } catch (error) {
      if (error.response?.data?.codigo === "lista_fechada" && usuarioTipo === "admin") setExigeJustificativa(true);
      setErroAcao(getApiErrorMessage(error, "Não foi possível concluir a ação."));
    } finally {
      setSalvando(false);
    }
  };

  const aposAdicionar = async (mensagem) => {
    setAdicionando(false);
    setAviso(mensagem);
    await carregar();
    onChanged?.(mensagem);
  };

  const cupons = resumoCupons(dados);
  const podeDecidir = gestor && dados?.status === "pendente";
  const podeCancelar = ["pendente", "aprovado"].includes(dados?.status);
  const podeAdicionar = !gestor && usuarioTipo === "cliente" && ["pendente", "aprovado"].includes(dados?.status);
  const lotesPendentes = (dados?.lotes || []).filter((lote) => lote.status === "pendente");

  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget && !salvando) onClose(); }}>
      <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="natal-participacao-titulo" tabIndex="-1">
        <header className={styles.modalHeader}>
          <div>
            <span>Cadastro {dados?.protocolo || ""}</span>
            <h2 id="natal-participacao-titulo">{dados?.petshop?.nomeFantasia || "Carregando"}</h2>
          </div>
          <button type="button" className={ui.secondaryButton} onClick={onClose} disabled={salvando}>Fechar</button>
        </header>
        <div className={styles.modalContent}>
          {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
          {!dados && !erro && <p className={styles.muted} role="status">Carregando participação…</p>}
          {aviso && <div className={ui.feedback} data-type="success" role="status">{aviso}</div>}
          {dados && (
            <>
              <div className={styles.statusLinha}>
                <span className={ui.badge} data-tone={PARTICIPACAO_STATUS_TONES[dados.status]}>{PARTICIPACAO_STATUS_LABELS[dados.status]}</span>
                <span className={styles.cupom} data-invalido={(cupons.validos === 0 && cupons.pendentes === 0) || undefined}>
                  <strong>{textoCupons(cupons.total)}</strong> · {cupons.validos} válido(s) no sorteio
                  {cupons.pendentes > 0 && ` · ${cupons.pendentes} aguardando validação`}
                </span>
              </div>
              <dl className={styles.resumoCupons} aria-label="Cupons deste cadastro">
                <div><dt>Total</dt><dd>{cupons.total}</dd></div>
                <div><dt>Válidos</dt><dd>{cupons.validos}</dd></div>
                <div><dt>Aguardando</dt><dd>{cupons.pendentes}</dd></div>
                <div><dt>Cancelados</dt><dd>{cupons.cancelados + cupons.rejeitados}</dd></div>
                <div><dt>Invalidados</dt><dd>{cupons.invalidados}</dd></div>
              </dl>

              {gestor && dados.duplicidadeLegada && (
                <div className={ui.feedback} data-type="warning" role="note">
                  Cadastro antigo com o mesmo CPF/CNPJ de outro cadastro deste distribuidor. Os novos lotes vão para o outro cadastro; este segue como está para sua análise.
                </div>
              )}
              {gestor && dados.alertas?.length > 0 && (
                <div className={ui.feedback} data-type="warning" role="note">
                  <div>
                    <strong>Possível duplicidade</strong>
                    <ul className={styles.alertas}>
                      {dados.alertas.map((alerta, indice) => (
                        <li key={`${alerta.participacaoId}-${alerta.tipo}-${indice}`}>{ALERTA_LABELS[alerta.tipo] || alerta.tipo} — protocolo {alerta.protocolo}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <dl className={styles.detalhes}>
                <div><dt>Distribuidor</dt><dd>{dados.distribuidorNome}</dd></div>
                <div><dt>Pedido</dt><dd>{dados.numeroPedido || "Link do distribuidor"}</dd></div>
                <div><dt>Vendedor (1º envio)</dt><dd>{dados.vendedorNome}</dd></div>
                <div><dt>Recebido em</dt><dd>{formatDateTimeBR(dados.recebidoEm)}</dd></div>
                <div><dt>Razão social</dt><dd>{dados.petshop.razaoSocial}</dd></div>
                <div><dt>{dados.petshop.tipoDocumento === "cpf" ? "CPF" : "CNPJ"}</dt><dd>{formatDocumentoBR(dados.petshop.documento)}</dd></div>
                <div><dt>Responsável</dt><dd>{dados.petshop.responsavel}</dd></div>
                <div><dt>WhatsApp</dt><dd>{formatPhoneBR(dados.petshop.whatsapp)}</dd></div>
                <div>
                  <dt>Instagram</dt>
                  <dd>
                    <a href={`https://www.instagram.com/${encodeURIComponent(dados.petshop.instagram)}/`} target="_blank" rel="noopener noreferrer">@{dados.petshop.instagram}</a>
                  </dd>
                </div>
                <div><dt>1ª compra</dt><dd>{formatDateBR(dados.compra.data)} · {formatMoney(dados.compra.valor)}</dd></div>
              </dl>
              {gestor && <p className={styles.muted}>Confira visualmente se o estabelecimento segue o Instagram oficial da Atual Pet.</p>}

              <section className={styles.bloco}>
                <h3>Distribuições de cupons</h3>
                <p className={styles.muted}>
                  Cada cupom é uma chance no sorteio. {lotesPendentes.length > 0 && gestor && dados.status === "pendente"
                    ? "Ao aprovar o cadastro, os lotes aguardando validação são aprovados juntos."
                    : ""}
                </p>
                <ol className={styles.distribuicoes}>
                  {(dados.lotes || []).map((lote, indice) => (
                    <LoteCupons
                      key={lote._id || `legado-${indice}`}
                      lote={lote}
                      gestor={gestor}
                      cadastroStatus={dados.status}
                      onAcao={iniciarAcao}
                      onComprovante={abrirComprovante}
                      carregandoComprovante={carregandoComprovante}
                    />
                  ))}
                </ol>
                {podeAdicionar && !adicionando && !acao && (
                  <div className={styles.acoes}>
                    <button type="button" className={ui.primaryButton} onClick={() => { setAdicionando(true); setAviso(""); }}>Adicionar cupons</button>
                  </div>
                )}
                {adicionando && (
                  <AdicionarCupons participacao={dados} saldoDisponivel={saldoDisponivel} onConcluido={aposAdicionar} onCancelar={() => setAdicionando(false)} />
                )}
              </section>

              <section className={styles.bloco}>
                <h3>Comprovante</h3>
                <p className={styles.muted}>
                  Primeiro envio: {dados.comprovante?.mimetype === "application/pdf" ? "PDF" : "Imagem"}
                  {dados.comprovante?.bytes ? ` · ${Math.max(1, Math.round(dados.comprovante.bytes / 1024))} KB` : ""}
                  {dados.comprovante?.nomeOriginal ? ` · ${dados.comprovante.nomeOriginal}` : ""}. Os lotes seguintes têm o próprio comprovante.
                </p>
                <div className={styles.comprovanteBarra}>
                  <button type="button" className={ui.secondaryButton} onClick={() => abrirComprovante(null)} disabled={carregandoComprovante} aria-busy={carregandoComprovante || undefined}>
                    {carregandoComprovante ? "Carregando comprovante…" : "Visualizar comprovante do primeiro envio"}
                  </button>
                  {comprovante && (
                    <>
                      <a className={ui.secondaryButton} href={comprovante.url} target="_blank" rel="noopener noreferrer">Abrir em nova aba</a>
                      <button type="button" className={ui.secondaryButton} onClick={baixarComprovante}>Baixar</button>
                    </>
                  )}
                </div>
                {carregandoComprovante && <p className={styles.muted} role="status">Buscando o arquivo com segurança…</p>}
                {erroComprovante && (
                  <div className={ui.feedback} data-type="error" role="alert">
                    <span>{erroComprovante}</span>
                  </div>
                )}
                {comprovante && <p className={styles.muted}>Exibindo: comprovante do {comprovante.rotulo}.</p>}
                {comprovante && (comprovante.tipo?.startsWith("image/") ? (
                  <a href={comprovante.url} target="_blank" rel="noopener noreferrer" className={styles.comprovanteImagem}>
                    <img
                      src={comprovante.url}
                      alt={`Comprovante do ${comprovante.rotulo}`}
                      onError={() => setErroComprovante("O arquivo foi recebido, mas não pôde ser exibido como imagem. Use Baixar para conferir.")}
                    />
                  </a>
                ) : (
                  <iframe className={styles.comprovantePdf} src={comprovante.url} title={`Comprovante em PDF do ${comprovante.rotulo}`} />
                ))}
              </section>

              {(dados.decisao || dados.cancelamento || dados.invalidacao) && (
                <section className={styles.bloco}>
                  <h3>Decisão</h3>
                  {dados.decisao && dados.status === "rejeitado" && <p>Rejeitado por {dados.decisao.autorNome} em {formatDateTimeBR(dados.decisao.em)}: {dados.decisao.motivo}</p>}
                  {dados.decisao && dados.status !== "rejeitado" && <p>Aprovado por {dados.decisao.autorNome} em {formatDateTimeBR(dados.decisao.em)}.</p>}
                  {dados.cancelamento && <p>Cancelado por {dados.cancelamento.autorNome} em {formatDateTimeBR(dados.cancelamento.em)}: {dados.cancelamento.motivo}</p>}
                  {dados.invalidacao && <p>Invalidado em {formatDateTimeBR(dados.invalidacao.em)}: {dados.invalidacao.motivo}</p>}
                </section>
              )}

              <section className={styles.bloco}>
                <h3>Histórico</h3>
                <ol className={styles.historico}>
                  {dados.historico.map((evento, indice) => (
                    <li key={`${evento.acao}-${indice}`}>
                      <strong>{HISTORICO_LABELS[evento.acao] || evento.acao}</strong>
                      <span>{formatDateTimeBR(evento.em)} · {evento.autorNome || "Sistema"}</span>
                      {(evento.motivo || evento.detalhes) && <small>{evento.motivo || evento.detalhes}</small>}
                    </li>
                  ))}
                </ol>
              </section>

              {erroAcao && !acao && <div className={ui.feedback} data-type="error" role="alert">{erroAcao}</div>}

              {acao ? (
                <section className={styles.acaoPainel} aria-label={ACOES[acao].titulo}>
                  <h3>{ACOES[acao].titulo}{loteAlvo ? ` ${loteAlvo.protocolo}` : ""}</h3>
                  {acao === "aprovar" && (
                    <p className={styles.muted}>
                      {cupons.pendentes > 0
                        ? `Os ${textoCupons(cupons.pendentes)} aguardando validação passam a valer no sorteio.`
                        : "O cadastro será aprovado."}
                    </p>
                  )}
                  {acao === "aprovar_lote" && <p className={styles.muted}>{textoCupons(loteAlvo.quantidade)} deste lote passam a valer no sorteio.</p>}
                  {acao === "rejeitar_lote" && <p className={styles.muted}>Os {textoCupons(loteAlvo.quantidade)} deste lote deixam de valer e voltam ao saldo do distribuidor. Os demais lotes não mudam.</p>}
                  {acao === "cancelar_lote" && <p className={styles.muted}>Os cupons pendentes ou válidos deste lote são cancelados e voltam ao saldo do distribuidor. Os números nunca são reutilizados. Os demais lotes não mudam.</p>}
                  {acao === "rejeitar" && <p className={styles.muted}>Todos os cupons aguardando validação deste cadastro são rejeitados e voltam ao saldo do distribuidor.</p>}
                  {acao === "cancelar" && <p className={styles.muted}>Todos os {textoCupons(cupons.validos + cupons.pendentes)} ativos deste cadastro são cancelados e voltam ao saldo do distribuidor. Os números nunca são reutilizados.</p>}
                  {ACOES[acao].exigeMotivo && (
                    <label className={styles.campoTexto}>
                      <span>{ACOES[acao].rotulo}</span>
                      <textarea value={motivo} maxLength={500} rows={3} onChange={(event) => setMotivo(event.target.value)} disabled={salvando} autoFocus />
                    </label>
                  )}
                  {exigeJustificativa && (
                    <label className={styles.campoTexto}>
                      <span>Justificativa do ajuste após o fechamento da lista</span>
                      <textarea value={justificativa} maxLength={1000} rows={3} onChange={(event) => setJustificativa(event.target.value)} disabled={salvando} />
                    </label>
                  )}
                  {erroAcao && <div className={ui.feedback} data-type="error" role="alert">{erroAcao}</div>}
                  <div className={styles.acoes}>
                    <button type="button" className={ui.secondaryButton} onClick={() => { setAcao(null); setLoteAlvo(null); }} disabled={salvando}>Voltar</button>
                    <button type="button" className={acao.startsWith("aprovar") ? ui.primaryButton : ui.dangerButton} onClick={confirmarAcao} disabled={salvando}>
                      {salvando ? "Salvando…" : ACOES[acao].botao}
                    </button>
                  </div>
                </section>
              ) : (
                (podeDecidir || podeCancelar) && !adicionando && (
                  <div className={styles.acoes}>
                    {podeCancelar && <button type="button" className={ui.dangerButton} onClick={() => iniciarAcao("cancelar")}>Cancelar cadastro</button>}
                    {podeDecidir && <button type="button" className={ui.dangerButton} onClick={() => iniciarAcao("rejeitar")}>Rejeitar cadastro</button>}
                    {podeDecidir && <button type="button" className={ui.primaryButton} onClick={() => iniciarAcao("aprovar")}>Aprovar cadastro</button>}
                  </div>
                )
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default ParticipacaoModal;
