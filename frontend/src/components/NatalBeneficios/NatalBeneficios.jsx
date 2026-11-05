import { useEffect, useState } from "react";
import api from "../../api/axios";
import { useFeedback } from "../Feedback/feedbackContext";
import {
  buildParticipacaoLink,
  buildWhatsappShareUrl,
  carregarConfigNatal,
  cuponsParaValor,
  faixaParaValor,
  formatMoney,
  proximaFaixaParaValor,
} from "../../utils/natalPremiado";
import RevisoesLote from "./RevisoesLote";
import styles from "./NatalBeneficios.module.css";

// Bloco de benefícios do Natal Premiado nas telas internas (identidade da Central).
// Os bônus aparecem separados dos totais financeiros do pedido.
export function NatalBeneficiosCard({ beneficios, tipo = "previa", proxima, valorAtual, children, titulo = "Natal Premiado 2026 — Benefícios da campanha" }) {
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
        <p className={styles.texto}>As compras acumulam: a partir de {formatMoney(proxima.valorMinimo)} no ciclo você libera benefícios.</p>
      )}
      {tipo === "previa" && beneficios && (
        <p className={styles.nota}>Prévia deste valor isolado. As compras acumulam entre pedidos e os benefícios são confirmados após a aprovação.</p>
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
  const faixa = faixaParaValor(config.faixas, valorTotal);
  return (
    <NatalBeneficiosCard
      tipo="previa"
      beneficios={faixa ? { ...faixa, cupons: cuponsParaValor(config.faixas, config.cicloValor, valorTotal) } : null}
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
        <span>Link de cadastro</span>
        <input readOnly value={link} onFocus={(event) => event.target.select()} aria-label="Link de cadastro" />
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

// Benefícios ligados a um pedido: o saldo é do distribuidor, somando todas as compras.
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
  const { lote, conta, campanha } = dados;
  if (conta && (lote || dados.aprovado)) {
    const link = conta.links?.find((item) => item.status === "ativo");
    return (
      <NatalBeneficiosCard
        tipo={conta.cupons.total > 0 ? "conquistado" : "sem_beneficios"}
        beneficios={{ ...conta.compras.faixaAtual, cupons: conta.cupons.total }}
        titulo="Natal Premiado 2026 — Benefícios do distribuidor"
      >
        <dl className={styles.saldo}>
          <div><dt>Compras acumuladas</dt><dd>{formatMoney(conta.compras.total)}</dd></div>
          <div><dt>Cupons concedidos</dt><dd>{conta.cupons.total}</dd></div>
          <div><dt>Utilizados</dt><dd>{conta.cupons.utilizados}</dd></div>
          <div><dt>Disponíveis</dt><dd>{conta.cupons.disponiveis}</dd></div>
        </dl>
        {dados.cancelado && <p className={styles.nota}>Este pedido foi cancelado e não conta para o acumulado.</p>}
        {conta.compras.proximaFaixa && (
          <p className={styles.nota}>Ciclo {conta.compras.cicloAtual}: faltam {formatMoney(conta.compras.restanteProximaFaixa)} para {conta.compras.proximaFaixa.cupons} cupons no ciclo.</p>
        )}
        {lote && (
          <RevisoesLote
            revisoes={lote.revisoes}
            revisaoPendente={lote.revisaoPendente}
            gestor={(lote.revisoes || []).some((revisao) => revisao.justificativa)}
          />
        )}
        {mostrarLink && link && <LinkParticipacao codigo={link.codigoPublico} distribuidorNome={conta.distribuidorNome} compacto />}
      </NatalBeneficiosCard>
    );
  }
  if (dados.cancelado || !dados.dentroDoPeriodo) return null;
  if (!dados.previa && !dados.aguardandoAprovacao) return null;
  return (
    <NatalBeneficiosCard
      tipo="previa"
      beneficios={dados.previa ? { ...dados.previa, cupons: cuponsParaValor(campanha.faixas, campanha.cicloValor, dados.valorPedido) } : null}
      proxima={dados.aguardandoAprovacao ? proximaFaixaParaValor(campanha.faixas, dados.valorPedido) : null}
      valorAtual={dados.valorPedido}
    />
  );
}
