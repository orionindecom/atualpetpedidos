import OrderProgress from "../OrderProgress/OrderProgress";
import {
  formatCurrency,
  formatOrderDate,
  formatOrderDateTime,
  formatOrderStatus,
} from "../../utils/orderLogistics";
import OrderItems from "./OrderItems";
import ConferenceItems from "./ConferenceItems";
import styles from "./OrderDetails.module.css";

const CONFERENCE_STATUS_LABELS = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  concluida_com_divergencia: "Concluída com divergência",
};

const RESPONSIBILITY_LABELS = {
  operador_logistica: "Operador da Logística",
  logistica: "Logística",
  admin: "Admin",
  cliente: "Cliente",
};

function OrderDetailModal({
  detail,
  form,
  transitions = [],
  isAdmin = false,
  saving = false,
  approving = false,
  conferenceBusy = false,
  downloadingPdf = false,
  downloadingCommercialPdf = false,
  downloadingReportPdf = false,
  deleting = false,
  feedback,
  activeOperator,
  onClose,
  onSubmit,
  onFieldChange,
  onSeparationChange,
  onApprove,
  onStartConference,
  onCompleteConference,
  onConferenceChange,
  onDownloadSeparationPdf,
  onDownloadCommercialPdf,
  onDownloadReportPdf,
  onEditOrder,
  onDeleteOrder,
}) {
  const timeline = detail.historicoPedido || [];
  const pendingApproval = detail.status === "aguardando_aprovacao";
  const terminal = detail.status === "entregue" || detail.entregaFinalizada === true;
  const conference = detail.conferencia;
  const conferenceStatus = conference?.status;
  const conferenceRegistered = detail.conferenciaObrigatoria === true || Boolean(conference);
  const conferenceFinished = [
    "concluida",
    "concluida_com_divergencia",
  ].includes(conferenceStatus);
  const separationLocked = [
    "pendente",
    "em_andamento",
    "concluida",
    "concluida_com_divergencia",
  ].includes(conferenceStatus);
  const statusOptions = [
    detail.status,
    ...transitions.filter((status) => status !== detail.status),
  ];

  return (
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div>
            <span>Pedido</span>
            <h2 id="order-detail-title">{detail.numeroPedido}</h2>
            <p>{detail.nomeFantasiaCliente || detail.razaoSocialCliente || "Cliente"}</p>
            {activeOperator && (
              <span className={styles.activeOperator}>
                Operador nesta abertura: {activeOperator.nome}
              </span>
            )}
          </div>
          <div className={styles.modalHeaderActions}>
            {isAdmin && !terminal && ["aguardando_aprovacao", "aprovado", "novo", "em_analise"].includes(detail.status) && (
              <button type="button" onClick={onEditOrder}>Editar pedido</button>
            )}
            {isAdmin && (
              <button
                type="button"
                disabled={downloadingCommercialPdf}
                onClick={onDownloadCommercialPdf}
              >
                {downloadingCommercialPdf ? "Preparando..." : "PDF comercial"}
              </button>
            )}
            {!pendingApproval && (
              <button
                type="button"
                disabled={downloadingPdf}
                onClick={onDownloadSeparationPdf}
              >
                {downloadingPdf ? "Preparando PDF..." : "PDF de separação"}
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                disabled={downloadingReportPdf}
                onClick={onDownloadReportPdf}
              >
                {downloadingReportPdf ? "Preparando..." : "Relatório operacional"}
              </button>
            )}
            {isAdmin && !terminal && (
              <button
                type="button"
                className={styles.dangerButton}
                disabled={deleting}
                onClick={onDeleteOrder}
              >
                {deleting ? "Excluindo..." : "Excluir"}
              </button>
            )}
            <button type="button" onClick={onClose}>Fechar</button>
          </div>
        </header>

        <div className={styles.modalContent}>
          {feedback && (
            <div className={styles.feedback} data-type={feedback.type} role="status">
              {feedback.message}
            </div>
          )}

          {terminal && (
            <div className={styles.terminalNotice} role="status">
              <strong>Pedido entregue — estado final</strong>
              <p>As ações operacionais estão encerradas. O histórico e os documentos permanecem disponíveis para consulta.</p>
            </div>
          )}

          {pendingApproval && (
            <section className={styles.approvalPanel}>
              <div>
                <strong>Aguardando aprovação administrativa</strong>
                <p>A Logística ainda não pode acessar ou separar este pedido.</p>
              </div>
              {isAdmin && (
                <button type="button" disabled={approving} onClick={onApprove}>
                  {approving ? "Aprovando..." : "APROVAR PEDIDO"}
                </button>
              )}
            </section>
          )}

          <section className={styles.section}>
            <h3>Andamento</h3>
            <OrderProgress status={detail.status} />
            {detail.aprovacao?.aprovadoEm && (
              <p className={styles.approvalMeta}>
                Aprovado em {formatOrderDateTime(detail.aprovacao.aprovadoEm)} por {detail.aprovacao.usuarioNome || "Administrador"}.
              </p>
            )}
          </section>

          <section className={styles.section}>
            <h3>Dados do pedido</h3>
            <div className={styles.summaryGrid}>
              <div><span>Responsável</span><strong>{detail.nomeResponsavel || "—"}</strong></div>
              <div><span>Razão social</span><strong>{detail.razaoSocialCliente || "—"}</strong></div>
              <div><span>CNPJ</span><strong>{detail.cnpjCliente || "—"}</strong></div>
              <div><span>Data</span><strong>{formatOrderDate(detail.dataPedido || detail.createdAt)}</strong></div>
            </div>
            {detail.observacao && <p className={styles.orderNote}>{detail.observacao}</p>}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              <h3>Itens e separação</h3>
              <strong>{formatCurrency(detail.valorTotal)}</strong>
            </div>
            {detail.temDivergencia && (
              <div className={styles.divergenceNotice}>
                Este pedido possui um ou mais itens atendidos parcialmente.
              </div>
            )}
            <OrderItems
              items={detail.itens}
              editable={!pendingApproval && !terminal && !separationLocked}
              separation={form.separacao}
              onSeparationChange={onSeparationChange}
              deriveEditableStatus={[
                "separando",
                "separado",
                "faturado",
                "enviado",
                "entregue",
              ].includes(form.status)}
            />
          </section>

          <section className={`${styles.section} ${styles.conferenceSection}`}>
            <div className={styles.sectionTitle}>
              <h3>Conferência</h3>
              {conferenceRegistered && (
                <span className={styles.conferenceBadge} data-status={conferenceStatus || "pendente"}>
                  {CONFERENCE_STATUS_LABELS[conferenceStatus] || (
                    detail.status === "separado" ? "Pendente" : "Aguardando separação"
                  )}
                </span>
              )}
            </div>

            {!conferenceRegistered ? (
              <div className={styles.legacyConference}>
                <strong>Conferência não registrada</strong>
                <p>Pedido anterior à obrigatoriedade desta etapa. O fluxo histórico permanece válido.</p>
              </div>
            ) : (
              <>
                {!conferenceStatus && detail.status !== "separado" && (
                  <p className={styles.conferenceHint}>
                    A conferência será liberada quando a separação de todos os itens for concluída.
                  </p>
                )}

                {!terminal && (conferenceStatus === "pendente" || (
                  !conferenceStatus && detail.status === "separado"
                )) && (
                  <div className={styles.conferenceCallout}>
                    <div>
                      <strong>Pedido aguardando conferência</strong>
                      <p>Os valores separados serão preenchidos automaticamente para uma validação rápida.</p>
                    </div>
                    <button
                      type="button"
                      disabled={conferenceBusy || detail.status !== "separado"}
                      onClick={onStartConference}
                    >
                      {conferenceBusy ? "Iniciando..." : "Iniciar conferência"}
                    </button>
                  </div>
                )}

                {!terminal && conferenceStatus === "em_andamento" && (
                  <div className={styles.conferenceWorkspace}>
                    <p className={styles.conferenceMeta}>
                      Iniciada em {formatOrderDateTime(conference.iniciadaEm)} por {conference.iniciadoPor?.operadorNome || conference.iniciadoPor?.usuarioNome || "Usuário interno"}.
                    </p>
                    <ConferenceItems
                      items={detail.itens}
                      values={form.conferencia}
                      editable
                      onChange={onConferenceChange}
                    />
                    <label className={styles.conferenceObservation}>
                      Observação da conferência (opcional)
                      <textarea
                        maxLength="1000"
                        rows="3"
                        value={form.observacaoConferencia}
                        onChange={(event) => onFieldChange("observacaoConferencia", event.target.value)}
                      />
                    </label>
                    <div className={styles.conferenceActions}>
                      <button type="button" disabled={conferenceBusy} onClick={onCompleteConference}>
                        {conferenceBusy ? "Concluindo..." : "Concluir conferência"}
                      </button>
                    </div>
                  </div>
                )}

                {conferenceFinished && (
                  <div className={styles.conferenceResult}>
                    <div className={styles.summaryGrid}>
                      <div>
                        <span>Conferente</span>
                        <strong>{conference.concluidoPor?.operadorNome || conference.concluidoPor?.usuarioNome || "Usuário interno"}</strong>
                      </div>
                      <div>
                        <span>Conclusão</span>
                        <strong>{formatOrderDateTime(conference.concluidaEm)}</strong>
                      </div>
                      <div>
                        <span>Itens conferidos</span>
                        <strong>{conference.totalItens ?? conference.itens?.length ?? 0}</strong>
                      </div>
                      <div>
                        <span>Divergências</span>
                        <strong>{conference.totalDivergencias ?? 0}</strong>
                      </div>
                    </div>
                    <ConferenceItems items={conference.itens || []} />
                    {conference.observacao && (
                      <div className={styles.conferenceNote}>
                        <strong>Observação</strong>
                        <p>{conference.observacao}</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {!pendingApproval && !terminal && (
            <form className={styles.operationsForm} onSubmit={onSubmit}>
              <section>
                <h3>Status e registro</h3>
                <div className={styles.formGrid}>
                  <label>
                    Status
                    <select value={form.status} onChange={(event) => onFieldChange("status", event.target.value)}>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>{formatOrderStatus(status)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Observação da mudança de status
                    <input
                      type="text"
                      maxLength="500"
                      value={form.observacaoHistorico}
                      onChange={(event) => onFieldChange("observacaoHistorico", event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section>
                <h3>Nova ocorrência</h3>
                <div className={styles.formGrid}>
                  <label>
                    Tipo
                    <select value={form.ocorrenciaTipo} onChange={(event) => onFieldChange("ocorrenciaTipo", event.target.value)}>
                      <option value="observacao">Observação</option>
                      <option value="falta_produto">Falta de produto</option>
                      <option value="informacao_operacional">Informação operacional</option>
                    </select>
                  </label>
                  <div className={styles.internalOnlyNote}>
                    <strong>Registro interno</strong>
                    <span>Visível somente para Admin e Logística.</span>
                  </div>
                  <label className={styles.fullField}>
                    Conteúdo (opcional)
                    <textarea
                      maxLength="1000"
                      rows="3"
                      value={form.ocorrenciaConteudo}
                      onChange={(event) => onFieldChange("ocorrenciaConteudo", event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section>
                <h3>Faturamento e expedição</h3>
                <div className={styles.formGrid}>
                  <label>
                    Número da nota fiscal
                    <input type="text" maxLength="100" value={form.numeroNotaFiscal} onChange={(event) => onFieldChange("numeroNotaFiscal", event.target.value)} />
                  </label>
                  <label>
                    Data de faturamento
                    <input type="date" value={form.dataFaturamento} onChange={(event) => onFieldChange("dataFaturamento", event.target.value)} />
                  </label>
                  <label>
                    Transportadora
                    <input type="text" maxLength="120" value={form.transportadora} onChange={(event) => onFieldChange("transportadora", event.target.value)} />
                  </label>
                  <label>
                    Código de rastreio
                    <input type="text" maxLength="120" value={form.codigoRastreio} onChange={(event) => onFieldChange("codigoRastreio", event.target.value)} />
                  </label>
                  <label className={styles.fullField}>
                    Link de rastreamento
                    <input type="url" maxLength="500" placeholder="https://" value={form.linkRastreio} onChange={(event) => onFieldChange("linkRastreio", event.target.value)} />
                  </label>
                  <label>
                    Data de envio
                    <input type="date" value={form.dataEnvio} onChange={(event) => onFieldChange("dataEnvio", event.target.value)} />
                  </label>
                  <div className={styles.readOnlyField}>
                    <span>Data de entrega</span>
                    <strong>{formatOrderDateTime(detail.dataEntrega, "Ainda não confirmada")}</strong>
                  </div>
                </div>
              </section>

              <div className={styles.formActions}>
                <button type="button" onClick={onClose}>Cancelar</button>
                <button type="submit" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar atualização"}
                </button>
              </div>
            </form>
          )}

          <section className={styles.historySection}>
            <h3>Histórico do pedido</h3>
            {detail.observacaoLogistica && (
              <div className={styles.legacyNote}>
                <strong>Observação logística legada</strong>
                <p>{detail.observacaoLogistica}</p>
              </div>
            )}
            {timeline.length === 0 ? (
              <p>Este pedido ainda não possui histórico registrado.</p>
            ) : (
              <ol>
                {timeline.map((entry) => (
                  <li key={entry.id}>
                    <time dateTime={entry.data}>{formatOrderDateTime(entry.data)}</time>
                    <strong>{entry.titulo}</strong>
                    <span>
                      {entry.responsavelNome || "Responsável não registrado"}
                      {entry.responsavelPerfil
                        ? ` · ${RESPONSIBILITY_LABELS[entry.responsavelPerfil] || entry.responsavelPerfil}`
                        : ""}
                    </span>
                    {(entry.statusAnterior || entry.statusNovo) && (
                      <span>{formatOrderStatus(entry.statusAnterior)} → {formatOrderStatus(entry.statusNovo)}</span>
                    )}
                    {entry.detalhes && <p>{entry.detalhes}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

export default OrderDetailModal;
