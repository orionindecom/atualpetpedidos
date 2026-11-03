import { useEffect, useState } from "react";
import api from "../../api/axios";
import ui from "../AdminUi/AdminUi.module.css";
import { useModalDialog } from "../../hooks/useModalDialog";
import { getApiErrorMessage } from "../../utils/apiErrors";
import {
  ALERTA_LABELS,
  formatDateBR,
  formatDateTimeBR,
  formatDocumentoBR,
  formatMoney,
  formatPhoneBR,
  HISTORICO_LABELS,
  PARTICIPACAO_STATUS_LABELS,
  PARTICIPACAO_STATUS_TONES,
} from "../../utils/natalPremiado";
import styles from "./NatalInterno.module.css";

const ACOES = {
  aprovar: { titulo: "Aprovar participação", botao: "Confirmar aprovação", exigeMotivo: false },
  rejeitar: { titulo: "Rejeitar participação", botao: "Confirmar rejeição", exigeMotivo: true, rotulo: "Motivo da rejeição" },
  cancelar: { titulo: "Cancelar participação", botao: "Confirmar cancelamento", exigeMotivo: true, rotulo: "Motivo do cancelamento" },
};

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

// Detalhe de uma participação com comprovante, histórico e ações conforme o perfil.
// A permissão real é decidida no backend; aqui apenas se omitem botões indisponíveis.
function ParticipacaoModal({ participacaoId, gestor = false, usuarioTipo, onClose, onChanged }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [comprovante, setComprovante] = useState(null);
  const [carregandoComprovante, setCarregandoComprovante] = useState(false);
  const [erroComprovante, setErroComprovante] = useState("");
  const [acao, setAcao] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [exigeJustificativa, setExigeJustificativa] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroAcao, setErroAcao] = useState("");
  const dialogRef = useModalDialog({ onClose, closeDisabled: salvando });

  useEffect(() => {
    let ativo = true;
    api.get(`/natal-2026/participacoes/${participacaoId}`)
      .then((response) => { if (ativo) setDados(response.data); })
      .catch((error) => { if (ativo) setErro(getApiErrorMessage(error, "Não foi possível abrir a participação.")); });
    return () => { ativo = false; };
  }, [participacaoId]);

  useEffect(() => () => { if (comprovante?.url) URL.revokeObjectURL(comprovante.url); }, [comprovante]);

  // O arquivo é lido pelo backend (com checagem de permissão) e exibido a partir
  // de um blob local: o endereço do armazenamento nunca chega ao navegador.
  const abrirComprovante = async () => {
    setCarregandoComprovante(true);
    setErroComprovante("");
    try {
      const response = await api.get(`/natal-2026/participacoes/${participacaoId}/comprovante`, { responseType: "blob", timeout: 60000 });
      const tipo = response.data.type || dados?.comprovante?.mimetype;
      setComprovante({ url: URL.createObjectURL(new Blob([response.data], { type: tipo })), tipo });
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

  const iniciarAcao = (tipo) => {
    setAcao(tipo);
    setMotivo("");
    setErroAcao("");
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
      const { data } = await api.post(`/natal-2026/participacoes/${participacaoId}/${acao}`, {
        motivo: config.exigeMotivo ? motivo.trim() : undefined,
        justificativa: exigeJustificativa ? justificativa.trim() : undefined,
      });
      setDados(data.participacao);
      setAcao(null);
      onChanged?.(data.message);
    } catch (error) {
      if (error.response?.data?.codigo === "lista_fechada" && usuarioTipo === "admin") setExigeJustificativa(true);
      setErroAcao(getApiErrorMessage(error, "Não foi possível concluir a ação."));
    } finally {
      setSalvando(false);
    }
  };

  const podeDecidir = gestor && dados?.status === "pendente";
  const podeCancelar = ["pendente", "aprovado"].includes(dados?.status);

  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget && !salvando) onClose(); }}>
      <section ref={dialogRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="natal-participacao-titulo" tabIndex="-1">
        <header className={styles.modalHeader}>
          <div>
            <span>Participação {dados?.protocolo || ""}</span>
            <h2 id="natal-participacao-titulo">{dados?.petshop?.nomeFantasia || "Carregando"}</h2>
          </div>
          <button type="button" className={ui.secondaryButton} onClick={onClose} disabled={salvando}>Fechar</button>
        </header>
        <div className={styles.modalContent}>
          {erro && <div className={ui.feedback} data-type="error" role="alert">{erro}</div>}
          {!dados && !erro && <p className={styles.muted} role="status">Carregando participação…</p>}
          {dados && (
            <>
              <div className={styles.statusLinha}>
                <span className={ui.badge} data-tone={PARTICIPACAO_STATUS_TONES[dados.status]}>{PARTICIPACAO_STATUS_LABELS[dados.status]}</span>
                {dados.cupom && (
                  <span className={styles.cupom} data-invalido={dados.status !== "aprovado" || undefined}>
                    Cupom nº <strong>{dados.cupom.codigo}</strong>
                    {dados.status !== "aprovado" && " (invalidado)"}
                  </span>
                )}
              </div>

              {gestor && dados.alertas?.length > 0 && (
                <div className={ui.feedback} data-type="warning" role="note">
                  <div>
                    <strong>Possível duplicidade</strong>
                    <ul className={styles.alertas}>
                      {dados.alertas.map((alerta) => (
                        <li key={`${alerta.participacaoId}-${alerta.tipo}`}>{ALERTA_LABELS[alerta.tipo]} — protocolo {alerta.protocolo}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <dl className={styles.detalhes}>
                <div><dt>Distribuidor</dt><dd>{dados.distribuidorNome}</dd></div>
                <div><dt>Pedido</dt><dd>{dados.numeroPedido}</dd></div>
                <div><dt>Vendedor</dt><dd>{dados.vendedorNome}</dd></div>
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
                <div><dt>Compra</dt><dd>{formatDateBR(dados.compra.data)} · {formatMoney(dados.compra.valor)}</dd></div>
              </dl>
              {gestor && <p className={styles.muted}>Confira visualmente se o estabelecimento segue o Instagram oficial da Atual Pet.</p>}

              <section className={styles.bloco}>
                <h3>Comprovante</h3>
                <p className={styles.muted}>
                  {dados.comprovante?.mimetype === "application/pdf" ? "PDF" : "Imagem"}
                  {dados.comprovante?.bytes ? ` · ${Math.max(1, Math.round(dados.comprovante.bytes / 1024))} KB` : ""}
                  {dados.comprovante?.nomeOriginal ? ` · ${dados.comprovante.nomeOriginal}` : ""}
                </p>
                <div className={styles.comprovanteBarra}>
                  {!comprovante && (
                    <button type="button" className={ui.secondaryButton} onClick={abrirComprovante} disabled={carregandoComprovante} aria-busy={carregandoComprovante || undefined}>
                      {carregandoComprovante ? "Carregando comprovante…" : "Visualizar comprovante"}
                    </button>
                  )}
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
                    <button type="button" onClick={abrirComprovante}>Tentar novamente</button>
                  </div>
                )}
                {comprovante && (comprovante.tipo?.startsWith("image/") ? (
                  <a href={comprovante.url} target="_blank" rel="noopener noreferrer" className={styles.comprovanteImagem}>
                    <img
                      src={comprovante.url}
                      alt={`Comprovante da participação ${dados.protocolo}`}
                      onError={() => setErroComprovante("O arquivo foi recebido, mas não pôde ser exibido como imagem. Use Baixar para conferir.")}
                    />
                  </a>
                ) : (
                  <iframe className={styles.comprovantePdf} src={comprovante.url} title={`Comprovante em PDF da participação ${dados.protocolo}`} />
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
                  <h3>{ACOES[acao].titulo}</h3>
                  {acao === "aprovar" && <p className={styles.muted}>Um número de cupom aleatório e único será emitido e uma vaga do lote será consumida.</p>}
                  {acao === "cancelar" && dados.status === "aprovado" && <p className={styles.muted}>O cupom {dados.cupom?.codigo} será invalidado e não será reutilizado. A vaga volta ao saldo do lote.</p>}
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
                    <button type="button" className={ui.secondaryButton} onClick={() => setAcao(null)} disabled={salvando}>Voltar</button>
                    <button type="button" className={acao === "aprovar" ? ui.primaryButton : ui.dangerButton} onClick={confirmarAcao} disabled={salvando}>
                      {salvando ? "Salvando…" : ACOES[acao].botao}
                    </button>
                  </div>
                </section>
              ) : (
                (podeDecidir || podeCancelar) && (
                  <div className={styles.acoes}>
                    {podeCancelar && <button type="button" className={ui.dangerButton} onClick={() => iniciarAcao("cancelar")}>Cancelar participação</button>}
                    {podeDecidir && <button type="button" className={ui.dangerButton} onClick={() => iniciarAcao("rejeitar")}>Rejeitar</button>}
                    {podeDecidir && <button type="button" className={ui.primaryButton} onClick={() => iniciarAcao("aprovar")}>Aprovar</button>}
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
