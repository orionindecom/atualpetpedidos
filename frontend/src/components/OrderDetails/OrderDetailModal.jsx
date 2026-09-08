import OrderProgress from "../OrderProgress/OrderProgress";
import {
  formatCurrency,
  formatOrderDate,
  formatOrderDateTime,
  formatOrderStatus,
} from "../../utils/orderLogistics";
import {
  getConferenceCompletionIssues,
  getOrderFlowStage,
  getSeparationCompletionIssues,
  isConferenceFinishedForCurrentOrder,
} from "../../utils/orderOperations";
import { useModalDialog } from "../../hooks/useModalDialog";
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
  canApprove = isAdmin,
  canEdit = isAdmin,
  canDelete = isAdmin,
  canOperate = true,
  saving = false,
  approving = false,
  conferenceBusy = false,
  logisticsClosingBusy = false,
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
  onSaveLogisticsClosing,
  onDownloadSeparationPdf,
  onDownloadCommercialPdf,
  onDownloadReportPdf,
  onEditOrder,
  onDeleteOrder,
}) {
  const timeline = detail.historicoPedido || [];
  const flowStage = getOrderFlowStage(detail);
  const pendingApproval = detail.status === "aguardando_aprovacao";
  const terminal = flowStage.terminal;
  const conference = detail.conferencia;
  const conferenceStatus = conference?.status;
  const conferenceRegistered = detail.conferenciaObrigatoria === true || Boolean(conference);
  const conferenceFinished = isConferenceFinishedForCurrentOrder(detail);
  const separationLocked = conferenceFinished;
  const conferenceNeedsRestart = [
    "concluida_com_divergencia",
    "concluida",
  ].includes(conferenceStatus) && !conferenceFinished;
  const conferenceIssues = conferenceStatus === "em_andamento"
    ? getConferenceCompletionIssues(detail, form)
    : [];
  const finishingSeparation = detail.status === "separando" && form.status === "separado";
  const separationIssues = finishingSeparation
    ? getSeparationCompletionIssues(detail, form)
    : [];
  const conferenceVisible = flowStage.showConference || Boolean(conference);
  const operationFormVisible = canOperate && !pendingApproval &&
    !terminal &&
    (!flowStage.conferenceFocused || flowStage.showSeparationEditor) &&
    (
      transitions.length > 0 ||
      flowStage.showOccurrence ||
      flowStage.showInvoicing ||
      flowStage.showShipping
    );
  const sendingSelected = form.status === "enviado";
  const billingSelected = form.status === "faturado";
  const statusOptions = [
    detail.status,
    ...transitions.filter((status) => status !== detail.status),
  ];
  const dialogRef = useModalDialog({ onClose });

  return (
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
        tabIndex="-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalTitle}>
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
            {canEdit && !terminal && ["aguardando_aprovacao", "aprovado", "novo", "em_analise", "separando", "separado"].includes(detail.status) && (
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
            {canOperate && !pendingApproval && (
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
            {canDelete && !terminal && (
              <button
                type="button"
                className={styles.dangerButton}
                disabled={deleting}
                onClick={onDeleteOrder}
              >
                {deleting ? "Excluindo..." : "Excluir"}
              </button>
            )}
          </div>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Fechar detalhes do pedido"
            onClick={onClose}
          >
            Fechar
          </button>
        </header>

        <div className={styles.modalContent}>
          {feedback && (
            <div className={styles.feedback} data-type={feedback.type} role="status">
              {feedback.message}
            </div>
          )}

          {terminal && (
            <div className={styles.terminalNotice} role="status">
              <strong>{flowStage.title}</strong>
              <p>{flowStage.description}</p>
            </div>
          )}

          {pendingApproval && (
            <section className={styles.approvalPanel}>
              <div>
                <strong>Aguardando aprovação administrativa</strong>
                <p>A Logística ainda não pode acessar ou separar este pedido.</p>
              </div>
              {canApprove && (
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
            {!terminal && (
              <div className={styles.nextActionPanel} data-stage={flowStage.key}>
                <div>
                  <span>Status atual</span>
                  <strong>{formatOrderStatus(detail.status)}</strong>
                </div>
                <div>
                  <span>Próxima ação necessária</span>
                  <strong>{flowStage.title}</strong>
                  <p>{flowStage.description}</p>
                </div>
              </div>
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
              <h3>{flowStage.showSeparationEditor ? "Itens e separação" : "Itens do pedido"}</h3>
              <strong>{formatCurrency(detail.valorTotal)}</strong>
            </div>
            {detail.temDivergencia && (
              <div className={styles.divergenceNotice}>
                Existem quantidades separadas diferentes do pedido atual. Corrija os itens indicados antes de concluir a conferência.
              </div>
            )}
            <OrderItems
              items={detail.itens}
              editable={canOperate && flowStage.showSeparationEditor && !separationLocked && form.status !== "cancelado"}
              separation={form.separacao}
              onSeparationChange={onSeparationChange}
              deriveEditableStatus={canOperate && flowStage.showSeparationEditor}
            />
            {finishingSeparation && separationIssues.length > 0 && (
              <div className={styles.divergenceNotice} role="alert">
                <strong>Não é possível concluir a separação.</strong>
                <p>
                  Existem {separationIssues.length} {separationIssues.length === 1 ? "item" : "itens"} com quantidade pendente ou incompatível com o pedido atual:
                </p>
                <ul>
                  {separationIssues.slice(0, 5).map((issue) => (
                    <li key={`${issue.produtoId}-${issue.tipo}`}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {conferenceVisible && <section className={`${styles.section} ${styles.conferenceSection}`}>
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

                {canOperate && !terminal && (conferenceStatus === "pendente" || conferenceNeedsRestart || (
                  !conferenceStatus && detail.status === "separado"
                )) && (
                  <div className={styles.conferenceCallout}>
                    <div>
                      <strong>{conferenceNeedsRestart ? "Conferência precisa ser refeita" : "Pedido aguardando conferência"}</strong>
                      <p>Todos os itens devem corresponder ao pedido atual para que a conferência possa ser concluída.</p>
                    </div>
                    <button
                      type="button"
                      disabled={conferenceBusy || detail.status !== "separado"}
                      onClick={onStartConference}
                    >
                      {conferenceBusy ? "Iniciando..." : conferenceNeedsRestart ? "Refazer conferência" : "Iniciar conferência"}
                    </button>
                  </div>
                )}

                {canOperate && !terminal && conferenceStatus === "em_andamento" && (
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
                    {conferenceIssues.length > 0 && (
                      <div className={styles.divergenceNotice} role="alert">
                        <strong>Não é possível concluir a conferência.</strong>
                        <p>Existem {conferenceIssues.length} item(ns) que precisam ser corrigidos:</p>
                        <ul>
                          {conferenceIssues.slice(0, 5).map((issue) => (
                            <li key={`${issue.produtoId}-${issue.tipo}`}>{issue.message}</li>
                          ))}
                        </ul>
                      </div>
                    )}
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
                      <button
                        type="button"
                        disabled={conferenceBusy || conferenceIssues.length > 0}
                        onClick={onCompleteConference}
                      >
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
          </section>}

          {(flowStage.showLogisticsClosing || detail.fechamentoLogistico) && (
            <section className={`${styles.section} ${styles.conferenceSection}`}>
              <div className={styles.sectionTitle}>
                <h3>Fechamento logístico</h3>
                <span className={styles.conferenceBadge} data-status={detail.fechamentoLogistico ? "concluida" : "pendente"}>
                  {detail.fechamentoLogistico ? "Concluído" : "Pendente"}
                </span>
              </div>

              {detail.fechamentoLogistico && (
                <div className={styles.conferenceResult}>
                  <div className={styles.summaryGrid}>
                    <div><span>Volumes</span><strong>{detail.fechamentoLogistico.quantidadeVolumes}</strong></div>
                    <div><span>Peso total</span><strong>{Number(detail.fechamentoLogistico.pesoTotalKg).toLocaleString("pt-BR")} kg</strong></div>
                    <div><span>Operador</span><strong>{detail.fechamentoLogistico.preenchidoPor?.operadorNome || "Não informado"}</strong></div>
                    <div><span>Registrado em</span><strong>{formatOrderDateTime(detail.fechamentoLogistico.preenchidoEm)}</strong></div>
                  </div>
                  <div className={styles.conferenceNote}>
                    <strong>Descrição dos volumes/caixas</strong>
                    <p>{detail.fechamentoLogistico.observacaoVolumes}</p>
                  </div>
                </div>
              )}

              {flowStage.showLogisticsClosing && isAdmin && (
                <div className={styles.legacyConference}>
                  <strong>Aguardando a Logística</strong>
                  <p>Um operador identificado por PIN deve informar volumes, peso e descrição antes do faturamento.</p>
                </div>
              )}

              {canOperate && flowStage.showLogisticsClosing && !isAdmin && (
                <div className={styles.conferenceWorkspace}>
                  <p className={styles.stageHint}>Etapa obrigatória e sem novo status. Os dados ficarão disponíveis ao Admin para o faturamento.</p>
                  <div className={styles.formGrid}>
                    <label>
                      Quantidade de volumes
                      <input
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={form.quantidadeVolumes}
                        onChange={(event) => onFieldChange("quantidadeVolumes", event.target.value)}
                      />
                    </label>
                    <label>
                      Peso total (kg)
                      <input
                        type="text"
                        inputMode="decimal"
                        required
                        placeholder="Ex.: 38,5"
                        value={form.pesoTotalKg}
                        onChange={(event) => onFieldChange("pesoTotalKg", event.target.value)}
                      />
                    </label>
                    <label className={styles.fullField}>
                      Descrição dos volumes/caixas
                      <textarea
                        maxLength="3000"
                        rows="4"
                        required
                        placeholder="Descreva caixas, embalagens e observações relevantes."
                        value={form.observacaoVolumes}
                        onChange={(event) => onFieldChange("observacaoVolumes", event.target.value)}
                      />
                    </label>
                  </div>
                  <div className={styles.conferenceActions}>
                    <button type="button" disabled={logisticsClosingBusy} onClick={onSaveLogisticsClosing}>
                      {logisticsClosingBusy ? "Salvando..." : detail.fechamentoLogistico ? "Atualizar fechamento" : "Concluir fechamento logístico"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {flowStage.showShippingSummary && (
            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                <h3>Faturamento e envio</h3>
                <span className={styles.shippingBadge}>{formatOrderStatus(detail.status)}</span>
              </div>
              <div className={styles.summaryGrid}>
                <div><span>Nota fiscal</span><strong>{detail.numeroNotaFiscal || "Não informada"}</strong></div>
                <div><span>Data de faturamento</span><strong>{formatOrderDate(detail.dataFaturamento, "Não informada")}</strong></div>
                <div><span>Transportadora</span><strong>{detail.transportadora || "Não informada"}</strong></div>
                <div><span>Código de rastreio</span><strong>{detail.codigoRastreio || "Não informado"}</strong></div>
                <div><span>Data de envio</span><strong>{formatOrderDate(detail.dataEnvio, "Não informada")}</strong></div>
                <div><span>Data de entrega</span><strong>{formatOrderDateTime(detail.dataEntrega, "Ainda não confirmada")}</strong></div>
              </div>
              {detail.linkRastreio && (
                <a className={styles.trackingLink} href={detail.linkRastreio} target="_blank" rel="noreferrer">
                  Abrir rastreamento
                </a>
              )}
            </section>
          )}

          {operationFormVisible && (
            <form className={styles.operationsForm} onSubmit={onSubmit}>
              <section>
                <h3>Próxima ação</h3>
                <div className={styles.formGrid}>
                  <label>
                    Atualização do fluxo
                    <select value={form.status} onChange={(event) => onFieldChange("status", event.target.value)}>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status === detail.status
                            ? `Manter ${formatOrderStatus(status)}`
                            : status === flowStage.nextStatus
                              ? flowStage.nextAction
                              : formatOrderStatus(status)}
                        </option>
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

              {flowStage.showOccurrence && <section>
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
              </section>}

              {flowStage.showInvoicing && isAdmin && <section>
                <h3>Faturamento</h3>
                <p className={styles.stageHint}>Informe a Nota Fiscal e a data de faturamento para avançar o pedido a Faturado.</p>
                <div className={styles.formGrid}>
                  <label>
                    Número da nota fiscal
                    <input type="text" maxLength="100" required={billingSelected} value={form.numeroNotaFiscal} onChange={(event) => onFieldChange("numeroNotaFiscal", event.target.value)} />
                  </label>
                  <label>
                    Data de faturamento
                    <input type="date" required={billingSelected} value={form.dataFaturamento} onChange={(event) => onFieldChange("dataFaturamento", event.target.value)} />
                  </label>
                </div>
              </section>}

              {flowStage.showShipping && <section>
                <h3>Envio</h3>
                <p className={styles.stageHint}>Faturamento concluído com NF {detail.numeroNotaFiscal || "não informada"} em {formatOrderDate(detail.dataFaturamento, "data não informada")}. A data de envio é obrigatória; transporte e rastreio são opcionais.</p>
                <div className={styles.formGrid}>
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
                    <input type="date" required={sendingSelected} value={form.dataEnvio} onChange={(event) => onFieldChange("dataEnvio", event.target.value)} />
                  </label>
                  <div className={styles.readOnlyField}>
                    <span>Data de entrega</span>
                    <strong>{formatOrderDateTime(detail.dataEntrega, "Ainda não confirmada")}</strong>
                  </div>
                </div>
              </section>}

              <div className={styles.formActions}>
                <button type="button" onClick={onClose}>Cancelar</button>
                <button type="submit" disabled={saving || separationIssues.length > 0}>
                  {saving
                    ? "Salvando..."
                    : form.status === flowStage.nextStatus
                      ? flowStage.nextAction
                      : "Salvar atualização"}
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
