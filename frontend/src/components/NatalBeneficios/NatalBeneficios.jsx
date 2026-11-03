import { useEffect, useState } from "react";
import api from "../../api/axios";
import { useFeedback } from "../Feedback/feedbackContext";
import {
  buildParticipacaoLink,
  buildWhatsappShareUrl,
  carregarConfigNatal,
  faixaParaValor,
  formatMoney,
  proximaFaixaParaValor,
} from "../../utils/natalPremiado";
import RevisoesLote from "./RevisoesLote";
import styles from "./NatalBeneficios.module.css";

// Bloco de benefícios do Natal Premiado nas telas internas (identidade da Central).
// Os bônus aparecem separados dos totais financeiros do pedido.
export function NatalBeneficiosCard({ beneficios, tipo = "previa", proxima, valorAtual, children, titulo = "Natal Premiado 2026 — Benefícios do seu pedido" }) {
  if (!beneficios && !proxima) return null;
  const faltam = proxima ? Math.max(Number(proxima.valorMinimo) - Number(valorAtual || 0), 0) : 0;
  return (
    <section className={styles.card} data-tipo={tipo} aria-label={titulo}>
      <header className={styles.header}>
        <strong>{titulo}</strong>
        <span className={styles.badge} data-tipo={tipo}>
          {{ conquistado: "Conquistado", invalidado: "Invalidado", sem_beneficios: "Sem benefícios" }[tipo] || "Prévia"}
        </span>
      </header>
      {beneficios ? (
        <ul className={styles.lista}>
          <li><strong>{beneficios.cupons} cupons</strong> para distribuição aos pet shops.</li>
          <li><strong>{beneficios.marketingPercentual}%</strong> de bonificação em material de marketing.</li>
          <li><strong>{beneficios.produtosPercentual}%</strong> de bonificação em produtos.</li>
        </ul>
      ) : (
        <p className={styles.texto}>Pedidos a partir de {formatMoney(proxima.valorMinimo)} participam da campanha.</p>
      )}
      {tipo === "previa" && beneficios && (
        <p className={styles.nota}>Benefícios confirmados somente após a aprovação do pedido.</p>
      )}
      {proxima && faltam > 0 && (
        <p className={styles.proxima}>
          Faltam <strong>{formatMoney(faltam)}</strong> para a faixa de {proxima.cupons} cupons e {proxima.produtosPercentual}% em produtos.
        </p>
      )}
      {children}
    </section>
  );
}

const dentroDoPeriodo = (config, agora = new Date()) => Boolean(
  config && agora >= new Date(config.inicio) && agora <= new Date(config.fimCadastros)
);

// Prévia durante a montagem do pedido (catálogo e novo pedido comercial).
export function NatalBeneficiosPrevia({ valorTotal }) {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    let ativo = true;
    carregarConfigNatal(api).then((data) => { if (ativo) setConfig(data); }).catch(() => {});
    return () => { ativo = false; };
  }, []);
  if (!dentroDoPeriodo(config) || !(Number(valorTotal) > 0)) return null;
  return (
    <NatalBeneficiosCard
      tipo="previa"
      beneficios={faixaParaValor(config.faixas, valorTotal)}
      proxima={proximaFaixaParaValor(config.faixas, valorTotal)}
      valorAtual={valorTotal}
    />
  );
}

export function LinkParticipacao({ codigo, distribuidorNome, compacto = false }) {
  const { toast } = useFeedback();
  const link = buildParticipacaoLink(codigo);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado", { description: "Envie para a equipe comercial cadastrar os pet shops." });
    } catch {
      toast.error("Não foi possível copiar", { description: "Selecione o link e copie manualmente." });
    }
  };
  return (
    <div className={styles.link} data-compacto={compacto || undefined}>
      <label>
        <span>Link exclusivo de cadastro</span>
        <input readOnly value={link} onFocus={(event) => event.target.select()} aria-label="Link exclusivo de cadastro" />
      </label>
      <div className={styles.linkAcoes}>
        <button type="button" className={styles.botao} onClick={copiar}>Copiar link</button>
        <a className={styles.botaoSecundario} href={buildWhatsappShareUrl({ link, distribuidorNome })} target="_blank" rel="noopener noreferrer">
          Enviar pelo WhatsApp
        </a>
      </div>
    </div>
  );
}

// Benefícios de um pedido existente: prévia enquanto aguarda aprovação,
// benefícios conquistados (lote) depois de aprovado.
export function NatalBeneficiosPedido({ pedidoId, versao, mostrarLink = true }) {
  const [dados, setDados] = useState(null);
  useEffect(() => {
    let ativo = true;
    api.get(`/natal-2026/pedidos/${pedidoId}/beneficios`)
      .then((response) => { if (ativo) setDados(response.data); })
      .catch(() => { if (ativo) setDados(null); });
    return () => { ativo = false; };
  }, [pedidoId, versao]);

  if (!dados) return null;
  const { lote, campanha } = dados;
  if (lote) {
    const invalidado = lote.status !== "ativo";
    return (
      <NatalBeneficiosCard tipo={invalidado ? "invalidado" : lote.cuponsConcedidos > 0 ? "conquistado" : "sem_beneficios"} beneficios={lote.faixaMaxima}>
        <dl className={styles.saldo}>
          <div><dt>Cupons concedidos</dt><dd>{lote.cuponsConcedidos}</dd></div>
          <div><dt>Aprovados</dt><dd>{lote.saldo.aprovados}</dd></div>
          <div><dt>Pendentes</dt><dd>{lote.saldo.pendentes}</dd></div>
          <div><dt>Disponíveis</dt><dd>{lote.saldo.disponivel}</dd></div>
        </dl>
        {lote.valorAtual !== lote.valorAprovadoInicial && (
          <p className={styles.nota}>
            Aprovado com {formatMoney(lote.valorAprovadoInicial)}; valor atual {formatMoney(lote.valorAtual)}.
          </p>
        )}
        <RevisoesLote
          revisoes={lote.revisoes}
          revisaoPendente={lote.revisaoPendente}
          gestor={(lote.revisoes || []).some((revisao) => revisao.justificativa)}
        />
        {invalidado && <p className={styles.alerta}>Lote invalidado: {lote.invalidacao?.motivo || "pedido cancelado"}. O link não aceita novos cadastros.</p>}
        {!invalidado && mostrarLink && lote.codigoPublico && <LinkParticipacao codigo={lote.codigoPublico} distribuidorNome={lote.distribuidorNome} compacto />}
      </NatalBeneficiosCard>
    );
  }
  if (dados.cancelado || !dados.dentroDoPeriodo) return null;
  if (!dados.previa && !dados.aguardandoAprovacao) return null;
  return (
    <NatalBeneficiosCard
      tipo="previa"
      beneficios={dados.previa}
      proxima={dados.aguardandoAprovacao ? proximaFaixaParaValor(campanha.faixas, dados.valorPedido) : null}
      valorAtual={dados.valorPedido}
    />
  );
}
